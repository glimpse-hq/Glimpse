use crate::native_ui::window::{Handler, Options, WindowEvent};
use anyhow::Context;
use parking_lot::Mutex;
use std::ffi::c_void;
use std::num::NonZeroIsize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize, Position};
use wgpu::rwh;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
    MonitorFromWindow,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::WM_MOUSELEAVE;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    ReleaseCapture, SetCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GWLP_USERDATA, GetClientRect, GetCursorPos, GetWindowLongPtrW,
    GetWindowRect, HWND_TOPMOST, IDC_ARROW, LoadCursorW, MA_NOACTIVATE, RegisterClassExW, SW_HIDE,
    SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, WHEEL_DELTA, WM_DPICHANGED, WM_LBUTTONDOWN,
    WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WNDCLASSEXW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};
use windows::core::{PCWSTR, w};

const CLASS: PCWSTR = w!("GlimpseNativeWindow");
// Three 10 pt lines per wheel notch, Windows' default.
const NOTCH: f64 = 30.0;

struct State {
    handler: Mutex<Option<Handler>>,
    tracking: AtomicBool,
}

pub struct Window {
    hwnd: isize,
    // Points; each move sizes the window for its monitor's scale.
    size: Mutex<(f64, f64)>,
    state: Arc<State>,
}

fn scale_of(hwnd: HWND) -> f64 {
    f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.0
}

fn monitor_frame(monitor: HMONITOR) -> anyhow::Result<(RECT, f64)> {
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe { GetMonitorInfoW(monitor, &mut info) }
        .ok()
        .context("read monitor bounds")?;
    let (mut dpi, mut dpi_y) = (0, 0);
    unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut dpi_y) }
        .context("read monitor DPI")?;
    Ok((info.rcMonitor, f64::from(dpi) / 96.0))
}

fn window_rect(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    let _ = unsafe { GetWindowRect(hwnd, &mut rect) };
    rect
}

impl Window {
    pub fn new(options: Options) -> anyhow::Result<Self> {
        static REGISTER: std::sync::Once = std::sync::Once::new();
        let instance = unsafe { GetModuleHandleW(None) }.context("get module handle")?;
        REGISTER.call_once(|| {
            let class = WNDCLASSEXW {
                cbSize: size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(window_proc),
                hInstance: instance.into(),
                hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default(),
                lpszClassName: CLASS,
                ..Default::default()
            };
            unsafe { RegisterClassExW(&class) };
        });

        let mut ex_style =
            WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_NOREDIRECTIONBITMAP;
        if !options.interactive {
            ex_style |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
        }
        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                CLASS,
                w!(""),
                WS_POPUP,
                0,
                0,
                options.size.0.round() as i32,
                options.size.1.round() as i32,
                None,
                None,
                Some(instance.into()),
                None,
            )
        }
        .context("create native window")?;
        let state = Arc::new(State {
            handler: Mutex::new(None),
            tracking: AtomicBool::new(false),
        });
        // The window is never destroyed, so this reference is never released.
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, Arc::into_raw(state.clone()) as isize) };
        Ok(Self {
            hwnd: hwnd.0 as isize,
            size: Mutex::new(options.size),
            state,
        })
    }

    fn hwnd(&self) -> HWND {
        HWND(self.hwnd as *mut c_void)
    }

    fn pixels(&self, scale: f64) -> (i32, i32) {
        let (width, height) = *self.size.lock();
        (
            (width * scale).round() as i32,
            (height * scale).round() as i32,
        )
    }

    pub fn set_size(&self, size: (f64, f64)) -> anyhow::Result<()> {
        *self.size.lock() = size;
        let (width, height) = self.pixels(scale_of(self.hwnd()));
        unsafe {
            SetWindowPos(
                self.hwnd(),
                None,
                0,
                0,
                width,
                height,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            )
        }
        .context("resize native window")
    }

    pub fn place_bottom_center(
        &self,
        other: Option<&Window>,
        bottom_margin: f64,
    ) -> anyhow::Result<()> {
        let monitor = match other {
            Some(other) => unsafe { MonitorFromWindow(other.hwnd(), MONITOR_DEFAULTTONEAREST) },
            None => {
                let mut cursor = POINT::default();
                unsafe { GetCursorPos(&mut cursor) }.context("read cursor position")?;
                unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) }
            }
        };
        let (area, scale) = monitor_frame(monitor)?;
        let (width, height) = self.pixels(scale);
        let x = area.left + (area.right - area.left - width) / 2;
        let y = area.bottom - (bottom_margin * scale).round() as i32 - height;
        unsafe {
            SetWindowPos(
                self.hwnd(),
                None,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        }
        .context("place native window")
    }

    // Windows positions are pixels on one virtual screen, whatever the monitor's scale.
    pub fn set_position_physical(
        &self,
        position: PhysicalPosition<i32>,
        _scale: f64,
    ) -> anyhow::Result<()> {
        let point = POINT {
            x: position.x,
            y: position.y,
        };
        let (_, scale) =
            monitor_frame(unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) })?;
        let (width, height) = self.pixels(scale);
        unsafe {
            SetWindowPos(
                self.hwnd(),
                None,
                position.x,
                position.y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        }
        .context("move native window")
    }

    pub fn show(&self) -> anyhow::Result<()> {
        unsafe {
            let _ = ShowWindow(self.hwnd(), SW_SHOWNOACTIVATE);
            SetWindowPos(
                self.hwnd(),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        }
        .context("show native window")
    }

    pub fn position(&self) -> Position {
        self.frame_physical().position.into()
    }

    pub fn hide(&self) -> anyhow::Result<()> {
        let _ = unsafe { ShowWindow(self.hwnd(), SW_HIDE) };
        Ok(())
    }

    pub fn metrics(&self) -> (u32, u32, f64) {
        let mut rect = RECT::default();
        let _ = unsafe { GetClientRect(self.hwnd(), &mut rect) };
        (
            (rect.right - rect.left).max(0) as u32,
            (rect.bottom - rect.top).max(0) as u32,
            scale_of(self.hwnd()),
        )
    }

    pub fn native_id(&self) -> i64 {
        self.hwnd as i64
    }

    pub fn contains_cursor(&self) -> bool {
        let mut cursor = POINT::default();
        if unsafe { GetCursorPos(&mut cursor) }.is_err() {
            return false;
        }
        let rect = window_rect(self.hwnd());
        cursor.x >= rect.left
            && cursor.x < rect.right
            && cursor.y >= rect.top
            && cursor.y < rect.bottom
    }

    pub fn frame_physical(&self) -> PhysicalRect<i32, u32> {
        let rect = window_rect(self.hwnd());
        PhysicalRect {
            position: PhysicalPosition::new(rect.left, rect.top),
            size: PhysicalSize::new(
                (rect.right - rect.left).max(0) as u32,
                (rect.bottom - rect.top).max(0) as u32,
            ),
        }
    }

    pub fn set_handler(&self, handler: Handler) {
        *self.state.handler.lock() = Some(handler);
    }

    pub fn raw_window_handle(&self) -> rwh::RawWindowHandle {
        let hwnd = NonZeroIsize::new(self.hwnd).expect("the window exists");
        rwh::RawWindowHandle::Win32(rwh::Win32WindowHandle::new(hwnd))
    }
}

