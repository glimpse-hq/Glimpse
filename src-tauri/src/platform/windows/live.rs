use anyhow::Result;
use tauri::WebviewWindow;

pub fn init(_live_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

pub fn show(live_window: &WebviewWindow) -> Result<()> {
    live_window.show()?;
    Ok(())
}

pub fn hide(live_window: &WebviewWindow) -> Result<()> {
    live_window.hide()?;
    Ok(())
}
