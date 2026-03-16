pub mod hotkeys;
pub mod menu;
pub mod overlay;
pub mod toast;

use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE,
    SW_SHOWNOACTIVATE,
};

pub(crate) fn get_hwnd(window: &WebviewWindow<AppRuntime>) -> Result<HWND> {
    let raw = window
        .hwnd()
        .map_err(|e| anyhow!("Failed to get HWND: {e}"))?;
    Ok(HWND(raw.0))
}

pub(crate) fn show_topmost(hwnd: HWND) -> Result<()> {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|e| anyhow!("SetWindowPos failed: {e}"))?;
    }
    Ok(())
}

pub(crate) fn hide_window(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}
