use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{AppRuntime, AppState};

const AUTH_CALLBACK_EVENT: &str = "auth:callback-code";

/// Retrieve and remove a pending auth callback code from the application state.
///
/// This reads the AppState stored in the provided `AppHandle`, takes any pending
/// auth callback code (removing it from state) and returns it.
///
/// # Returns
///
/// `Some(code)` if a pending callback code was stored, `None` if no code was pending, or
/// `Err(String)` containing an error message on failure.
///
/// # Examples
///
/// ```no_run
/// # use tauri::{AppHandle, Runtime};
/// # async fn example(app: AppHandle<impl Runtime>) {
/// let code_opt = take_pending_auth_callback_code(app).await.unwrap();
/// if let Some(code) = code_opt {
///     println!("received auth code: {}", code);
/// }
/// # }
/// ```
#[tauri::command]
pub async fn take_pending_auth_callback_code(
    app: AppHandle<AppRuntime>,
) -> Result<Option<String>, String> {
    Ok(app.state::<AppState>().take_pending_auth_callback_code())
}

/// Registers deep-link handling for authentication callbacks.
///
/// Processes any deep-link URLs that are already available and subscribes to future URL open events. When a valid auth callback code is found in a URL, it is stored in the app state and emitted via `AUTH_CALLBACK_EVENT`.
///
/// # Examples
///
/// ```no_run
/// // Given a valid `AppHandle<AppRuntime>` named `app`:
/// register_auth_callback_bridge(&app);
/// ```
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

/// Processes deep-link URLs to find an authentication callback code, stores the first found code in application state, and emits an `AUTH_CALLBACK_EVENT` with that code.
///
/// The function iterates the provided `urls`, extracts the first valid `code` parameter from a URL that matches the expected auth callback pattern, stores it in `AppState` as the pending auth callback code, emits `AUTH_CALLBACK_EVENT` with the code, and then stops processing further URLs. URLs that do not contain a valid code are ignored. Emission failures are logged to stderr.
///
/// # Examples
///
/// ```ignore
/// // Given a Tauri app handle `app`, call with one or more deep-link URLs:
/// process_auth_callback_urls(&app, vec![url::Url::parse("glimpse://callback?code=abc123").unwrap()]);
/// ```
fn process_auth_callback_urls(app: &AppHandle<AppRuntime>, urls: Vec<url::Url>) {
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

/// Extracts the non-empty `code` query parameter from a deep-link URL when it matches the expected callback format.
///
/// The URL must use the `glimpse` scheme, have host `callback`, and a path of `""`, `/`, or `/auth`. If those conditions are met and a `code` query parameter exists with a non-empty value, that value is returned.
///
/// # Examples
///
/// ```
/// use url::Url;
///
/// let u = Url::parse("glimpse://callback/auth?code=abc123").unwrap();
/// assert_eq!(extract_auth_callback_code(&u), Some("abc123".to_string()));
///
/// let missing = Url::parse("glimpse://callback/auth").unwrap();
/// assert_eq!(extract_auth_callback_code(&missing), None);
///
/// let wrong = Url::parse("https://callback/auth?code=abc123").unwrap();
/// assert_eq!(extract_auth_callback_code(&wrong), None);
/// ```
fn extract_auth_callback_code(url: &url::Url) -> Option<String> {
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
