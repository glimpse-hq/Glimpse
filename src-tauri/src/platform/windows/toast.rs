use anyhow::Result;
use tauri::WebviewWindow;

pub fn init(toast_window: &WebviewWindow) -> Result<()> {
    toast_window.set_ignore_cursor_events(false)?;
    Ok(())
}

pub fn show(toast_window: &WebviewWindow) -> Result<()> {
    toast_window.show()?;
    Ok(())
}

pub fn hide(toast_window: &WebviewWindow) -> Result<()> {
    toast_window.hide()?;
    Ok(())
}
