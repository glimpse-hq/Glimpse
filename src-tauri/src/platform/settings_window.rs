use crate::AppRuntime;
use tauri::WebviewWindow;

pub fn init(settings_window: &WebviewWindow<AppRuntime>) {
    #[cfg(not(target_os = "windows"))]
    let _ = settings_window;

    #[cfg(target_os = "windows")]
    if let Err(err) = crate::platform::windows::settings_window::init(settings_window) {
        eprintln!("Failed to initialize Windows settings window chrome: {err}");
    }
}
