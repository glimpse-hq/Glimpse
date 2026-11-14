// The on-device cleanup model: PrismML's Ternary Bonsai 2 with Glimpse's LoRA
// adapter, run on the GPU by glimpse-language. Its files live in the models
// directory like any catalog model (`speech::catalog::CLEANUP_MODEL_MANIFEST`).

use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use glimpse_language::bonsai::{
    self, Availability, Bonsai, BonsaiError, BonsaiErrorKind, GenerateOptions, Generation,
    StopReason,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::AppRuntime;
use crate::settings::SettingsStore;
use crate::speech::catalog::{CLEANUP_MODEL_ADAPTER, CLEANUP_MODEL_MANIFEST};

// Frees the GPU state and cached prompt (about 235 MB); the next request
// rebuilds them in a few tens of ms.
const IDLE_AFTER_USE: Duration = Duration::from_secs(30);
// A prewarm happens when recording starts, so it has to outlast the recording.
const IDLE_AFTER_PREWARM: Duration = Duration::from_secs(5 * 60);

// The device check: one fixed cleanup after install, and again when the GPU, its driver or the
// app changes. A GPU that gets it wrong, never ends it, or is too slow is not offered the model.
const KEY_DEVICE_CHECK: &str = "cleanup_device_check";
const CHECK_INPUT: &str = "um so the bug happens when you uh press the shortcut twice really fast and the recording starts and then stops right away i think it's a race condition in the audio callback so we should add a debounce of like fifty milliseconds";
const CHECK_EXPECTED: &str = "The bug happens when you press the shortcut twice really fast, and the recording starts and then stops right away. I think it's a race condition in the audio callback, so we should add a debounce of like fifty milliseconds.";
// Words in order shared with the expected output; a GPU that flips one near tie still passes.
const CHECK_MIN_SIMILARITY: f32 = 0.9;
// Iris Xe writes 18 tokens a second on mains and 11 to 13 on battery; the slowest GPUs that
// work well in the field write 57.
const CHECK_MIN_TOKENS_PER_SECOND: f64 = 25.0;
const CHECK_TIME_LIMIT: Duration = Duration::from_secs(30);
const CHECK_PASSED: &str = "ok";
const CHECK_RUNNING: &str = "running";

struct Runtime {
    models_dir: PathBuf,
    store: Arc<SettingsStore>,
    app: Option<AppHandle<AppRuntime>>,
    installed: AtomicBool,
    /// The device check failed on this GPU, driver and app version.
    unsupported: AtomicBool,
    /// `check_device` ran this launch.
    check_started: AtomicBool,
    /// Set by every request, so the device check gives way.
    check_cancel: AtomicBool,
    loaded: Mutex<Option<Loaded>>,
    uses: AtomicU64,
}

struct Loaded {
    files: Vec<Option<(u64, SystemTime)>>,
    bonsai: Arc<Bonsai>,
    adapter: String,
}

/// One cleanup request and how it ran, for analytics.
pub struct Run {
    pub generation: Generation,
    /// The adapter's hash from its file name.
    pub adapter: String,
    /// "loaded" (read from disk first), "idle" (GPU state rebuilt), or "warm".
    pub state: &'static str,
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
    let current = dir.join(CLEANUP_MODEL_ADAPTER);
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
            tracing::warn!("[cleanup model] no models directory: {err:#}");
            return;
        }
    };
    let store = Arc::clone(&app.state::<crate::AppState>().settings_store);
    start(models_dir, store, Some(app.clone()));
}

fn start(models_dir: PathBuf, store: Arc<SettingsStore>, app: Option<AppHandle<AppRuntime>>) {
    let _ = RUNTIME.set(Runtime {
        models_dir,
        store,
        app,
        installed: AtomicBool::new(false),
        unsupported: AtomicBool::new(false),
        check_started: AtomicBool::new(false),
        check_cancel: AtomicBool::new(false),
        loaded: Mutex::new(None),
        uses: AtomicU64::new(0),
    });
    std::thread::spawn(refresh_installed);
}

pub fn supported() -> bool {
    // The model has no CPU path, and its GPU probe would load the driver the fallback avoids.
    crate::speech::engine::cpu_fallback().is_none()
        && bonsai::availability() == Availability::Available
}

