use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{AppHandle, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT,
};

pub fn init(
    _app: &AppHandle<AppRuntime>,
    overlay_window: &WebviewWindow<AppRuntime>,
) -> Result<()> {
    let hwnd = super::get_hwnd(overlay_window)?;

    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let new_style = ex_style
            | WS_EX_LAYERED.0
            | WS_EX_TRANSPARENT.0
            | WS_EX_TOOLWINDOW.0
            | WS_EX_TOPMOST.0
            | WS_EX_NOACTIVATE.0;
        SetWindowLongW(hwnd, GWL_EXSTYLE, new_style as i32);

        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
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

pub fn show(
    _app: &AppHandle<AppRuntime>,
    overlay_window: &WebviewWindow<AppRuntime>,
) -> Result<()> {
    let hwnd = super::get_hwnd(overlay_window)?;
    super::show_topmost(hwnd)
}

pub fn hide(
    _app: &AppHandle<AppRuntime>,
    overlay_window: &WebviewWindow<AppRuntime>,
) -> Result<()> {
    let hwnd = super::get_hwnd(overlay_window)?;
    super::hide_window(hwnd);
    Ok(())
}
