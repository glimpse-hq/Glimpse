use anyhow::{Context, Result};
use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};

pub fn init(toast_window: &WebviewWindow) -> Result<()> {
    toast_window.set_ignore_cursor_events(false)?;
    Ok(())
}

pub fn show(toast_window: &WebviewWindow) -> Result<()> {
    // tao only honors `focus: false` on the first show; later shows use SW_SHOW,
    // which would pull focus out of the app the user is typing in. Showing it
    // first without activation makes tao's SW_SHOW a no-op, while tao still
    // records the window as visible so a later hide() works.
    let hwnd = toast_window.hwnd().context("get Windows toast HWND")?;
    unsafe {
        let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
    }
    toast_window.show()?;
    Ok(())
}

pub fn hide(toast_window: &WebviewWindow) -> Result<()> {
    toast_window.hide()?;
    Ok(())
}
