use crate::AppRuntime;
use crate::platform::QuitPrompt;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, msg_send, sel};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertSecondButtonReturn, NSApplication, NSEvent,
    NSEventMask, NSModalResponse, NSWindow, NSWorkspace, NSWorkspaceWillPowerOffNotification,
};
use objc2_foundation::{NSNotification, NSOperationQueue, NSString};
use parking_lot::Mutex;
use std::cell::Cell;
use std::ptr::NonNull;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const ESCAPE_KEY_CODE: u16 = 53;

/// Asks on the Record screen as a sheet, which leaves the main run loop running.
/// `on_answer(true)` means save and quit, also when there is no window to ask
/// on, since the user asked to quit.
pub fn confirm(
    app: &AppHandle<AppRuntime>,
    prompt: QuitPrompt,
    on_answer: impl FnOnce(bool) + Send + 'static,
) {
    use crate::tray::{SettingsPage, open_settings_page};

    if let Err(err) = open_settings_page(app, SettingsPage::Record) {
        tracing::error!("Failed to open the Record screen to confirm quitting: {err}");
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // The window is built off the main thread when it was closed.
        let mut window = None;
        for _ in 0..50 {
            window = app
                .get_webview_window(crate::SETTINGS_WINDOW_LABEL)
                .filter(|w| w.is_visible().unwrap_or(false));
            if window.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let on_answer = Mutex::new(Some(on_answer));
        let answer = Arc::new(move |save: bool| {
            if let Some(on_answer) = on_answer.lock().take() {
                on_answer(save);
            }
        });
        let Some(window) = window else {
            tracing::error!("No window to confirm quitting on; saving the recording");
            answer(true);
            return;
        };
        let main_answer = Arc::clone(&answer);
        let shown = app.run_on_main_thread(move || {
            let answer = main_answer;
            let Some(parent) = window
                .ns_window()
                .ok()
                .and_then(|ptr| unsafe { Retained::retain(ptr.cast::<NSWindow>()) })
            else {
                tracing::error!("No native window to confirm quitting on; saving the recording");
                answer(true);
                return;
            };
            let mtm = MainThreadMarker::new().expect("on the main thread");
            let alert = NSAlert::new(mtm);
            alert.setMessageText(&NSString::from_str(prompt.title));
            alert.setInformativeText(&NSString::from_str(prompt.message));
            unsafe {
                alert.setIcon(
                    NSApplication::sharedApplication(mtm)
                        .applicationIconImage()
                        .as_deref(),
                )
            };
            // The first button is the blue default, on Return.
            let keep = alert.addButtonWithTitle(&NSString::from_str(prompt.keep));
            alert
                .addButtonWithTitle(&NSString::from_str(prompt.save))
                .setHasDestructiveAction(true);

            // NSAlert maps Escape only to a button titled "Cancel". The click is
            // deferred because ending the sheet removes this monitor.
            let sheet = alert.window();
            let escaped = Cell::new(false);
            let escape = RcBlock::new({
                let sheet = sheet.clone();
                move |event: NonNull<NSEvent>| -> *mut NSEvent {
                    if unsafe { event.as_ref() }.keyCode() == ESCAPE_KEY_CODE
                        && sheet.isKeyWindow()
                        && !escaped.replace(true)
                    {
                        let _: () = unsafe {
                            msg_send![
                                &*keep,
                                performSelector: sel!(performClick:),
                                withObject: None::<&AnyObject>,
                                afterDelay: 0.0f64
                            ]
                        };
                        return std::ptr::null_mut();
                    }
                    event.as_ptr()
                }
            });
            let monitor = Cell::new(unsafe {
                NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &escape)
            });
            // AppKit refuses to terminate while a sheet is up, which would
            // interrupt a logout, so the sheet closes (keeping the recording
            // for recovery) when the session ends.
            let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
            let power_off = RcBlock::new({
                let (parent, sheet) = (parent.clone(), sheet.clone());
                move |_: NonNull<NSNotification>| {
                    parent.endSheet_returnCode(&sheet, NSAlertFirstButtonReturn);
                }
            });
            let observer = Cell::new(Some(unsafe {
                workspace.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceWillPowerOffNotification),
                    None,
                    Some(&NSOperationQueue::mainQueue()),
                    &power_off,
                )
            }));
            let handler = RcBlock::new(move |response: NSModalResponse| {
                if let Some(monitor) = monitor.take() {
                    unsafe { NSEvent::removeMonitor(&monitor) };
                }
                if let Some(observer) = observer.take() {
                    unsafe { workspace.removeObserver(observer.as_ref()) };
                }
                answer(response == NSAlertSecondButtonReturn);
            });
            alert.beginSheetModalForWindow_completionHandler(&parent, Some(&handler));
        });
        if let Err(err) = shown {
            tracing::error!("Failed to confirm quitting; saving the recording: {err}");
            answer(true);
        }
    });
}
