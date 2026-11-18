use crate::AppRuntime;
#[cfg(target_os = "macos")]
use crate::platform::macos::native_window as platform;
#[cfg(target_os = "windows")]
use crate::platform::windows::native_window as platform;
use std::sync::Arc;
use tauri::{AppHandle, PhysicalPosition, PhysicalRect, Position};
use wgpu::rwh;

/// A borderless, transparent, always-on-top window of our own that never takes focus.
#[derive(Clone)]
pub struct NativeWindow {
    app: AppHandle<AppRuntime>,
    inner: Arc<platform::Window>,
}

#[derive(Clone, Copy)]
pub struct Options {
    /// Width and height in points.
    pub size: (f64, f64),
    /// False lets every click through; true takes mouse events without activating the app.
    pub interactive: bool,
}

pub enum ScreenChoice<'a> {
    UnderCursor,
    SameAs(&'a NativeWindow),
}

/// Mouse input in points from the window's top-left corner.
#[derive(Clone, Copy, Debug)]
pub enum WindowEvent {
    MouseMoved {
        x: f64,
        y: f64,
    },
    MouseExited,
    MouseDown {
        x: f64,
        y: f64,
    },
    MouseUp {
        x: f64,
        y: f64,
    },
    /// Positive scrolls toward the top.
    Scroll {
        dy: f64,
    },
}

pub type Handler = Arc<dyn Fn(WindowEvent) + Send + Sync>;

impl NativeWindow {
    /// Creates the hidden window on the main thread, waiting for it when called from another.
    pub fn new(app: &AppHandle<AppRuntime>, options: Options) -> anyhow::Result<Self> {
        let window = if std::thread::current().name() == Some("main") {
            platform::Window::new(options)?
        } else {
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            app.run_on_main_thread(move || {
                let _ = sender.send(platform::Window::new(options));
            })?;
            receiver.recv()??
        };
        Ok(Self {
            app: app.clone(),
            inner: Arc::new(window),
        })
    }

    // Queued in order, so a show after a move draws at the new place and scale.
    fn on_main(
        &self,
        apply: impl FnOnce(&platform::Window) -> anyhow::Result<()> + Send + 'static,
    ) {
        let inner = self.inner.clone();
        let queued = self.app.run_on_main_thread(move || {
            if let Err(err) = apply(&inner) {
                tracing::error!("[NativeWindow] {err:#}");
            }
        });
        if let Err(err) = queued {
            tracing::error!("[NativeWindow] {err}");
        }
    }

    /// Centers the window on a monitor's full frame, its bottom edge `bottom_margin` points
    /// above the monitor's bottom, sized for that monitor's scale.
    pub fn place_bottom_center(&self, screen: ScreenChoice, bottom_margin: f64) {
        let other = match screen {
            ScreenChoice::UnderCursor => None,
            ScreenChoice::SameAs(other) => Some(other.inner.clone()),
        };
        self.on_main(move |window| window.place_bottom_center(other.as_deref(), bottom_margin));
    }

    /// Puts the window in front without activating anything, then calls `on_screen` once it is up.
    pub fn show(&self, on_screen: impl FnOnce() + Send + 'static) {
        self.on_main(move |window| {
            window.show()?;
            on_screen();
            Ok(())
        });
    }

    /// Orders the window out on the main thread if `still_wanted` agrees there. A show that
    /// ran inline on the main thread can come first, so the caller rechecks before it's hidden.
    pub fn hide(&self, still_wanted: impl FnOnce() -> bool + Send + 'static) {
        self.on_main(move |window| {
            if still_wanted() {
                window.hide()?;
            }
            Ok(())
        });
    }

    /// The drawable size in pixels, and pixels per point.
    pub fn metrics(&self) -> (u32, u32, f64) {
        self.inner.metrics()
    }

    /// The CGWindowID on macOS, the HWND on Windows.
    pub fn native_id(&self) -> i64 {
        self.inner.native_id()
    }

    pub fn contains_cursor(&self) -> bool {
        self.inner.contains_cursor()
    }

    /// The frame in Tauri's physical coordinates, which on macOS are points times the window's scale.
    pub fn frame_physical(&self) -> PhysicalRect<i32, u32> {
        self.inner.frame_physical()
    }

    /// The top-left corner in the form Tauri applies to any window as is: points on macOS,
    /// where its physical positions depend on the window's own scale, and pixels on Windows.
    pub fn position(&self) -> Position {
        self.inner.position()
    }

    /// Moves the top-left corner to where Tauri reports a window at `scale`, sized for
    /// the scale of the monitor there.
    pub fn set_position_physical(&self, position: PhysicalPosition<i32>, scale: f64) {
        self.on_main(move |window| window.set_position_physical(position, scale));
    }
}

impl NativeWindow {
    /// Resizes to points at the current scale, keeping the top-left corner.
    pub fn set_size(&self, width: f64, height: f64) {
        self.on_main(move |window| window.set_size((width, height)));
    }

    /// Receives mouse input on the main thread, for interactive windows.
    pub fn set_handler(&self, handler: Handler) {
        self.inner.set_handler(handler);
    }
}

impl rwh::HasWindowHandle for NativeWindow {
    fn window_handle(&self) -> Result<rwh::WindowHandle<'_>, rwh::HandleError> {
        // SAFETY: the native window is never destroyed while `inner` is alive.
        Ok(unsafe { rwh::WindowHandle::borrow_raw(self.inner.raw_window_handle()) })
    }
}

impl rwh::HasDisplayHandle for NativeWindow {
    fn display_handle(&self) -> Result<rwh::DisplayHandle<'_>, rwh::HandleError> {
        #[cfg(target_os = "macos")]
        return Ok(rwh::DisplayHandle::appkit());
        #[cfg(target_os = "windows")]
        return Ok(rwh::DisplayHandle::windows());
    }
}