/// Rescans the model directory. A few file checks; keep it off the keypress
/// path.
pub fn refresh_installed() -> bool {
    let Some(runtime) = RUNTIME.get() else {
        return false;
    };
    let dir = runtime.models_dir.join(CLEANUP_MODEL_MANIFEST.id);
    let installed = supported()
        && bonsai::MODEL_FILES
            .iter()
            .all(|file| dir.join(file).is_file())
        && adapter_path(&dir).is_some()
        && bonsai::describe(&dir)
            .is_ok_and(|info| info.size.label() == CLEANUP_MODEL_MANIFEST.variant);
    // Before `installed`, so a GPU that failed before is never offered the model.
    if supported() && !runtime.check_started.swap(true, Ordering::SeqCst) {
        check_device(runtime);
    }
    runtime.installed.store(installed, Ordering::SeqCst);
    if !installed && let Some(old) = runtime.loaded.lock().take() {
        old.bonsai.release_idle();
    }
    installed
}

#[derive(Default, Serialize, Deserialize)]
struct DeviceCheck {
    /// GPU, driver and app version it ran on.
    key: String,
    /// "ok", "wrong_output", "no_end" or "too_slow"; "running" while it runs.
    result: String,
    tokens_per_second: f64,
}

/// Loads this GPU's check result, or runs the check once the model is installed and has been
/// unused for a while. A previous result stands until then. Runs once per launch.
fn check_device(runtime: &'static Runtime) {
    let key = format!(
        "{} {}",
        bonsai::device().unwrap_or_default(),
        env!("CARGO_PKG_VERSION")
    );
    let stored = runtime
        .store
        .read_app_value(KEY_DEVICE_CHECK, DeviceCheck::default())
        .unwrap_or_default();
    if stored.key == key && stored.result == CHECK_RUNNING {
        // The last check ended the process.
        finish_check(runtime, key, "no_end", 0.0, true);
        return;
    }
    let failed_before = !stored.result.is_empty() && stored.result != CHECK_PASSED;
    runtime.unsupported.store(failed_before, Ordering::SeqCst);
    if stored.key == key {
        return;
    }
    std::thread::spawn(move || {
        let running = DeviceCheck {
            key: key.clone(),
            result: CHECK_RUNNING.to_string(),
            tokens_per_second: 0.0,
        };
        let (result, tokens_per_second) = loop {
            runtime.check_cancel.store(false, Ordering::SeqCst);
            let uses = runtime.uses.load(Ordering::SeqCst);
            std::thread::sleep(IDLE_AFTER_PREWARM);
            let quiet = runtime.installed.load(Ordering::SeqCst)
                && runtime.uses.load(Ordering::SeqCst) == uses
                && !runtime
                    .app
                    .as_ref()
                    .is_some_and(|app| app.state::<crate::AppState>().recording().is_active());
            if !quiet
                || runtime
                    .store
                    .write_app_value(KEY_DEVICE_CHECK, &running)
                    .is_err()
            {
                continue;
            }
            match run_device_check(runtime) {
                Some(done) => break done,
                None => {
                    let _ = runtime.store.write_app_value(KEY_DEVICE_CHECK, &stored);
                }
            }
        };
        finish_check(runtime, key, result, tokens_per_second, !failed_before);
    });
}

fn finish_check(
    runtime: &'static Runtime,
    key: String,
    result: &'static str,
    tokens_per_second: f64,
    notify: bool,
) {
    tracing::info!("[cleanup model] device check: {result}, {tokens_per_second:.0} tokens/s");
    let failed = result != CHECK_PASSED;
    runtime.unsupported.store(failed, Ordering::SeqCst);
    let check = DeviceCheck {
        key,
        result: result.to_string(),
        tokens_per_second,
    };
    if let Err(err) = runtime.store.write_app_value(KEY_DEVICE_CHECK, &check) {
        tracing::warn!("[cleanup model] device check not saved: {err:#}");
    }
    crate::analytics::dictation::track_cleanup_device_check(result, tokens_per_second);
    if failed
        && notify
        && let Some(app) = &runtime.app
    {
        crate::toast::show_with_action(
            app,
            "warning",
            None,
            &crate::toast::native(app, "native.toast.cleanup_model_unsupported"),
            "open_llm_cleanup_settings",
            &crate::toast::native(app, "native.toast.open_settings_action"),
        );
    }
}

