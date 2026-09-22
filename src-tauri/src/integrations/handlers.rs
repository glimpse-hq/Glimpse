//! In-app handlers for control-socket commands. Each handler reuses the app's
//! existing command logic so tray/menu/in-memory state stay consistent.

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::ipc::{Request, Response};
use crate::settings::Replacement;
use crate::tray::SettingsPage;
use crate::{AppRuntime, AppState};

pub(crate) fn dispatch(app: &AppHandle<AppRuntime>, request: &Request) -> Response {
    crate::analytics::track_cli_command(app, request.client.as_deref(), &request.command);
    let result = match request.command.as_str() {
        "ping" => Ok(json!({ "pong": true })),
        "dictionary.add" => dictionary_add(app, &request.args),
        "dictionary.remove" => dictionary_remove(app, &request.args),
        "replacements.add" => replacements_add(app, &request.args),
        "replacements.remove" => replacements_remove(app, &request.args),
        "model.set" => model_set(app, &request.args),
        "open" => open(app, &request.args),
        "status" => status(app),
        "library.import" => library_import(app, &request.args),
        "api.start" => api_start(app, &request.args),
        "api.stop" => api_stop(app),
        "api.status" => api_status(app),
        "transcribe" => transcribe(app, &request.args),
        "record.status" => Ok(record_state_json(
            &app.state::<AppState>().recording().state(),
        )),
        "record.start" => record_start(app),
        "record.pause" => record_pause(app),
        "record.resume" => record_resume(app),
        "record.bookmark" => record_bookmark(app),
        "record.finish" => record_finish(app, &request.args),
        other => Err(format!("Unknown command: {other}")),
    };
    match result {
        Ok(data) => Response::ok(data),
        Err(message) => Response::error(message),
    }
}

/// Mutating CLI commands require an active license; reads stay free. Uses the
/// same `require_active_license` gate as the CLI installer and API server.
fn require_license(state: &AppState) -> Result<(), String> {
    crate::license::require_active_license(&state.settings_store, "the Glimpse CLI")
}

fn arg_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing string argument `{key}`"))
}

fn arg_string_array(args: &Value, key: &str) -> Result<Vec<String>, String> {
    args.get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("missing array argument `{key}`"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("`{key}` must contain only strings"))
        })
        .collect()
}

fn dictionary_add(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let additions = arg_string_array(args, "words")?;
    let state = app.state::<AppState>();
    require_license(&state)?;
    let mut words = state.current_settings_unmasked().dictionary;
    words.extend(additions);
    let saved = crate::dictionary::set_dictionary(words, app.clone(), state)?;
    Ok(json!({ "words": saved }))
}

fn dictionary_remove(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let removals = arg_string_array(args, "words")?;
    let lowered: Vec<String> = removals.iter().map(|w| w.to_lowercase()).collect();
    let state = app.state::<AppState>();
    require_license(&state)?;
    let words: Vec<String> = state
        .current_settings_unmasked()
        .dictionary
        .into_iter()
        .filter(|word| !lowered.contains(&word.to_lowercase()))
        .collect();
    let saved = crate::dictionary::set_dictionary(words, app.clone(), state)?;
    Ok(json!({ "words": saved }))
}

fn replacements_add(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let from = arg_str(args, "from")?;
    let to = arg_str(args, "to")?;
    let state = app.state::<AppState>();
    require_license(&state)?;
    let mut replacements = state.current_settings_unmasked().replacements;
    replacements.retain(|r| !r.from.eq_ignore_ascii_case(&from));
    replacements.push(Replacement { from, to });
    let saved = crate::dictionary::set_replacements(replacements, app.clone(), state)?;
    Ok(json!({ "replacements": saved }))
}

fn replacements_remove(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let from = arg_str(args, "from")?;
    let state = app.state::<AppState>();
    require_license(&state)?;
    let replacements: Vec<Replacement> = state
        .current_settings_unmasked()
        .replacements
        .into_iter()
        .filter(|r| !r.from.eq_ignore_ascii_case(&from))
        .collect();
    let saved = crate::dictionary::set_replacements(replacements, app.clone(), state)?;
    Ok(json!({ "replacements": saved }))
}

fn model_set(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    require_license(&app.state::<AppState>())?;
    let target = arg_str(args, "target")?;
    match target.as_str() {
        "remote" => crate::speech::menu::cli_enable_remote(app)?,
        "local" => {
            let model = arg_str(args, "model")?;
            crate::speech::menu::cli_set_local_model(app, &model)?;
        }
        other => return Err(format!("Unknown model target: {other}")),
    }
    let settings = app.state::<AppState>().current_settings_unmasked();
    Ok(json!({
        "active": active_model(&settings),
        "remote_enabled": settings.remote_speech_enabled,
    }))
}

