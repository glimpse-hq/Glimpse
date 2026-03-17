use std::mem::{size_of, size_of_val};

use crate::AppRuntime;
use anyhow::{anyhow, Result};
use tauri::{Manager, Runtime, Theme, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_ROUND,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, HTMAXBUTTON, WM_NCDESTROY, WM_NCHITTEST,
};

const SUBCLASS_ID: usize = 1;

/// CSS-pixel dimensions of the HTML window controls (must match WindowControls.tsx).
const BUTTON_WIDTH_CSS: i32 = 46;
const TITLEBAR_HEIGHT_CSS: i32 = 32;

/// Configure a WebviewWindowBuilder to use the dark theme and disable window decorations.
///
/// This applies the builder settings required for the custom Glimpse window appearance on Windows.
///
/// # Examples
///
/// ```
/// use tauri::{WebviewWindowBuilder, Runtime, Manager};
///
/// // assume `builder` is a previously created WebviewWindowBuilder
/// let builder = /* WebviewWindowBuilder::new(...) */ unimplemented!();
/// let builder = crate::platform::windows::glimpse_window::configure_builder(builder);
/// ```
pub fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.decorations(false).theme(Some(Theme::Dark))
}

/// Apply Windows-specific visual and interaction tweaks to a Tauri webview window.
///
/// Enables immersive dark mode and rounded window corners via DWM, and installs a subclass
/// procedure that enables Windows 11 Snap Layout behavior for the window's maximize region.
///
/// # Errors
///
/// Returns an error if the native window handle (HWND) cannot be obtained or if installing
/// the snap-layout subclass fails.
///
/// # Examples
///
/// ```no_run
/// # use tauri::Window;
/// # use crate::platform::windows::glimpse_window::configure_window;
/// // `window` is a `WebviewWindow<AppRuntime>` obtained during app setup.
/// // configure_window(&window).expect("failed to configure window");
/// ```
pub fn configure_window(window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let hwnd = super::get_hwnd(window)?;
    apply_dwm_attributes(hwnd);
    install_snap_layout_hook(hwnd)?;
    Ok(())
}

/// Applies Windows DWM attributes to enable immersive dark mode and rounded window corners for the given window handle.
///
/// This sets the DWMWA_USE_IMMERSIVE_DARK_MODE attribute to enable dark titlebar rendering and
/// the DWMWA_WINDOW_CORNER_PREFERENCE attribute to request rounded window corners. Failures from the underlying
/// DWM calls are intentionally ignored.
///
/// # Examples
///
/// ```
/// use windows::Win32::Foundation::HWND;
/// use std::ptr;
///
/// let hwnd: HWND = HWND(ptr::null_mut());
/// // Safe to call; underlying DWM failures are ignored.
/// unsafe { crate::apply_dwm_attributes(hwnd) };
/// ```
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

// Snap Layout support
//
// With decorations disabled there is no native maximize button, so Windows 11
// won't show the Snap Layout flyout.  A tiny subclass that returns HTMAXBUTTON
// for the maximize-button region is all that's needed to bring it back.

/// Installs a window subclass that enables Windows 11 snap-layout behavior for the specified HWND.
///
/// Attempts to register `snap_subclass_proc` as a subclass procedure for `hwnd`. On success the
/// function returns `Ok(())`.
///
/// # Errors
///
/// Returns an `Err` if the subclass installation via `SetWindowSubclass` fails.
///
/// # Examples
///
/// ```no_run
/// use windows::Win32::Foundation::HWND;
///
/// let hwnd: HWND = HWND(0); // replace with a valid window handle
/// install_snap_layout_hook(hwnd).expect("failed to install snap-layout hook");
/// ```
fn install_snap_layout_hook(hwnd: HWND) -> Result<()> {
    if !unsafe { SetWindowSubclass(hwnd, Some(snap_subclass_proc), SUBCLASS_ID, 0) }.as_bool() {
        return Err(anyhow!("Failed to install snap-layout subclass"));
    }
    Ok(())
}

/// Subclass window procedure that enables Windows 11 Snap Layout interaction for a frameless window.
///
/// - On `WM_NCHITTEST`, returns `HTMAXBUTTON` when the cursor is over the maximize button area so the system can show Snap Layout; otherwise delegates to the default subclass procedure.
/// - On `WM_NCDESTROY`, removes this subclass and delegates to the default subclass procedure.
/// - For all other messages, delegates to the default subclass procedure.
///
/// # Examples
///
/// ```no_run
/// use windows::Win32::UI::WindowsAndMessaging::SetWindowSubclass;
/// // `hwnd` is an existing window handle.
/// unsafe {
///     // Install the subclass so `snap_subclass_proc` can intercept hit tests.
///     let _ = SetWindowSubclass(hwnd, Some(snap_subclass_proc), SUBCLASS_ID, 0);
/// }
/// ```
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

/// Determines whether the cursor position encoded in `lparam` lies over the window's maximize button area.
///
/// The function reads the window rectangle and DPI for `hwnd`, converts the cursor coordinates from
/// screen space to window-relative coordinates, scales the configured control sizes (CSS pixels)
/// by the window DPI, and checks whether the point lies within the maximize button region
/// (the second button from the right along the titlebar).
///
/// # Returns
///
/// `true` if the cursor is inside the maximize button bounds, `false` otherwise or if the window rect cannot be obtained.
///
/// # Examples
///
/// ```
/// // On platforms where `GetWindowRect` fails for HWND(0), this will be false.
/// let hit = is_over_maximize_button(windows::Win32::Foundation::HWND(0), windows::Win32::Foundation::LPARAM(0));
/// assert_eq!(hit, false);
/// ```
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
