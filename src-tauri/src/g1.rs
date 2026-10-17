// G1, the on-device cleanup model: PrismML's Ternary Bonsai 2 with Glimpse's
// LoRA adapter, run on the GPU by glimpse-language. Its files live in the
// models directory like any catalog model (`speech::catalog::G1_MANIFESTS`).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

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
// Frees the GPU state and cached prompt (about 235 MB on the 2B, 670 MB on
// the 4B); the next request rebuilds them in a few tens of ms.
const IDLE_AFTER_USE: Duration = Duration::from_secs(30);
// A prewarm happens when recording starts, so it has to outlast the recording.
const IDLE_AFTER_PREWARM: Duration = Duration::from_secs(5 * 60);

struct Runtime {
    models_dir: PathBuf,
    store: Arc<SettingsStore>,
    installed: Mutex<Vec<&'static str>>,
    loaded: Mutex<Option<(&'static str, Arc<Bonsai>)>>,
    uses: AtomicU64,
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
        .is_some_and(|(id, _)| !installed.contains(id))
    {
        *loaded = None;
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
    let mut loaded = runtime.loaded.lock();
    if let Some((id, bonsai)) = loaded.as_ref()
        && *id == model
    {
        return Ok(Arc::clone(bonsai));
    }
    let dir = runtime.models_dir.join(model);
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
    *loaded = Some((model, Arc::clone(&bonsai)));
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
