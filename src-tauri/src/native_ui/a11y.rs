//! Screen reader access to native windows, through an AccessKit adapter on each window's view.

use super::window::NativeWindow;
use crate::AppRuntime;
use accesskit::{ActionHandler, ActionRequest, ActivationHandler, TreeUpdate};
use std::cell::RefCell;
use std::sync::Arc;
use tauri::AppHandle;
use wgpu::rwh::{HasWindowHandle, RawWindowHandle};

#[cfg(target_os = "macos")]
use accesskit_macos::SubclassingAdapter;
#[cfg(target_os = "windows")]
use accesskit_windows::SubclassingAdapter;

/// Builds the whole tree for the window's current state.
pub type Build = Arc<dyn Fn() -> TreeUpdate + Send + Sync>;
/// Performs a screen reader's request, such as pressing a button.
pub type OnAction = Arc<dyn Fn(ActionRequest) + Send + Sync>;

// The adapters aren't Send, so they live on the main thread, keyed by window id.
thread_local! {
    static ADAPTERS: RefCell<Vec<(i64, SubclassingAdapter)>> = const { RefCell::new(Vec::new()) };
}

struct Activation(Build);

impl ActivationHandler for Activation {
    fn request_initial_tree(&mut self) -> Option<TreeUpdate> {
        Some((self.0)())
    }
}

struct Actions(OnAction);

impl ActionHandler for Actions {
    fn do_action(&mut self, request: ActionRequest) {
        (self.0)(request);
    }
}

#[derive(Clone)]
pub struct A11y {
    app: AppHandle<AppRuntime>,
    id: i64,
    build: Build,
}

impl A11y {
    /// Attaches an adapter to `window`'s view. Windows requires this before the window first shows.
    pub fn attach(
        app: &AppHandle<AppRuntime>,
        window: &NativeWindow,
        build: Build,
        on_action: OnAction,
    ) -> anyhow::Result<Self> {
        let id = window.native_id();
        // As an address, so it can move to the main thread.
        let view = match window.window_handle()?.as_raw() {
            #[cfg(target_os = "macos")]
            RawWindowHandle::AppKit(handle) => handle.ns_view.as_ptr() as usize,
            #[cfg(target_os = "windows")]
            RawWindowHandle::Win32(handle) => handle.hwnd.get() as usize,
            _ => anyhow::bail!("unsupported window handle"),
        };
        let activation = Activation(build.clone());
        let actions = Actions(on_action);
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            // SAFETY: the view belongs to a native window that lives as long as the app.
            let adapter = unsafe { SubclassingAdapter::new(view as *mut _, activation, actions) };
            #[cfg(target_os = "windows")]
            let adapter = SubclassingAdapter::new(
                accesskit_windows::HWND(view as *mut _),
                activation,
                actions,
            );
            ADAPTERS.with_borrow_mut(|adapters| adapters.push((id, adapter)));
            let _ = sender.send(());
        })?;
        receiver.recv()?;
        Ok(Self {
            app: app.clone(),
            id,
            build,
        })
    }

    /// Sends the current tree to an active screen reader, which announces new live content.
    pub fn refresh(&self) {
        let (app, id, build) = (self.app.clone(), self.id, self.build.clone());
        // Queued from another thread, since Tauri runs main-thread calls inline and the
        // adapter is still borrowed while it hands a screen reader's action to us.
        std::thread::spawn(move || {
            let _ = app.run_on_main_thread(move || {
                let events = ADAPTERS.with_borrow_mut(|adapters| {
                    adapters
                        .iter_mut()
                        .find(|(window, _)| *window == id)
                        .and_then(|(_, adapter)| adapter.update_if_active(|| build()))
                });
                if let Some(events) = events {
                    events.raise();
                }
            });
        });
    }
}

/// Asks VoiceOver to speak `text`. Posted from the app, so it doesn't depend on a screen
/// reader having queried the window, which never happens for a panel that never takes focus.
#[cfg(target_os = "macos")]
pub fn announce(app: &AppHandle<AppRuntime>, text: String, urgent: bool) {
    use objc2::MainThreadMarker;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSAccessibilityAnnouncementKey, NSAccessibilityAnnouncementRequestedNotification,
        NSAccessibilityPostNotificationWithUserInfo, NSAccessibilityPriorityKey,
        NSAccessibilityPriorityLevel, NSApplication,
    };
    use objc2_foundation::{NSMutableDictionary, NSNumber, NSString};
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let priority = if urgent {
            NSAccessibilityPriorityLevel::High
        } else {
            NSAccessibilityPriorityLevel::Medium
        };
        let info = NSMutableDictionary::<_, objc2::runtime::AnyObject>::new();
        // SAFETY: AppKit's announcement keys, with the string and number values it expects.
        unsafe {
            info.setObject_forKey(
                &*NSString::from_str(&text),
                ProtocolObject::from_ref(NSAccessibilityAnnouncementKey),
            );
            info.setObject_forKey(
                &*NSNumber::new_isize(priority.0),
                ProtocolObject::from_ref(NSAccessibilityPriorityKey),
            );
            NSAccessibilityPostNotificationWithUserInfo(
                &NSApplication::sharedApplication(mtm),
                NSAccessibilityAnnouncementRequestedNotification,
                Some(&info),
            );
        }
    });
}

/// Windows announces through the live region in the tree instead.
#[cfg(target_os = "windows")]
pub fn announce(_app: &AppHandle<AppRuntime>, _text: String, _urgent: bool) {}

/// Marks live content for screen readers that read live regions (Narrator). macOS gets
/// `announce` instead, so VoiceOver doesn't hear it twice.
pub fn live(node: &mut accesskit::Node, urgent: bool) {
    if cfg!(target_os = "windows") {
        node.set_live(if urgent {
            accesskit::Live::Assertive
        } else {
            accesskit::Live::Polite
        });
    }
}
