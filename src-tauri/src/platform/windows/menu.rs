use crate::settings::UserSettings;
use crate::AppRuntime;
use tauri::AppHandle;

pub fn set_app_menu(_app: &AppHandle<AppRuntime>, _settings: &UserSettings) -> tauri::Result<()> {
    Ok(())
}

pub fn handle_menu_event(_app: &AppHandle<AppRuntime>, _id: &str) {}
