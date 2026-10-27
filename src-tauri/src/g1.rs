// G1, the on-device cleanup model: PrismML's Ternary Bonsai 2 with Glimpse's
// LoRA adapter, run on the GPU by glimpse-language. Its files live in the
// models directory like any catalog model (`speech::catalog::G1_MANIFESTS`).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};

use glimpse_language::bonsai::{
    self, Availability, Bonsai, BonsaiError, BonsaiErrorKind, GenerateOptions, Generation,
};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::AppRuntime;
use crate::settings::SettingsStore;
use crate::speech::catalog::{G1_ADAPTER, G1_MANIFEST};

// Frees the GPU state and cached prompt (about 235 MB); the next request
// rebuilds them in a few tens of ms.
const IDLE_AFTER_USE: Duration = Duration::from_secs(30);
// A prewarm happens when recording starts, so it has to outlast the recording.
const IDLE_AFTER_PREWARM: Duration = Duration::from_secs(5 * 60);

struct Runtime {
    models_dir: PathBuf,
    store: Arc<SettingsStore>,
    installed: AtomicBool,
    loaded: Mutex<Option<Loaded>>,
    uses: AtomicU64,
}

struct Loaded {
    files: Vec<Option<(u64, SystemTime)>>,
    bonsai: Arc<Bonsai>,
}

// Size and modification time of every file a load reads, so replaced model or
// adapter files load on the next use without a restart.
fn file_stamps(dir: &Path) -> Vec<Option<(u64, SystemTime)>> {
    bonsai::MODEL_FILES
        .iter()
        .map(|file| dir.join(file))
        .chain(adapter_path(dir))
        .map(|path| {
            let meta = std::fs::metadata(path).ok()?;
            Some((meta.len(), meta.modified().ok()?))
        })
        .collect()
}

fn is_adapter(name: &str) -> bool {
    name.starts_with("adapter") && name.ends_with(".safetensors")
}

/// The catalog's adapter, or an older one until its update downloads.
fn adapter_path(dir: &Path) -> Option<PathBuf> {
    let current = dir.join(G1_ADAPTER);
    if current.is_file() {
        return Some(current);
    }
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_adapter)
        })
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub fn init(app: &AppHandle<AppRuntime>) {
    let models_dir = match crate::model_manager::model_cache_dir(app) {
        Ok(dir) => dir,
        Err(err) => {
            tracing::warn!("[G1] no models directory: {err:#}");
            return;
        }
    };
    let store = Arc::clone(&app.state::<crate::AppState>().settings_store);
    start(models_dir, store);
}

fn start(models_dir: PathBuf, store: Arc<SettingsStore>) {
    let _ = RUNTIME.set(Runtime {
        models_dir,
        store,
        installed: AtomicBool::new(false),
        loaded: Mutex::new(None),
        uses: AtomicU64::new(0),
    });
    std::thread::spawn(refresh_installed);
}

pub fn supported() -> bool {
    bonsai::availability() == Availability::Available
}

/// Rescans the model directory. A few file checks; keep it off the keypress
/// path.
pub fn refresh_installed() -> bool {
    let Some(runtime) = RUNTIME.get() else {
        return false;
    };
    let dir = runtime.models_dir.join(G1_MANIFEST.id);
    let installed = supported()
        && bonsai::MODEL_FILES
            .iter()
            .all(|file| dir.join(file).is_file())
        && adapter_path(&dir).is_some()
        && bonsai::describe(&dir).is_ok_and(|info| info.size.label() == G1_MANIFEST.variant);
    runtime.installed.store(installed, Ordering::SeqCst);
    if !installed && let Some(old) = runtime.loaded.lock().take() {
        old.bonsai.release_idle();
    }
    installed
}

/// After a download: removes adapters the catalog no longer lists, and the
/// prompt states saved with them, then rescans.
pub fn finish_install() {
    if let Some(runtime) = RUNTIME.get() {
        remove_stale_files(&runtime.models_dir.join(G1_MANIFEST.id));
    }
    refresh_installed();
}

fn remove_stale_files(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut removed = false;
    for path in entries.flatten().map(|entry| entry.path()) {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let stale = is_adapter(name) && name != G1_ADAPTER;
        if stale && std::fs::remove_file(&path).is_ok() {
            tracing::info!("[G1] removed {name}");
            removed = true;
        }
    }
    if removed {
        let _ = std::fs::remove_dir_all(dir.join("prefix-cache"));
    }
}

