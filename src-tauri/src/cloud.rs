use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{AppRuntime, AppState};

const AUTH_CALLBACK_EVENT: &str = "auth:callback-code";

#[tauri::command]
pub async fn take_pending_auth_callback_code(
    app: AppHandle<AppRuntime>,
) -> Result<Option<String>, String> {
    Ok(app.state::<AppState>().take_pending_auth_callback_code())
}

pub fn register_auth_callback_bridge(app: &AppHandle<AppRuntime>) {
    match app.deep_link().get_current() {
        Ok(Some(urls)) => process_auth_callback_urls(app, urls),
        Ok(None) => {}
        Err(err) => eprintln!("Failed to read initial deep-link state: {err}"),
    }

    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        process_auth_callback_urls(&handle, event.urls());
    });
}

fn process_auth_callback_urls(app: &AppHandle<AppRuntime>, urls: Vec<reqwest::Url>) {
    for url in urls {
        let Some(code) = extract_auth_callback_code(&url) else {
            continue;
        };
        app.state::<AppState>()
            .store_pending_auth_callback_code(code.clone());
        if let Err(err) = app.emit(AUTH_CALLBACK_EVENT, code) {
            eprintln!("Failed to emit auth callback event: {err}");
        }
        break;
    }
}

fn extract_auth_callback_code(url: &reqwest::Url) -> Option<String> {
    if url.scheme() != "glimpse" || url.host_str() != Some("callback") {
        return None;
    }

    match url.path() {
        "" | "/" | "/auth" => {}
        _ => return None,
    }

    let code = url
        .query_pairs()
        .find_map(|(key, value)| (key == "code").then(|| value.into_owned()))?;
    (!code.is_empty()).then_some(code)
}
