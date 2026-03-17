use std::mem::size_of;

use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{Manager, Runtime, Theme, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, HTMAXBUTTON, WM_NCDESTROY, WM_NCHITTEST,
};

const SUBCLASS_ID: usize = 1;

/// CSS-pixel dimensions of the HTML window controls (must match WindowControls.tsx).
const BUTTON_WIDTH_CSS: i32 = 46;
const TITLEBAR_HEIGHT_CSS: i32 = 32;

pub fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.decorations(false).theme(Some(Theme::Dark))
}

pub fn configure_window(window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(window)?;
    apply_dwm_attributes(hwnd);
    install_snap_layout_hook(hwnd)?;
    Ok(())
}

fn apply_dwm_attributes(hwnd: HWND) {
    let dark_mode: i32 = 1;
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as _,
            size_of::<i32>() as u32,
        )
    };
}

// Snap Layout support
//
// With decorations disabled there is no native maximize button, so Windows 11
// won't show the Snap Layout flyout.  A tiny subclass that returns HTMAXBUTTON
// for the maximize-button region is all that's needed to bring it back.

fn install_snap_layout_hook(hwnd: HWND) -> Result<()> {
    if !unsafe { SetWindowSubclass(hwnd, Some(snap_subclass_proc), SUBCLASS_ID, 0) }.as_bool() {
        return Err(anyhow!("Failed to install snap-layout subclass"));
    }
    Ok(())
}

unsafe extern "system" fn snap_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_NCHITTEST => {
            if is_over_maximize_button(hwnd, lparam) {
                return LRESULT(HTMAXBUTTON as isize);
            }
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }
        WM_NCDESTROY => {
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(snap_subclass_proc), SUBCLASS_ID) };
            unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
        }
        _ => unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
    }
}

fn is_over_maximize_button(hwnd: HWND, lparam: LPARAM) -> bool {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }

    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as f64;
    let scale = dpi / 96.0;

    let cursor_x = (lparam.0 as u32 & 0xFFFF) as i16 as i32;
    let cursor_y = ((lparam.0 as u32 >> 16) & 0xFFFF) as i16 as i32;

    let x = cursor_x - rect.left;
    let y = cursor_y - rect.top;
    let width = rect.right - rect.left;

    let btn_w = (BUTTON_WIDTH_CSS as f64 * scale) as i32;
    let btn_h = (TITLEBAR_HEIGHT_CSS as f64 * scale) as i32;

    // Maximize button is the second button from the right edge.
    let max_left = width - 2 * btn_w;
    let max_right = width - btn_w;

    x >= max_left && x < max_right && y >= 0 && y < btn_h
}
