use std::mem::{size_of, size_of_val};

use crate::AppRuntime;
use anyhow::{anyhow, Context, Result};
use tauri::{Manager, Runtime, Theme, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmDefWindowProc, DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{
    DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsZoomed, SetWindowPos, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTCAPTION,
    HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT, NCCALCSIZE_PARAMS, SM_CXFRAME,
    SM_CXPADDEDBORDER, SM_CYSIZEFRAME, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WM_NCCALCSIZE, WM_NCDESTROY, WM_NCHITTEST,
};

const TITLEBAR_HEIGHT_DIP: i32 = 32;
const GLIMPSE_SUBCLASS_ID: usize = 1;

#[derive(Clone, Copy)]
struct FrameMetrics {
    horizontal_frame: i32,
    vertical_frame: i32,
    drag_band_height: i32,
}

pub fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.theme(Some(Theme::Dark))
}

pub fn configure_window(window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(window)?;

    let _ = window.set_theme(Some(Theme::Dark));
    apply_optional_dwm_attributes(hwnd);
    install_custom_chrome(hwnd)?;
    refresh_frame(hwnd)?;

    Ok(())
}

fn install_custom_chrome(hwnd: HWND) -> Result<()> {
    if unsafe { GetWindowSubclass(hwnd, Some(glimpse_subclass_proc), GLIMPSE_SUBCLASS_ID, None) }
        .as_bool()
    {
        return Ok(());
    }

    if !unsafe { SetWindowSubclass(hwnd, Some(glimpse_subclass_proc), GLIMPSE_SUBCLASS_ID, 0) }
        .as_bool()
    {
        return Err(anyhow!("Failed to install the Glimpse window subclass"));
    }

    Ok(())
}

fn refresh_frame(hwnd: HWND) -> Result<()> {
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .context("Failed to refresh the Glimpse window frame")?;
    }

    Ok(())
}

fn apply_optional_dwm_attributes(hwnd: HWND) {
    let dark_mode: i32 = 1;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as _,
            size_of::<i32>() as u32,
        )
    };

    let rounded_corners = DWMWCP_ROUND;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &rounded_corners as *const _ as _,
            size_of_val(&rounded_corners) as u32,
        )
    };
}

unsafe extern "system" fn glimpse_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    // Let DWM own the caption buttons while we extend the client area through the title band.
    let mut dwm_result = LRESULT(0);
    if unsafe { DwmDefWindowProc(hwnd, msg, wparam, lparam, &mut dwm_result).as_bool() } {
        return dwm_result;
    }

    match msg {
        WM_NCCALCSIZE if wparam.0 != 0 => {
            handle_nccalcsize(hwnd, lparam);
            return LRESULT(0);
        }
        WM_NCHITTEST => return hit_test_nca(hwnd, lparam),
        WM_NCDESTROY => {
            unsafe { RemoveWindowSubclass(hwnd, Some(glimpse_subclass_proc), GLIMPSE_SUBCLASS_ID) };
        }
        _ => {}
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn handle_nccalcsize(hwnd: HWND, lparam: LPARAM) {
    if lparam.0 == 0 {
        return;
    }

    let metrics = frame_metrics(hwnd);
    let params = unsafe { &mut *(lparam.0 as *mut NCCALCSIZE_PARAMS) };

    params.rgrc[0].left += metrics.horizontal_frame;
    params.rgrc[0].right -= metrics.horizontal_frame;
    params.rgrc[0].bottom -= metrics.vertical_frame;

    if unsafe { IsZoomed(hwnd).as_bool() } {
        params.rgrc[0].top += metrics.vertical_frame;
    }
}

fn hit_test_nca(hwnd: HWND, lparam: LPARAM) -> LRESULT {
    let mut window_rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut window_rect) }.is_err() {
        return LRESULT(HTCLIENT as isize);
    }

    let metrics = frame_metrics(hwnd);
    let x = get_x_lparam(lparam) - window_rect.left;
    let y = get_y_lparam(lparam) - window_rect.top;
    let width = window_rect.right - window_rect.left;
    let height = window_rect.bottom - window_rect.top;
    let is_maximized = unsafe { IsZoomed(hwnd).as_bool() };

    if !is_maximized {
        let on_left = x < metrics.horizontal_frame;
        let on_right = x >= width - metrics.horizontal_frame;
        let on_top = y < metrics.vertical_frame;
        let on_bottom = y >= height - metrics.vertical_frame;

        if on_top && on_left {
            return LRESULT(HTTOPLEFT as isize);
        }
        if on_top && on_right {
            return LRESULT(HTTOPRIGHT as isize);
        }
        if on_bottom && on_left {
            return LRESULT(HTBOTTOMLEFT as isize);
        }
        if on_bottom && on_right {
            return LRESULT(HTBOTTOMRIGHT as isize);
        }
        if on_top {
            return LRESULT(HTTOP as isize);
        }
        if on_bottom {
            return LRESULT(HTBOTTOM as isize);
        }
        if on_left {
            return LRESULT(HTLEFT as isize);
        }
        if on_right {
            return LRESULT(HTRIGHT as isize);
        }
    }

    if y >= 0 && y < metrics.drag_band_height {
        return LRESULT(HTCAPTION as isize);
    }

    LRESULT(HTCLIENT as isize)
}

fn frame_metrics(hwnd: HWND) -> FrameMetrics {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    let horizontal_frame = unsafe {
        GetSystemMetricsForDpi(SM_CXFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
    };
    let vertical_frame = unsafe {
        GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
    };

    FrameMetrics {
        horizontal_frame,
        vertical_frame,
        drag_band_height: scale_dip(TITLEBAR_HEIGHT_DIP, dpi),
    }
}

fn scale_dip(value: i32, dpi: u32) -> i32 {
    let dpi = dpi as i32;
    ((value * dpi) + 48) / 96
}

fn get_x_lparam(lparam: LPARAM) -> i32 {
    (lparam.0 as u32 & 0xFFFF) as i16 as i32
}

fn get_y_lparam(lparam: LPARAM) -> i32 {
    ((lparam.0 as u32 >> 16) & 0xFFFF) as i16 as i32
}
