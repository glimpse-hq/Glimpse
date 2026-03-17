use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{AppHandle, WebviewWindow};
use windows::Win32::Foundation::{GetLastError, SetLastError, WIN32_ERROR};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

/// Configure the toast webview window as a topmost tool window that does not activate when shown.
///
/// Sets the window's extended styles to include tool-window, topmost, and no-activate, and positions
/// it as topmost without moving or resizing. Returns an error if underlying Windows API calls fail
/// (for example, if `GetWindowLongW` or `SetWindowPos` report an error).
///
/// # Examples
///
/// ```no_run
/// # use anyhow::Result;
/// # use tauri::AppHandle;
/// # use tauri::WebviewWindow;
/// # use crate::AppRuntime;
/// fn example(app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
///     // Initialize the toast window so it becomes a topmost, non-activating tool window.
///     crate::platform::windows::toast::init(app, toast_window)
/// }
/// ```
pub fn init(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;

    unsafe {
        SetLastError(WIN32_ERROR(0));
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ex_style == 0 && GetLastError() != WIN32_ERROR(0) {
            return Err(anyhow!("GetWindowLongW failed: {:?}", GetLastError()));
        }
        let new_style = ex_style as u32 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_NOACTIVATE.0;
        SetWindowLongW(hwnd, GWL_EXSTYLE, new_style as i32);

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

/// Shows the toast window as a topmost window.
///
/// # Returns
///
/// `Ok(())` if the window was shown successfully, `Err` containing the underlying error otherwise.
///
/// # Examples
///
/// ```ignore
/// // Obtain an AppHandle and WebviewWindow from your tauri application context.
/// show(&app_handle, &toast_window)?;
/// ```
pub fn show(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;
    super::show_topmost(hwnd)
}

/// Hides the toast window associated with `toast_window`.
///
/// This obtains the native window handle and requests that the toast window be hidden. If obtaining
/// the window handle fails, an `Err` is returned; errors from the underlying hide operation are
/// not propagated.
///
/// # Examples
///
/// ```
/// // `app` and `toast_window` are obtained from the Tauri runtime in real use.
/// // let app: AppHandle<AppRuntime> = ...;
/// // let toast_window: WebviewWindow<AppRuntime> = ...;
/// // let _ = hide(&app, &toast_window);
/// ```
pub fn hide(_app: &AppHandle<AppRuntime>, toast_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(toast_window)?;
    super::hide_window(hwnd);
    Ok(())
}
