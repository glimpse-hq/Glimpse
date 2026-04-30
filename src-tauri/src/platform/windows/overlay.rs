use crate::AppRuntime;
use anyhow::{Context, Result};
use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    SW_SHOWNOACTIVATE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

pub fn init(overlay_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    overlay_window.set_ignore_cursor_events(true)?;
    configure_overlay_window(overlay_window)?;
    Ok(())
}

pub fn show(overlay_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    configure_overlay_window(overlay_window)?;
    let hwnd = native_hwnd(overlay_window)?;

    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .context("show Windows overlay without activation")?;
    }

    Ok(())
}

pub fn hide(overlay_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = native_hwnd(overlay_window)?;

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
        )
        .context("hide Windows overlay without activation")?;
    }

    Ok(())
}

fn configure_overlay_window(overlay_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = native_hwnd(overlay_window)?;

    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next = (current | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0)
            & !WS_EX_APPWINDOW.0;

        if next != current {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            .context("apply Windows overlay extended styles")?;
        }
    }

    Ok(())
}

fn native_hwnd(overlay_window: &WebviewWindow<AppRuntime>) -> Result<HWND> {
    let hwnd = overlay_window.hwnd().context("get Windows overlay HWND")?;
    Ok(HWND(hwnd.0))
}