fn open(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let target = args
        .get("target")
        .and_then(Value::as_str)
        .unwrap_or("settings");
    let tab = args.get("tab").and_then(Value::as_str);

    let page = match (target, tab) {
        ("home", _) | ("history", _) | ("settings", Some("history")) => Some(SettingsPage::History),
        ("dictionary", _) => Some(SettingsPage::Dictionary),
        ("personalization", _) => Some(SettingsPage::Personalization),
        ("library", _) => Some(SettingsPage::Library),
        ("record", _) => Some(SettingsPage::Record),
        ("models", _) | ("settings", Some("models")) => Some(SettingsPage::Models),
        ("settings", Some("about")) => Some(SettingsPage::About),
        ("settings", Some("account")) => Some(SettingsPage::Account),
        _ => None,
    };
    let result = match page {
        Some(page) => crate::tray::open_settings_page(app, page),
        None => crate::tray::toggle_settings_window(app),
    };
    result.map_err(|err| err.to_string())?;
    Ok(json!({ "opened": target }))
}

fn status(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let settings = state.current_settings_unmasked();
    let pill = serde_json::to_value(state.pill().status()).unwrap_or(Value::Null);
    let api = state.local_api.status();
    Ok(json!({
        "app_running": true,
        "pill": pill,
        "local_api": {
            "running": api.running,
            "host": api.host,
            "port": api.port,
        },
        "active_model": active_model(&settings),
        "remote_enabled": settings.remote_speech_enabled,
    }))
}

fn library_import(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    let state = app.state::<AppState>();
    require_license(&state)?;
    let settings = state.current_settings_unmasked();

    let options = crate::library::LibraryImportOptions {
        store_original: args
            .get("store_original")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        model_key: args
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| crate::speech::selected_model(&settings)),
        llm_cleanup_enabled: args
            .get("llm_cleanup")
            .and_then(Value::as_bool)
            .unwrap_or(settings.cleanup_enabled),
        show_timestamps: args
            .get("show_timestamps")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        detect_speakers: args
            .get("detect_speakers")
            .and_then(Value::as_bool)
            .unwrap_or_else(|| crate::speech::installed_diarizer_path(app).is_some()),
    };

    let item = crate::library::commands::import_library_file(
        path,
        options,
        crate::library::JobSource::Cli,
        app,
        &state,
    )?;
    Ok(json!({
        "id": item.id,
        "name": item.name,
        "source_path": item.source_path,
        "status": "pending",
    }))
}

fn api_start(app: &AppHandle<AppRuntime>, overrides: &Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    crate::license::require_active_license(&state.settings_store, "the API server")?;
    let settings = state.current_settings_unmasked();
    let requested = overrides.get("model").and_then(Value::as_str);
    if requested.is_some_and(crate::remote_speech::is_remote_model) {
        return Err("The Local API only runs local models.".to_string());
    }
    let installed = crate::model_manager::installed_local_model(app, &settings.local_model)
        .ok_or_else(|| NO_LOCAL_MODEL.to_string())?;
    // "auto" preloads nothing; each request names its model.
    let model = match requested {
        Some("auto") => "auto".to_string(),
        Some(model) => ready_local_model(app, model)?.key,
        None if settings.local_api_model == "auto" => "auto".to_string(),
        None => crate::model_manager::ensure_model_ready(app, &settings.local_api_model)
            .map_or(installed.key, |ready| ready.key),
    };
    // Each field falls back to the saved setting when the caller omits it.
    let args = crate::local_api::StartLocalApiArgs {
        host: overrides
            .get("host")
            .and_then(Value::as_str)
            .map(crate::settings::canonicalize_local_api_host)
            .unwrap_or_else(|| settings.local_api_host.clone()),
        port: overrides
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|port| u16::try_from(port).ok())
            .unwrap_or(settings.local_api_port),
        model,
        api_key: overrides
            .get("api_key")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| settings.local_api_key.clone()),
        cors: overrides
            .get("cors")
            .and_then(Value::as_bool)
            .unwrap_or(settings.local_api_cors),
    };
    let controller = std::sync::Arc::clone(&state.local_api);
    let status = tauri::async_runtime::block_on(controller.start(app.clone(), args))?;
    Ok(api_status_json(&status))
}

fn api_stop(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let status = tauri::async_runtime::block_on(state.local_api.stop(app))?;
    Ok(api_status_json(&status))
}

fn api_status(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    let status = app.state::<AppState>().local_api.status();
    Ok(api_status_json(&status))
}

fn api_status_json(status: &crate::local_api::LocalApiStatus) -> Value {
    json!({
        "running": status.running,
        "host": status.host,
        "port": status.port,
        "model": status.model,
        "loaded_model": status.loaded_model,
        "api_key_required": status.api_key_required,
    })
}

