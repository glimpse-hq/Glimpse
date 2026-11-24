use crate::native_ui::window::{Handler, WindowEvent};
use anyhow::Context;
use dispatch2::MainThreadBound;
use objc2::rc::Retained;
use objc2::{AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSEvent, NSFloatingWindowLevel, NSPanel, NSResponder, NSScreen,
    NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSPoint, NSRect, NSSize};
use parking_lot::Mutex;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::Arc;
use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize};
use wgpu::rwh;

// NSScrollView's default line scroll, for wheels that report whole lines.
const LINE: f64 = 10.0;

define_class!(
    // SAFETY: NSPanel has no subclassing requirements, and Panel has no Drop.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "GlimpseNativePanel"]
    struct Panel;

    impl Panel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            false
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }
    }
);

struct ViewIvars {
    handler: Arc<Mutex<Option<Handler>>>,
}

define_class!(
    // SAFETY: NSView has no subclassing requirements, and View has no Drop.
    #[unsafe(super(NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "GlimpseNativeView"]
    #[ivars = ViewIvars]
    struct View;

    impl View {
        // The click lands on the view instead of only bringing the window forward.
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            let (x, y) = self.point(event);
            self.emit(WindowEvent::MouseMoved { x, y });
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            let (x, y) = self.point(event);
            self.emit(WindowEvent::MouseMoved { x, y });
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            self.emit(WindowEvent::MouseExited);
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            let (x, y) = self.point(event);
            self.emit(WindowEvent::MouseDown { x, y });
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let (x, y) = self.point(event);
            self.emit(WindowEvent::MouseUp { x, y });
        }

        #[unsafe(method(scrollWheel:))]
        fn scroll_wheel(&self, event: &NSEvent) {
            let dy = event.scrollingDeltaY();
            let dy = if event.hasPreciseScrollingDeltas() {
                dy
            } else {
                dy * LINE
            };
            self.emit(WindowEvent::Scroll { dy });
        }
    }
);

impl View {
    fn new(
        mtm: MainThreadMarker,
        frame: NSRect,
        handler: Arc<Mutex<Option<Handler>>>,
    ) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(ViewIvars { handler });
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }

    fn point(&self, event: &NSEvent) -> (f64, f64) {
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        (point.x, self.bounds().size.height - point.y)
    }

    fn emit(&self, event: WindowEvent) {
        let handler = self.ivars().handler.lock().clone();
        if let Some(handler) = handler {
            handler(event);
        }
    }
}

#[derive(Clone, Copy)]
struct Geometry {
    // AppKit points, bottom-left origin.
    frame: NSRect,
    scale: f64,
    // Tao's physical coordinates flip y around the primary screen's height.
    primary_height: f64,
}

pub struct Window {
    panel: MainThreadBound<Retained<Panel>>,
    view: usize,
    id: i64,
    geometry: Mutex<Geometry>,
    handler: Arc<Mutex<Option<Handler>>>,
}

fn mtm() -> MainThreadMarker {
    MainThreadMarker::new().expect("native windows change on the main thread")
}

// AppKit puts the mouse on a screen's top row at the screen's maxY.
fn contains(rect: NSRect, point: NSPoint) -> bool {
    point.x >= rect.origin.x
        && point.x < rect.origin.x + rect.size.width
        && point.y > rect.origin.y
        && point.y <= rect.origin.y + rect.size.height
}

/// Runs `on_change` on the main thread whenever displays are added, removed or rescaled.
pub fn on_screens_changed(on_change: impl Fn() + 'static) {
    let block =
        block2::RcBlock::new(move |_: NonNull<objc2_foundation::NSNotification>| on_change());
    let center = objc2_foundation::NSNotificationCenter::defaultCenter();
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(objc2_app_kit::NSApplicationDidChangeScreenParametersNotification),
            None,
            Some(&objc2_foundation::NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // Observes for as long as the app runs.
    std::mem::forget(observer);
}

/// The Reduce Motion accessibility setting.
pub fn reduce_motion() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

fn primary_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm)
        .firstObject()
        .map_or(0.0, |screen| screen.frame().size.height)
}

