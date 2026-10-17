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
use crate::settings::{SettingsStore, UserSettings};
use crate::speech::catalog::{G1_MANIFESTS, g1_definition};

// bonsai/train.py's export first, then a PEFT adapter (which reads
// adapter_config.json next to it). Without either, the base model runs.
const ADAPTER_FILES: [&str; 2] = ["adapter.safetensors", "adapter_model.safetensors"];
const ADAPTER_CONFIG: &str = "adapter_config.json";
// Frees the GPU state and cached prompt (about 235 MB on the 2B, 670 MB on
// the 4B); the next request rebuilds them in a few tens of ms.
const IDLE_AFTER_USE: Duration = Duration::from_secs(30);
// A prewarm happens when recording starts, so it has to outlast the recording.
const IDLE_AFTER_PREWARM: Duration = Duration::from_secs(5 * 60);

struct Runtime {
    models_dir: PathBuf,
    store: Arc<SettingsStore>,
    installed: Mutex<Vec<&'static str>>,
    loaded: Mutex<Option<Loaded>>,
    uses: AtomicU64,
}

struct Loaded {
    model: &'static str,
    files: Vec<Option<(u64, SystemTime)>>,
    bonsai: Arc<Bonsai>,
}

// Size and modification time of every file a load reads, so replaced model or
// adapter files load on the next use without a restart.
fn file_stamps(dir: &Path) -> Vec<Option<(u64, SystemTime)>> {
    bonsai::MODEL_FILES
        .iter()
        .chain(&ADAPTER_FILES)
        .chain(&[ADAPTER_CONFIG])
        .map(|file| {
            let meta = std::fs::metadata(dir.join(file)).ok()?;
            Some((meta.len(), meta.modified().ok()?))
        })
        .collect()
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
        installed: Mutex::new(Vec::new()),
        loaded: Mutex::new(None),
        uses: AtomicU64::new(0),
    });
    std::thread::spawn(refresh_installed);
}

fn supported() -> bool {
    bonsai::availability() == Availability::Available
}

/// Rescans the model directories. A few file checks; keep it off the keypress
/// path.
pub fn refresh_installed() -> Vec<&'static str> {
    let Some(runtime) = RUNTIME.get() else {
        return Vec::new();
    };
    let installed: Vec<&'static str> = if supported() {
        G1_MANIFESTS
            .iter()
            .filter(|manifest| {
                bonsai::describe(&runtime.models_dir.join(manifest.id))
                    .is_ok_and(|info| info.size.label() == manifest.variant)
            })
            .map(|manifest| manifest.id)
            .collect()
    } else {
        Vec::new()
    };
    *runtime.installed.lock() = installed.clone();
    let mut loaded = runtime.loaded.lock();
    if loaded
        .as_ref()
        .is_some_and(|loaded| !installed.contains(&loaded.model))
        && let Some(old) = loaded.take()
    {
        old.bonsai.release_idle();
    }
    installed
}

/// The installed model to run: the one chosen in `llm_model`, else the
/// smallest. Cheap, safe per dictation.
pub fn resolve(settings: &UserSettings) -> Option<&'static str> {
    let installed = RUNTIME.get()?.installed.lock();
    installed
        .iter()
        .find(|id| **id == settings.llm_model.trim())
        .or_else(|| installed.first())
        .copied()
}

pub fn size_label(model: &str) -> Option<String> {
    g1_definition(model).map(|manifest| manifest.variant.to_ascii_lowercase())
}

fn error(kind: BonsaiErrorKind, message: &str) -> BonsaiError {
    BonsaiError {
        kind,
        message: message.to_string(),
    }
}

fn runtime_for_use() -> Result<&'static Runtime, BonsaiError> {
    let runtime = RUNTIME
        .get()
        .ok_or_else(|| error(BonsaiErrorKind::Unsupported, "G1 is not set up"))?;
    crate::license::require_active_license(&runtime.store, "G1")
        .map_err(|message| error(BonsaiErrorKind::Unsupported, &message))?;
    Ok(runtime)
}

fn load(runtime: &Runtime, model: &'static str) -> Result<Arc<Bonsai>, BonsaiError> {
    let dir = runtime.models_dir.join(model);
    let files = file_stamps(&dir);
    let mut loaded = runtime.loaded.lock();
    if let Some(current) = loaded.as_ref()
        && current.model == model
        && current.files == files
    {
        return Ok(Arc::clone(&current.bonsai));
    }
    // Idle timers can still hold the old model; free its GPU state now.
    if let Some(old) = loaded.take() {
        old.bonsai.release_idle();
    }
    let adapter = ADAPTER_FILES
        .iter()
        .map(|file| dir.join(file))
        .find(|path| path.is_file());
    let started = std::time::Instant::now();
    let bonsai = Arc::new(Bonsai::load(&dir, adapter.as_deref())?);
    tracing::info!(
        "[G1] loaded {model} in {} ms (adapter: {})",
        started.elapsed().as_millis(),
        adapter.is_some()
    );
    *loaded = Some(Loaded {
        model,
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
pub fn prewarm(settings: &UserSettings, system_prompt: &str) -> Result<(), BonsaiError> {
    let runtime = runtime_for_use()?;
    let model =
        resolve(settings).ok_or_else(|| error(BonsaiErrorKind::Load, "G1 is not installed"))?;
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
    installed: Vec<G1Model>,
}

#[derive(Debug, Serialize)]
pub struct G1Model {
    key: &'static str,
    label: &'static str,
}

#[tauri::command]
pub async fn g1_status() -> Result<G1Status, String> {
    tauri::async_runtime::spawn_blocking(|| G1Status {
        supported: RUNTIME.get().is_some() && supported(),
        installed: refresh_installed()
            .into_iter()
            .filter_map(g1_definition)
            .map(|manifest| G1Model {
                key: manifest.id,
                label: manifest.label,
            })
            .collect(),
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

    // G1_TEST_MODEL=<dir with model.safetensors, config.json, tokenizer.json>
    // and optionally G1_TEST_ADAPTER=<dir with the adapter files>, then
    // cargo test --manifest-path src-tauri/Cargo.toml g1::tests -- --ignored --nocapture
    #[test]
    #[ignore]
    fn cleans_up_through_the_provider_path() {
        let source = PathBuf::from(std::env::var("G1_TEST_MODEL").expect("G1_TEST_MODEL"));
        let size = bonsai::describe(&source).unwrap().size;
        let id = G1_MANIFESTS
            .iter()
            .find(|manifest| manifest.variant == size.label())
            .unwrap()
            .id;
        let root = std::env::temp_dir().join(format!("g1-test-{}", std::process::id()));
        let dir = root.join("models").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        let mut files: Vec<PathBuf> = bonsai::MODEL_FILES.iter().map(|f| source.join(f)).collect();
        if let Ok(adapter) = std::env::var("G1_TEST_ADAPTER") {
            for file in [
                "adapter.safetensors",
                "adapter_model.safetensors",
                "adapter_config.json",
            ] {
                let path = PathBuf::from(&adapter).join(file);
                if path.is_file() {
                    files.push(path);
                }
            }
        }
        for file in files {
            std::os::unix::fs::symlink(&file, dir.join(file.file_name().unwrap())).unwrap();
        }
        let store = Arc::new(SettingsStore::open(root.join("settings.db")).unwrap());
        start(root.join("models"), store);
        assert_eq!(refresh_installed(), vec![id]);

        let settings = UserSettings {
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