fn lparam_point(hwnd: HWND, lparam: LPARAM) -> (f64, f64) {
    let scale = scale_of(hwnd);
    let x = f64::from(lparam.0 as u16 as i16);
    let y = f64::from((lparam.0 >> 16) as u16 as i16);
    (x / scale, y / scale)
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        // The display's scale changed under the window: take the rectangle Windows suggests.
        WM_DPICHANGED => {
            // SAFETY: for WM_DPICHANGED, lParam points to the suggested window rectangle.
            let rect = unsafe { *(lparam.0 as *const RECT) };
            let _ = unsafe {
                SetWindowPos(
                    hwnd,
                    None,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                )
            };
            return LRESULT(0);
        }
        WM_MOUSEMOVE | WM_MOUSELEAVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_MOUSEWHEEL => {
            let state = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const State;
            // SAFETY: set right after creation from an Arc that is never released.
            if let Some(state) = unsafe { state.as_ref() } {
                mouse(state, hwnd, message, wparam, lparam);
                return LRESULT(0);
            }
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn mouse(state: &State, hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) {
    let event = match message {
        WM_MOUSEMOVE => {
            if !state.tracking.swap(true, Ordering::Relaxed) {
                let mut track = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                let _ = unsafe { TrackMouseEvent(&mut track) };
            }
            let (x, y) = lparam_point(hwnd, lparam);
            WindowEvent::MouseMoved { x, y }
        }
        WM_MOUSELEAVE => {
            state.tracking.store(false, Ordering::Relaxed);
            WindowEvent::MouseExited
        }
        WM_LBUTTONDOWN => {
            // Keeps the matching button-up coming here when it's released outside.
            unsafe { SetCapture(hwnd) };
            let (x, y) = lparam_point(hwnd, lparam);
            WindowEvent::MouseDown { x, y }
        }
        WM_LBUTTONUP => {
            let _ = unsafe { ReleaseCapture() };
            let (x, y) = lparam_point(hwnd, lparam);
            WindowEvent::MouseUp { x, y }
        }
        _ => {
            let delta = f64::from((wparam.0 >> 16) as u16 as i16);
            WindowEvent::Scroll {
                dy: delta / f64::from(WHEEL_DELTA) * NOTCH,
            }
        }
    };
    let handler = state.handler.lock().clone();
    if let Some(handler) = handler {
        handler(event);
    }
}
