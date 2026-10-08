use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, async_runtime};

use crate::{AppRuntime, AppState};

use super::apply::{ImportResult, ImportSelections, apply_import as run_apply};
use super::detect::{DetectedApp, detect_apps, display_name, parse_app};
use super::shared::resolve_glimpse_model;

fn home_dir(app: &AppHandle<AppRuntime>) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map_err(|err| format!("Could not resolve home directory: {err}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: String,
    pub name: String,
    pub dictionary_count: usize,
    pub replacements_count: usize,
    pub personalities_count: usize,
    pub shortcut: Option<String>,
    pub language: Option<String>,
    pub auto_launch: Option<bool>,
    pub model_source: Option<String>,
    pub model_key: Option<String>,
    pub model_recognized: bool,
    pub transcript_count: u32,
}

// The import commands read other apps' databases, which can be large, so they
// run off the main thread.
#[tauri::command]
pub async fn detect_importable_apps(
    app: AppHandle<AppRuntime>,
) -> Result<Vec<DetectedApp>, String> {
    let home = home_dir(&app)?;
    async_runtime::spawn_blocking(move || detect_apps(&home))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn preview_import(
    app: AppHandle<AppRuntime>,
    id: String,
) -> Result<ImportPreview, String> {
    let home = home_dir(&app)?;
    async_runtime::spawn_blocking(move || build_preview(id, &home))
        .await
        .map_err(|err| err.to_string())?
}

fn build_preview(id: String, home: &Path) -> Result<ImportPreview, String> {
    let bundle = parse_app(&id, home)?;

    let (model_source, model_key, model_recognized) = match bundle.model_hint.as_ref() {
        Some(hint) => {
            let key = hint.family.and_then(|family| {
                let keys: Vec<String> = crate::speech::catalog::list_local_models()
                    .into_iter()
                    .map(|m| m.key)
                    .collect();
                resolve_glimpse_model(family, &keys)
            });
            let recognized = key.is_some();
            (Some(hint.source_id.clone()), key, recognized)
        }
        None => (None, None, false),
    };

    Ok(ImportPreview {
        id: id.clone(),
        name: display_name(&id).to_string(),
        dictionary_count: bundle.dictionary.len(),
        replacements_count: bundle.replacements.len(),
        personalities_count: bundle.personalities.len(),
        shortcut: bundle.smart_shortcut,
        language: bundle.language,
        auto_launch: bundle.auto_launch,
        model_source,
        model_key,
        model_recognized,
        transcript_count: bundle.transcript_count,
    })
}

#[tauri::command]
pub async fn apply_import(
    app: AppHandle<AppRuntime>,
    id: String,
    selections: Option<ImportSelections>,
) -> Result<ImportResult, String> {
    let home = home_dir(&app)?;
    let selections = selections.unwrap_or_default();
    let app_for_task = app.clone();
    let result = async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<AppState>();
        run_apply(&app_for_task, &state, &id, &home, &selections)
    })
    .await
    .map_err(|err| err.to_string())??;
    crate::analytics::track_feature_used(&app, "import");
    Ok(result)
}
