use crate::AppRuntime;
use anyhow::Result;
use tauri::WebviewWindow;

pub fn init(settings_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    settings_window.set_decorations(false)?;
    Ok(())
}