/// The check's result and decode speed, or `None` to try again later: a request interrupted
/// it, or the model did not load.
fn run_device_check(runtime: &'static Runtime) -> Option<(&'static str, f64)> {
    let started = Instant::now();
    let generation = load(runtime, CLEANUP_MODEL_MANIFEST.id).and_then(|(bonsai, _, _)| {
        let result = bonsai.count_tokens(CHECK_INPUT).and_then(|input_tokens| {
            let (system, user, max_tokens) =
                crate::llm_cleanup::bonsai_cleanup_request(CHECK_INPUT, input_tokens);
            let options = GenerateOptions {
                max_tokens,
                ..GenerateOptions::default()
            };
            bonsai.generate_streaming(
                &system,
                &user,
                &options,
                Some(&runtime.check_cancel),
                |_| {
                    if started.elapsed() > CHECK_TIME_LIMIT {
                        ControlFlow::Break(())
                    } else {
                        ControlFlow::Continue(())
                    }
                },
            )
        });
        release_when_idle(runtime, bonsai, IDLE_AFTER_USE);
        result
    });
    let generation = match generation {
        Ok(generation) => generation,
        Err(err) => {
            tracing::warn!("[cleanup model] device check stopped: {err}");
            return (err.kind == BonsaiErrorKind::Runtime).then_some(("no_end", 0.0));
        }
    };
    let stats = &generation.stats;
    let tokens_per_second = stats.generated_tokens as f64 / stats.decode.as_secs_f64().max(0.001);
    let result = match generation.stop {
        StopReason::Eos if similarity(&generation.text, CHECK_EXPECTED) < CHECK_MIN_SIMILARITY => {
            "wrong_output"
        }
        StopReason::Eos if tokens_per_second < CHECK_MIN_TOKENS_PER_SECOND => "too_slow",
        StopReason::Eos => CHECK_PASSED,
        StopReason::Stopped => "too_slow",
        StopReason::MaxTokens | StopReason::ContextFull => "no_end",
    };
    Some((result, tokens_per_second))
}

/// Twice the longest common run of words, in order, over both word counts.
fn similarity(a: &str, b: &str) -> f32 {
    let (a, b): (Vec<&str>, Vec<&str>) = (
        a.split_whitespace().collect(),
        b.split_whitespace().collect(),
    );
    let mut row = vec![0usize; b.len() + 1];
    for word in &a {
        let mut diagonal = 0;
        for (j, other) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = if word == other {
                diagonal + 1
            } else {
                above.max(row[j])
            };
            diagonal = above;
        }
    }
    2.0 * row[b.len()] as f32 / (a.len() + b.len()).max(1) as f32
}

/// After a download: removes adapters the catalog no longer lists, and the
/// prompt states saved with them, then rescans.
pub fn finish_install() {
    if let Some(runtime) = RUNTIME.get() {
        remove_stale_files(&runtime.models_dir.join(CLEANUP_MODEL_MANIFEST.id));
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
        let stale = is_adapter(name) && name != CLEANUP_MODEL_ADAPTER;
        if stale && std::fs::remove_file(&path).is_ok() {
            tracing::info!("[cleanup model] removed {name}");
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
    let dir = runtime.models_dir.join(CLEANUP_MODEL_MANIFEST.id);
    // A quit right after an adapter download can leave the old one behind.
    if dir.join(CLEANUP_MODEL_ADAPTER).is_file() {
        remove_stale_files(&dir);
    }
    if dir.is_dir() {
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
        || runtime.unsupported.load(Ordering::SeqCst)
        || crate::speech::install::check_model_installed_at(
            &runtime.models_dir,
            CLEANUP_MODEL_MANIFEST.id,
        )
        || !crate::license::license_gate_active(&runtime.store)
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::speech::install::download_model_now(
            app,
            CLEANUP_MODEL_MANIFEST.id.into(),
            Some(false),
        )
        .await
        {
            tracing::warn!("[cleanup model] download failed: {err}");
        }
    });
}

/// The model to run, if it is installed and this GPU passed the device check. Cheap, safe per
/// dictation.
pub fn resolve() -> Option<&'static str> {
    let runtime = RUNTIME.get()?;
    (runtime.installed.load(Ordering::SeqCst) && !runtime.unsupported.load(Ordering::SeqCst))
        .then_some(CLEANUP_MODEL_MANIFEST.id)
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

/// The model, its adapter's hash, and whether it was read from disk now.
fn load(
    runtime: &Runtime,
    model: &'static str,
) -> Result<(Arc<Bonsai>, String, bool), BonsaiError> {
    let dir = runtime.models_dir.join(model);
    let files = file_stamps(&dir);
    let mut loaded = runtime.loaded.lock();
    if let Some(current) = loaded.as_ref()
        && current.files == files
    {
        return Ok((Arc::clone(&current.bonsai), current.adapter.clone(), false));
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
        "[cleanup model] loaded {model} with {} in {} ms",
        adapter.display(),
        started.elapsed().as_millis()
    );
    let adapter = adapter
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("adapter-")?.strip_suffix(".safetensors"))
        .unwrap_or("unhashed")
        .to_string();
    *loaded = Some(Loaded {
        files,
        bonsai: Arc::clone(&bonsai),
        adapter: adapter.clone(),
    });
    Ok((bonsai, adapter, true))
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
    runtime.check_cancel.store(true, Ordering::SeqCst);
    let (bonsai, _, _) = load(runtime, model)?;
    runtime.uses.fetch_add(1, Ordering::SeqCst);
    let result = bonsai.prewarm(system_prompt);
    release_when_idle(runtime, bonsai, IDLE_AFTER_PREWARM);
    result
}

