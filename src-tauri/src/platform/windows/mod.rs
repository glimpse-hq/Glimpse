pub mod glimpse_window;
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

/// Retrieve the native Windows HWND for the given Tauri webview window.
///
/// # Errors
/// Returns an `anyhow::Error` if the webview's native handle cannot be obtained.
///
/// # Examples
///
/// ```
/// // `window` is a `tauri::WebviewWindow<AppRuntime>`
/// let hwnd = get_hwnd(&window).expect("failed to get HWND");
/// assert!(hwnd.0 != 0);
/// ```
pub(crate) fn get_hwnd(window: &WebviewWindow<AppRuntime>) -> Result<HWND> {
    let raw = window
        .hwnd()
        .map_err(|e| anyhow!("Failed to get HWND: {e}"))?;
    Ok(HWND(raw.0))
}

/// Makes the given window topmost and shows it without activating it.
///
/// # Errors
///
/// Returns an `anyhow::Error` if the underlying `SetWindowPos` call fails.
///
/// # Examples
///
/// ```no_run
/// use windows_sys::Win32::Foundation::HWND;
/// // `hwnd` should be obtained from a valid WebviewWindow or other native source.
/// let hwnd: HWND = /* obtain HWND */ 0 as HWND;
/// let _ = crate::platform::windows::show_topmost(hwnd);
/// ```
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

/// Hides the specified native window handle without returning an error.
///
/// # Parameters
///
/// - `hwnd`: The native window handle to hide.
///
/// # Examples
///
/// ```
/// // assuming `hwnd` was obtained via `get_hwnd(&window)`
/// hide_window(hwnd);
/// ```
pub(crate) fn hide_window(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}