impl Window {
    pub fn new(size: (f64, f64)) -> anyhow::Result<Self> {
        let mtm = MainThreadMarker::new().context("native windows are made on the main thread")?;
        let frame = NSRect::new(NSPoint::ZERO, NSSize::new(size.0, size.1));
        let this = Panel::alloc(mtm).set_ivars(());
        let panel: Retained<Panel> = unsafe {
            msg_send![
                super(this),
                initWithContentRect: frame,
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered,
                defer: false
            ]
        };
        // SAFETY: the panel is kept in `Window` and never closed.
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(false);
        panel.setLevel(NSFloatingWindowLevel);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::IgnoresCycle
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        panel.setHidesOnDeactivate(false);
        panel.setFloatingPanel(true);
        panel.setBecomesKeyOnlyIfNeeded(true);
        // Clicks pass through until `set_interactive`.
        panel.setIgnoresMouseEvents(true);

        let handler = Arc::new(Mutex::new(None));
        let view = View::new(mtm, frame, handler.clone());
        view.setWantsLayer(true);
        {
            let area = unsafe {
                NSTrackingArea::initWithRect_options_owner_userInfo(
                    NSTrackingArea::alloc(),
                    NSRect::ZERO,
                    NSTrackingAreaOptions::MouseEnteredAndExited
                        | NSTrackingAreaOptions::MouseMoved
                        | NSTrackingAreaOptions::ActiveAlways
                        | NSTrackingAreaOptions::InVisibleRect,
                    Some(&view),
                    None,
                )
            };
            view.addTrackingArea(&area);
        }
        panel.setContentView(Some(&view));

        Ok(Self {
            view: Retained::as_ptr(&view) as usize,
            id: panel.windowNumber() as i64,
            geometry: Mutex::new(Geometry {
                frame: panel.frame(),
                scale: panel.backingScaleFactor(),
                primary_height: primary_height(mtm),
            }),
            panel: MainThreadBound::new(panel, mtm),
            handler,
        })
    }

    fn set_frame(&self, mtm: MainThreadMarker, frame: NSRect, scale: f64) {
        self.panel.get(mtm).setFrame_display(frame, false);
        *self.geometry.lock() = Geometry {
            frame,
            scale,
            primary_height: primary_height(mtm),
        };
    }

    pub fn place_bottom_center(&self, bottom_margin: f64) -> anyhow::Result<()> {
        let mtm = mtm();
        let target = NSEvent::mouseLocation();
        let screens = NSScreen::screens(mtm);
        let screen = screens
            .iter()
            .find(|screen| contains(screen.frame(), target))
            .or_else(|| screens.firstObject())
            .context("no screens")?;
        let area = screen.frame();
        let size = self.geometry.lock().frame.size;
        let origin = NSPoint::new(
            (area.origin.x + (area.size.width - size.width) / 2.0).round(),
            area.origin.y + bottom_margin,
        );
        self.set_frame(mtm, NSRect::new(origin, size), screen.backingScaleFactor());
        Ok(())
    }

    pub fn show(&self) -> anyhow::Result<()> {
        self.panel.get(mtm()).orderFrontRegardless();
        Ok(())
    }

    /// Takes clicks when true; lets them through to what's below when false.
    pub fn set_interactive(&self, on: bool) -> anyhow::Result<()> {
        self.panel.get(mtm()).setIgnoresMouseEvents(!on);
        Ok(())
    }

    /// The cursor in points from the window's top-left corner.
    pub fn cursor_point(&self) -> Option<(f64, f64)> {
        let frame = self.geometry.lock().frame;
        let mouse = NSEvent::mouseLocation();
        Some((
            mouse.x - frame.origin.x,
            frame.origin.y + frame.size.height - mouse.y,
        ))
    }

    pub fn hide(&self) -> anyhow::Result<()> {
        self.panel.get(mtm()).orderOut(None);
        Ok(())
    }

    pub fn metrics(&self) -> (u32, u32, f64) {
        let Geometry { frame, scale, .. } = *self.geometry.lock();
        (
            (frame.size.width * scale).round() as u32,
            (frame.size.height * scale).round() as u32,
            scale,
        )
    }

    pub fn native_id(&self) -> i64 {
        self.id
    }

    pub fn frame_physical(&self) -> PhysicalRect<i32, u32> {
        let Geometry {
            frame,
            scale,
            primary_height,
        } = *self.geometry.lock();
        let top = primary_height - (frame.origin.y + frame.size.height);
        PhysicalRect {
            position: PhysicalPosition::new(
                (frame.origin.x * scale).round() as i32,
                (top * scale).round() as i32,
            ),
            size: PhysicalSize::new(
                (frame.size.width * scale).round() as u32,
                (frame.size.height * scale).round() as u32,
            ),
        }
    }

    pub fn set_handler(&self, handler: Handler) {
        *self.handler.lock() = Some(handler);
    }

    pub fn raw_window_handle(&self) -> rwh::RawWindowHandle {
        let view = NonNull::new(self.view as *mut c_void).expect("the content view exists");
        rwh::RawWindowHandle::AppKit(rwh::AppKitWindowHandle::new(view))
    }
}