/// The model loaded for one request.
pub struct Session {
    runtime: &'static Runtime,
    bonsai: Arc<Bonsai>,
    adapter: String,
    state: &'static str,
}

/// Loads the model for one request. Blocking.
pub fn open(model: &'static str) -> Result<Session, BonsaiError> {
    let runtime = runtime_for_use()?;
    runtime.check_cancel.store(true, Ordering::SeqCst);
    let (bonsai, adapter, loaded_now) = load(runtime, model)?;
    let state = if loaded_now {
        "loaded"
    } else if bonsai.is_idle() {
        "idle"
    } else {
        "warm"
    };
    // Frees the model if the session is dropped without a request.
    release_when_idle(runtime, Arc::clone(&bonsai), IDLE_AFTER_USE);
    Ok(Session {
        runtime,
        bonsai,
        adapter,
        state,
    })
}

impl Session {
    pub fn count_tokens(&self, text: &str) -> Result<usize, BonsaiError> {
        self.bonsai.count_tokens(text)
    }

    /// One greedy request. Blocking; setting `cancel` stops it within one step, and so does `on_text`
    /// returning `Break`.
    pub fn generate(
        self,
        system_prompt: &str,
        user_text: &str,
        max_tokens: usize,
        cancel: &AtomicBool,
        on_text: impl FnMut(&str) -> ControlFlow<()>,
    ) -> Result<Run, BonsaiError> {
        self.runtime.uses.fetch_add(1, Ordering::SeqCst);
        let options = GenerateOptions {
            max_tokens,
            ..GenerateOptions::default()
        };
        let result = self.bonsai.generate_streaming(
            system_prompt,
            user_text,
            &options,
            Some(cancel),
            on_text,
        );
        release_when_idle(self.runtime, self.bonsai, IDLE_AFTER_USE);
        Ok(Run {
            generation: result?,
            adapter: self.adapter,
            state: self.state,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupModelStatus {
    supported: bool,
    installed: bool,
    /// The device check failed on this GPU, or speech models run on the CPU.
    gpu_unsupported: bool,
}

#[tauri::command]
pub async fn cleanup_model_status() -> Result<CleanupModelStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cpu_fallback = crate::speech::engine::cpu_fallback().is_some();
        CleanupModelStatus {
            supported: RUNTIME.get().is_some() && (cpu_fallback || supported()),
            installed: refresh_installed(),
            gpu_unsupported: cpu_fallback
                || RUNTIME
                    .get()
                    .is_some_and(|runtime| runtime.unsupported.load(Ordering::SeqCst)),
        }
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

    // CLEANUP_TEST_MODEL=<dir with the Hugging Face files>, then
    // cargo test --manifest-path src-tauri/Cargo.toml cleanup_model::tests -- --ignored --nocapture
    #[test]
    #[ignore]
    fn cleans_up_through_the_provider_path() {
        let source =
            PathBuf::from(std::env::var("CLEANUP_TEST_MODEL").expect("CLEANUP_TEST_MODEL"));
        let size = bonsai::describe(&source).unwrap().size;
        assert_eq!(size.label(), CLEANUP_MODEL_MANIFEST.variant);
        let id = CLEANUP_MODEL_MANIFEST.id;
        let root = std::env::temp_dir().join(format!("cleanup-model-test-{}", std::process::id()));
        let dir = root.join("models").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        for file in bonsai::MODEL_FILES {
            std::os::unix::fs::symlink(source.join(file), dir.join(file)).unwrap();
        }
        std::os::unix::fs::symlink(
            source.join("adapter.safetensors"),
            dir.join(CLEANUP_MODEL_ADAPTER),
        )
        .unwrap();
        let store = Arc::new(SettingsStore::open(root.join("settings.db")).unwrap());
        start(root.join("models"), store, None);
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
