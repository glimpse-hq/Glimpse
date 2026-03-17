use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{AppHandle, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT,
};

/// Configures the overlay window as a non-activating, transparent, layered tool window and places it topmost without moving or resizing.
///
/// Applies the extended window styles WS_EX_LAYERED, WS_EX_TRANSPARENT, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, and WS_EX_NOACTIVATE to the provided overlay window and then calls SetWindowPos with SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE to keep it topmost without changing its position or size.
///
/// # Errors
///
/// Returns an error if obtaining the native window handle or calling SetWindowPos fails.
///
/// # Examples
///
/// ```no_run
/// // assume `app` and `overlay` are available in scope
/// init(&app, &overlay).unwrap();
/// ```
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

/// Makes the given overlay window visible and places it above normal windows.
///
/// # Errors
///
/// Returns an error if the window handle cannot be obtained or if the attempt to make the window topmost fails.
///
/// # Examples
///
/// ```no_run
/// # use tauri::AppHandle;
/// # use tauri::Window;
/// # fn example(app: &AppHandle<tauri::AppRuntime>, overlay: &tauri::Window) -> anyhow::Result<()> {
/// // assuming `show` is imported from this module
/// show(app, overlay)?;
/// # Ok(())
/// # }
/// ```
pub fn show(
    _app: &AppHandle<AppRuntime>,
    overlay_window: &WebviewWindow<AppRuntime>,
) -> Result<()> {
    let hwnd = super::get_hwnd(overlay_window)?;
    super::show_topmost(hwnd)
}

/// Hides the overlay window represented by `overlay_window`.
///
/// # Returns
///
/// `Ok(())` if the window was successfully hidden; `Err` if obtaining the window handle fails.
pub fn hide(
    _app: &AppHandle<AppRuntime>,
    overlay_window: &WebviewWindow<AppRuntime>,
) -> Result<()> {
    let hwnd = super::get_hwnd(overlay_window)?;
    super::hide_window(hwnd);
    Ok(())
}