const NO_LOCAL_MODEL: &str = "Download a local model in Glimpse first.";

/// Loads an installed local model, or explains what to download.
fn ready_local_model(
    app: &AppHandle<AppRuntime>,
    model_id: &str,
) -> Result<crate::model_manager::ReadyModel, String> {
    if crate::model_manager::definition(model_id).is_none() {
        return Err(format!("Unknown model: {model_id}"));
    }
    crate::model_manager::ensure_model_ready(app, model_id).map_err(|_| {
        if crate::model_manager::installed_local_model(app, model_id).is_none() {
            NO_LOCAL_MODEL.to_string()
        } else {
            format!(
                "{} isn't downloaded. Download it in Glimpse or pass --model.",
                crate::model_manager::model_label(model_id)
            )
        }
    })
}

fn transcribe(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    let path = arg_str(args, "path")?;
    let state = app.state::<AppState>();
    require_license(&state)?;
    let mut settings = state.current_settings_unmasked();
    if let Some(language) = args.get("language").and_then(Value::as_str) {
        settings.language = language.to_string();
    }

    let local_only = args.get("local").and_then(Value::as_bool).unwrap_or(false);
    let model_id = match args.get("model").and_then(Value::as_str) {
        Some(model) if local_only && crate::remote_speech::is_remote_model(model) => {
            return Err("--local can't be used with a cloud model.".to_string());
        }
        Some(model) => model.to_string(),
        None if local_only => {
            crate::model_manager::installed_local_model(app, &settings.local_model)
                .ok_or_else(|| NO_LOCAL_MODEL.to_string())?
                .key
        }
        None => crate::speech::selected_model(&settings),
    };
    let remote = crate::remote_speech::is_remote_model(&model_id);
    if remote && !settings.remote_speech_enabled {
        if !crate::remote_speech::has_valid_config(&settings) {
            return Err(
                "No cloud speech provider is set up. Set one up in Glimpse or pass a local --model."
                    .to_string(),
            );
        }
        // An explicit cloud --model uses the saved provider for this run only.
        settings.remote_speech_enabled = true;
    }
    let local_model = if remote {
        None
    } else {
        Some(ready_local_model(app, &model_id)?)
    };
    let audio = decode_audio(&path)?;
    let duration_seconds = if audio.sample_rate > 0 {
        audio.samples.len() as f32 / audio.sample_rate as f32
    } else {
        0.0
    };

    let started = std::time::Instant::now();
    let http = state.http();
    let result = tauri::async_runtime::block_on(crate::speech::transcribe(
        app,
        &http,
        &settings,
        &model_id,
        &audio.wav_path,
        &settings.local_model,
        false,
        || false,
        |success| success,
        || async {
            let ready = match local_model {
                Some(ready) => ready,
                None => {
                    crate::model_manager::ensure_local_fallback_model(app, &settings.local_model)?
                }
            };
            let dictionary = crate::dictionary::dictionary_entries_for_model(&ready, &settings);
            state.local_transcriber().transcribe_with_segments(
                &ready,
                &audio.samples,
                audio.sample_rate,
                &dictionary,
                Some(&settings.language),
            )
        },
    ));
    let success = match result {
        Ok(success) => success,
        Err(err) => {
            crate::analytics::track_transcription_failed(
                app,
                "transcription",
                if remote { "remote" } else { "local" },
                &crate::model_manager::model_label(&model_id),
                crate::analytics::classify_error(&err),
                Some(duration_seconds),
                "cli",
            );
            return Err(format!("Transcription failed: {err}"));
        }
    };

    let mut text =
        crate::dictionary::apply_replacements(&success.transcript, &settings.replacements);

    let want_cleanup = args
        .get("cleanup")
        .and_then(Value::as_bool)
        .unwrap_or(settings.cleanup_enabled);
    let mut llm_cleaned = false;
    if want_cleanup && crate::llm_cleanup::is_llm_available(&settings) {
        match tauri::async_runtime::block_on(crate::llm_cleanup::cleanup_transcription(
            &http, &text, &settings, None,
        )) {
            Ok(cleaned) => {
                text = cleaned;
                llm_cleaned = true;
            }
            Err(err) => tracing::warn!("CLI transcribe cleanup skipped: {err}"),
        }
    }

    let word_count = text.split_whitespace().count();
    // After a cloud fallback this names the local model that ran.
    let speech_model = success.speech_model.unwrap_or_default();
    crate::analytics::track_transcription_completed(
        app,
        crate::analytics::TranscriptionEvent {
            mode: if crate::remote_speech::is_remote_model(&speech_model) {
                "remote"
            } else {
                "local"
            },
            model: &speech_model,
            llm_cleaned,
            audio_duration_seconds: duration_seconds,
            transcription_duration_seconds: started.elapsed().as_secs_f32(),
            word_count: word_count as u32,
            audio_source: "cli",
            ..Default::default()
        },
    );

    Ok(json!({
        "text": text,
        "speech_model": speech_model,
        "llm_cleaned": llm_cleaned,
        "word_count": word_count,
        "duration_seconds": duration_seconds,
    }))
}