/// A model missing files the catalog now lists (a new adapter, or a download
/// cut short) gets them in the background. A model never downloaded stays that
/// way.
pub fn update_in_background(app: &AppHandle<AppRuntime>) {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    if runtime.models_dir.join(G1_MANIFEST.id).is_dir() {
        install_in_background(app);
    }
}

/// Downloads whatever the model is missing, with a license or trial, since
/// only licensed features use it.
pub fn install_in_background(app: &AppHandle<AppRuntime>) {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    if !supported()
        || crate::speech::install::check_model_installed_at(&runtime.models_dir, G1_MANIFEST.id)
        || !crate::license::license_gate_active(&runtime.store)
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) =
            crate::speech::install::download_model_now(app, G1_MANIFEST.id.into(), Some(false))
                .await
        {
            tracing::warn!("[G1] download failed: {err}");
        }
    });
}

/// The model to run, if it is installed. Cheap, safe per dictation.
pub fn resolve() -> Option<&'static str> {
    RUNTIME
        .get()?
        .installed
        .load(Ordering::SeqCst)
        .then_some(G1_MANIFEST.id)
}

fn error(kind: BonsaiErrorKind, message: &str) -> BonsaiError {
    BonsaiError {
        kind,
        message: message.to_string(),
    }
}

fn runtime_for_use() -> Result<&'static Runtime, BonsaiError> {
    let runtime = RUNTIME.get().ok_or_else(|| {
        error(
            BonsaiErrorKind::Unsupported,
            "The cleanup model is not set up",
        )
    })?;
    crate::license::require_license_gate(&runtime.store, "on-device cleanup")
        .map_err(|message| error(BonsaiErrorKind::Unsupported, &message))?;
    Ok(runtime)
}

fn load(runtime: &Runtime, model: &'static str) -> Result<Arc<Bonsai>, BonsaiError> {
    let dir = runtime.models_dir.join(model);
    let files = file_stamps(&dir);
    let mut loaded = runtime.loaded.lock();
    if let Some(current) = loaded.as_ref()
        && current.files == files
    {
        return Ok(Arc::clone(&current.bonsai));
    }
    // Idle timers can still hold the old model; free its GPU state now.
    if let Some(old) = loaded.take() {
        old.bonsai.release_idle();
    }
    let adapter = adapter_path(&dir)
        .ok_or_else(|| error(BonsaiErrorKind::Load, "The cleanup model has no adapter"))?;
    let started = std::time::Instant::now();
    let bonsai = Arc::new(Bonsai::load(&dir, Some(&adapter))?);
    tracing::info!(
        "[G1] loaded {model} with {} in {} ms",
        adapter.display(),
        started.elapsed().as_millis()
    );
    *loaded = Some(Loaded {
        files,
        bonsai: Arc::clone(&bonsai),
    });
    Ok(bonsai)
}

fn release_when_idle(runtime: &'static Runtime, bonsai: Arc<Bonsai>, after: Duration) {
    let generation = runtime.uses.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(after);
        if runtime.uses.load(Ordering::SeqCst) == generation {
            bonsai.release_idle();
        }
    });
}

/// Loads the model and caches `system_prompt`'s state for the next request.
/// Blocking.
pub fn prewarm(system_prompt: &str) -> Result<(), BonsaiError> {
    let runtime = runtime_for_use()?;
    let model = resolve()
        .ok_or_else(|| error(BonsaiErrorKind::Load, "The cleanup model is not installed"))?;
    let bonsai = load(runtime, model)?;
    runtime.uses.fetch_add(1, Ordering::SeqCst);
    let result = bonsai.prewarm(system_prompt);
    release_when_idle(runtime, bonsai, IDLE_AFTER_PREWARM);
    result
}

