use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{AppHandle, WebviewWindow};
use windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

pub fn init(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;

    unsafe {
        SetLastError(WIN32_ERROR(0));
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ex_style == 0 && GetLastError() != WIN32_ERROR(0) {
            return Err(anyhow!("GetWindowLongW failed: {:?}", GetLastError()));
        }
        let new_style = ex_style as u32 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_NOACTIVATE.0;
        SetLastError(WIN32_ERROR(0));
        let updated = SetWindowLongW(hwnd, GWL_EXSTYLE, new_style as i32);
        if updated == 0 && GetLastError() != WIN32_ERROR(0) {
            return Err(anyhow!("SetWindowLongW failed: {:?}", GetLastError()));
        }

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

pub fn show(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;
    super::show_topmost(hwnd)
}

pub fn hide(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;
    super::hide_window(hwnd);
    Ok(())
}