fn record_state_json(state: &crate::recording::RecordingSessionState) -> Value {
    json!({
        "app_running": true,
        "status": state.status,
        "elapsed_ms": state.elapsed_ms,
        "mic": state.sources.microphone.is_some(),
        "system": crate::recording::captured_system_label(&state.sources),
        "bookmarks": state.bookmarks.len(),
    })
}

/// Turns the recording error codes the Record screen translates into sentences.
fn record_error(code: String) -> String {
    let message = match code.as_str() {
        "already_recording" => "A recording is already in progress.",
        "not_recording" => "No recording is in progress.",
        "no_model" => "Install a speech model in Glimpse first.",
        "microphone_permission" => "Glimpse needs microphone access.",
        "system_audio_permission" => "Glimpse needs permission to record system audio.",
        "no_microphone" => "No microphone was found.",
        _ => return code,
    };
    message.to_string()
}

fn require_recording(app: &AppHandle<AppRuntime>) -> Result<(), String> {
    let status = app.state::<AppState>().recording().state().status;
    if matches!(status, "recording" | "paused") {
        Ok(())
    } else {
        Err(record_error("not_recording".into()))
    }
}

fn record_start(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    let state = app.state::<AppState>();
    require_license(&state)?;
    if state.recording().is_active() {
        return Err(record_error("already_recording".into()));
    }
    let Some(sources) = crate::recording::load_last_sources(app) else {
        crate::tray::open_settings_page(app, SettingsPage::Record)
            .map_err(|err| err.to_string())?;
        return Err("Choose what to record in Glimpse first. The Record screen is open.".into());
    };
    crate::recording::start_session(app, sources).map_err(|err| record_error(err.to_string()))?;
    Ok(record_state_json(&state.recording().state()))
}

fn record_pause(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    require_license(&app.state::<AppState>())?;
    require_recording(app)?;
    let state = crate::recording::pause_recording_session(app.clone(), None);
    Ok(record_state_json(&state))
}

fn record_resume(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    require_license(&app.state::<AppState>())?;
    require_recording(app)?;
    let state = crate::recording::resume_session(app);
    Ok(record_state_json(&state))
}

fn record_bookmark(app: &AppHandle<AppRuntime>) -> Result<Value, String> {
    require_license(&app.state::<AppState>())?;
    let bookmark = crate::recording::add_recording_bookmark(app.clone()).map_err(record_error)?;
    Ok(json!({ "bookmark": bookmark }))
}

fn record_finish(app: &AppHandle<AppRuntime>, args: &Value) -> Result<Value, String> {
    require_license(&app.state::<AppState>())?;
    // A finish that is already saving must not run again: it would reset the session.
    require_recording(app)?;
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let item = tauri::async_runtime::block_on(crate::recording::finish_recording_session(
        app.clone(),
        name,
    ))
    .map_err(record_error)?;
    Ok(json!({ "item": { "id": item.id, "name": item.name } }))
}

static NEXT_DECODE_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Decoded samples plus a WAV file to upload to a cloud provider. A WAV made
/// from another format is temporary and removed on drop.
struct DecodedAudio {
    wav_path: std::path::PathBuf,
    temporary: bool,
    samples: Vec<i16>,
    sample_rate: u32,
}

impl Drop for DecodedAudio {
    fn drop(&mut self) {
        if self.temporary {
            let _ = std::fs::remove_file(&self.wav_path);
        }
    }
}

fn decode_audio(path: &str) -> Result<DecodedAudio, String> {
    let source = std::path::PathBuf::from(path);
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut audio = DecodedAudio {
        wav_path: source.clone(),
        temporary: ext != "wav",
        samples: Vec::new(),
        sample_rate: 0,
    };
    if audio.temporary {
        audio.wav_path = std::env::temp_dir().join(format!(
            "glimpse-transcribe-{}-{}.wav",
            std::process::id(),
            NEXT_DECODE_TEMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        crate::library::convert_to_wav(&source, &audio.wav_path, &ext, None, None, None)
            .map_err(|err| format!("Failed to decode audio: {err}"))?;
    }
    (audio.samples, audio.sample_rate) =
        crate::transcribe::load_audio_for_transcription(&audio.wav_path)
            .map_err(|err| format!("Failed to decode audio: {err}"))?;
    Ok(audio)
}

fn active_model(settings: &crate::settings::UserSettings) -> String {
    if settings.remote_speech_enabled {
        "remote".to_string()
    } else {
        settings.local_model.clone()
    }
}