/// One greedy request. Blocking; setting `cancel` stops it within one step.
pub fn generate(
    model: &'static str,
    system_prompt: &str,
    user_text: &str,
    max_tokens: usize,
    cancel: &AtomicBool,
) -> Result<Generation, BonsaiError> {
    let runtime = runtime_for_use()?;
    let bonsai = load(runtime, model)?;
    runtime.uses.fetch_add(1, Ordering::SeqCst);
    let options = GenerateOptions {
        max_tokens,
        ..GenerateOptions::default()
    };
    let result = bonsai.generate(system_prompt, user_text, &options, Some(cancel));
    release_when_idle(runtime, bonsai, IDLE_AFTER_USE);
    result
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct G1Status {
    supported: bool,
    installed: bool,
}

#[tauri::command]
pub async fn g1_status() -> Result<G1Status, String> {
    tauri::async_runtime::spawn_blocking(|| G1Status {
        supported: RUNTIME.get().is_some() && supported(),
        installed: refresh_installed(),
    })
    .await
    .map_err(|err| err.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::time::Instant;

    // Resident memory and the physical footprint, which also counts GPU buffers.
    fn memory() -> String {
        let pid = std::process::id().to_string();
        let run = |cmd: &str, args: &[&str]| {
            let out = std::process::Command::new(cmd).args(args).output().unwrap();
            String::from_utf8_lossy(&out.stdout).into_owned()
        };
        let rss_kb: f64 = run("ps", &["-o", "rss=", "-p", &pid])
            .trim()
            .parse()
            .unwrap_or(0.0);
        let footprint = run("footprint", &["-p", &pid])
            .lines()
            .find_map(|line| {
                line.split_once("Footprint: ")
                    .map(|(_, rest)| rest.to_string())
            })
            .and_then(|rest| rest.split(" (").next().map(str::to_string))
            .unwrap_or_default();
        format!("rss {:.0} MB, footprint {footprint}", rss_kb / 1024.0)
    }

    // G1_TEST_MODEL=<dir with the Hugging Face files>, then
    // cargo test --manifest-path src-tauri/Cargo.toml g1::tests -- --ignored --nocapture
    #[test]
    #[ignore]
    fn cleans_up_through_the_provider_path() {
        let source = PathBuf::from(std::env::var("G1_TEST_MODEL").expect("G1_TEST_MODEL"));
        let size = bonsai::describe(&source).unwrap().size;
        assert_eq!(size.label(), G1_MANIFEST.variant);
        let id = G1_MANIFEST.id;
        let root = std::env::temp_dir().join(format!("g1-test-{}", std::process::id()));
        let dir = root.join("models").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        for file in bonsai::MODEL_FILES {
            std::os::unix::fs::symlink(source.join(file), dir.join(file)).unwrap();
        }
        std::os::unix::fs::symlink(source.join("adapter.safetensors"), dir.join(G1_ADAPTER))
            .unwrap();
        let store = Arc::new(SettingsStore::open(root.join("settings.db")).unwrap());
        start(root.join("models"), store);
        assert!(refresh_installed());

        let settings = crate::settings::UserSettings {
            llm_enabled: true,
            cleanup_enabled: true,
            llm_provider: crate::llm_cleanup::BONSAI_PROVIDER.to_string(),
            personalities: Vec::new(),
            ..Default::default()
        };
        assert!(crate::llm_cleanup::is_llm_available(&settings));
        let client = reqwest::Client::new();
        let inputs = [
            "um so i think we should uh move the launch to thursday because the build isnt ready",
            "send the report to alice no actually send it to bob and copy jen on it",
            "okay so the plan for tomorrow is uh first we review the onboarding flow then we \
             look at the pricing page and um if there's time we go through the bug list that \
             came in from the beta testers last week and figure out which ones block the release",
        ];
        println!("before load: {}", memory());
        for (round, input) in inputs.iter().enumerate() {
            if round > 0 {
                crate::llm_cleanup::prewarm_cleanup(&settings);
                std::thread::sleep(Duration::from_secs(2));
            }
            let started = Instant::now();
            let out = tauri::async_runtime::block_on(crate::llm_cleanup::cleanup_transcription(
                &client, input, &settings, None,
            ))
            .unwrap();
            println!(
                "{} {} ms, {}\n  in:  {input}\n  out: {out}",
                if round == 0 { "cold" } else { "warm" },
                started.elapsed().as_millis(),
                memory()
            );
        }
        let bonsai = Arc::clone(
            &RUNTIME
                .get()
                .unwrap()
                .loaded
                .lock()
                .as_ref()
                .unwrap()
                .bonsai,
        );
        bonsai.release_idle();
        assert!(bonsai.is_idle());
        // Metal returns the freed buffers shortly after.
        std::thread::sleep(Duration::from_secs(3));
        println!("after release_idle: {}", memory());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
