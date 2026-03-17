use anyhow::{anyhow, Result};

#[cfg(not(target_os = "macos"))]
use arboard::Clipboard;
#[cfg(target_os = "macos")]
use arboard::{Clipboard, ImageData, SetExtApple};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::{thread, time::Duration};

#[cfg(target_os = "macos")]
pub fn get_selected_text_ax() -> Option<String> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn CFRelease(cf: *const c_void);
    }

    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return None;
        }

        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused_element: *mut c_void = ptr::null_mut();
        let result = AXUIElementCopyAttributeValue(
            system_wide,
            focused_attr.as_concrete_TypeRef() as *const c_void,
            &mut focused_element,
        );
        CFRelease(system_wide);

        if result != 0 || focused_element.is_null() {
            return None;
        }

        let selected_attr = CFString::new("AXSelectedText");
        let mut selected_value: *mut c_void = ptr::null_mut();
        let result = AXUIElementCopyAttributeValue(
            focused_element,
            selected_attr.as_concrete_TypeRef() as *const c_void,
            &mut selected_value,
        );
        CFRelease(focused_element);

        if result != 0 || selected_value.is_null() {
            return None;
        }

        let cf_type: CFType = CFType::wrap_under_create_rule(selected_value as *const _);
        let cf_string = cf_type.downcast::<CFString>()?;
        let text = cf_string.to_string();

        if text.trim().is_empty() {
            return None;
        }

        Some(text)
    }
}

/// Temporarily places `text` on the clipboard, sends a system paste keystroke, and restores the previous clipboard contents.
///
/// The provided `text` is written to the clipboard with history exclusion, a paste keystroke (Cmd+V) is issued, and a background task will attempt to restore the prior clipboard state after about 1 second if the clipboard still contains the temporary text.
///
/// # Parameters
///
/// - `text`: the string to paste; it will be set on the clipboard and excluded from clipboard history.
///
/// # Returns
///
/// `Ok(())` if the paste keystroke was successfully issued, otherwise an error describing the failure to access or modify the clipboard or to create/post the paste event.
///
/// # Examples
///
/// ```
/// // Attempts to paste "hello" into the currently focused application.
/// let _ = paste_text("hello");
/// ```
#[cfg(target_os = "macos")]
pub fn paste_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;

    let backup = ClipboardBackup::capture(&mut clipboard);

    let temporary_text = text.to_string();
    clipboard
        .set()
        .exclude_from_history()
        .text(temporary_text.clone())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;

    thread::sleep(Duration::from_millis(10));

    let paste_result = send_paste_keystroke();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1000));
        if let Ok(mut clipboard) = Clipboard::new() {
            let current = clipboard.get_text().ok();
            if current.as_deref() != Some(&temporary_text) {
                return;
            }
            backup.restore(&mut clipboard);
        }
    });

    paste_result
}

#[cfg(target_os = "macos")]
pub fn copy_text_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;
    clipboard
        .set()
        .exclude_from_history()
        .text(text.to_string())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
struct ClipboardBackup {
    text: Option<String>,
    html: Option<String>,
    image: Option<ImageData<'static>>,
}

#[cfg(target_os = "macos")]
impl ClipboardBackup {
    fn capture(clipboard: &mut Clipboard) -> Self {
        Self {
            text: clipboard.get_text().ok(),
            html: clipboard.get().html().ok(),
            image: clipboard.get_image().ok().map(|img| img.to_owned()),
        }
    }

    fn restore(self, clipboard: &mut Clipboard) {
        let ClipboardBackup { text, html, image } = self;

        if let Some(html) = html {
            let alt_text = text.clone();
            if clipboard
                .set()
                .exclude_from_history()
                .html(html, alt_text.clone())
                .is_ok()
            {
                return;
            }

            if let Some(text) = alt_text {
                let _ = clipboard.set().exclude_from_history().text(text);
                return;
            }
        }

        if let Some(image) = image {
            let _ = clipboard.set_image(image);
            return;
        }

        if let Some(text) = text {
            let _ = clipboard.set().exclude_from_history().text(text);
        } else {
            let _ = clipboard.clear();
        }
    }
}

/// Simulates a Command+V (paste) keyboard event on macOS.
///
/// Posts a Command+V key-down followed by a key-up event using a combined-session CGEventSource.
///
/// # Errors
/// Returns an error if creating the event source or either keyboard event fails.
///
/// # Examples
///
/// ```no_run
/// // Requires macOS accessibility permissions.
/// send_paste_keystroke().unwrap();
/// ```
#[cfg(target_os = "macos")]
fn send_paste_keystroke() -> Result<()> {
    const V_KEY: CGKeyCode = 9;

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| anyhow!("Failed to create CGEventSource"))?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), V_KEY, true)
        .map_err(|_| anyhow!("Failed to create key-down event"))?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    thread::sleep(Duration::from_millis(5));

    let key_up = CGEvent::new_keyboard_event(source, V_KEY, false)
        .map_err(|_| anyhow!("Failed to create key-up event"))?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

/// Temporarily replaces the system clipboard with `text`, triggers a Ctrl+V keystroke to paste it, and restores the previous clipboard contents shortly after.
///
/// The original clipboard contents (text or image) are captured before replacing the clipboard. A background task will attempt to restore that backup approximately one second later, but restoration occurs only if the clipboard still contains the temporary text (i.e., the user did not overwrite it in the meantime).
///
/// # Examples
///
/// ```
/// // On Windows only
/// paste_text("Hello, world!").expect("paste failed");
/// ```
#[cfg(target_os = "windows")]
pub fn paste_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;

    let backup_text = clipboard.get_text().ok();
    let backup_image = clipboard.get_image().ok().map(|img| img.to_owned());

    let temporary_text = text.to_string();
    clipboard
        .set_text(temporary_text.clone())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;

    thread::sleep(Duration::from_millis(10));

    let paste_result = send_paste_keystroke_windows();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1000));
        if let Ok(mut cb) = Clipboard::new() {
            // Only restore if the clipboard still contains our temporary text.
            // If the user copied something new in the meantime, leave it alone.
            let current = cb.get_text().ok();
            if current.as_deref() != Some(&temporary_text) {
                return;
            }

            if let Some(image) = backup_image {
                let _ = cb.set_image(image);
            } else if let Some(text) = backup_text {
                let _ = cb.set_text(text);
            } else {
                let _ = cb.clear();
            }
        }
    });

    paste_result
}

/// Simulates a Ctrl+V (paste) keyboard sequence by sending four Windows INPUT events.
///
/// On success the system receives: Ctrl down, V down, V up, Ctrl up.
///
/// # Errors
/// Returns an error if the Windows SendInput call reports a number of events sent other than 4.
///
/// # Examples
///
/// ```no_run
/// # #[cfg(target_os = "windows")] fn try_paste() -> anyhow::Result<()> {
/// send_paste_keystroke_windows()?;
/// # Ok(()) }
/// ```
fn send_paste_keystroke_windows() -> Result<()> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    let mut inputs: [INPUT; 4] = unsafe { mem::zeroed() };

    inputs[0].r#type = INPUT_KEYBOARD;
    inputs[0].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_CONTROL,
            ..Default::default()
        },
    };
    inputs[1].r#type = INPUT_KEYBOARD;
    inputs[1].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_V,
            ..Default::default()
        },
    };
    inputs[2].r#type = INPUT_KEYBOARD;
    inputs[2].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_V,
            dwFlags: KEYEVENTF_KEYUP,
            ..Default::default()
        },
    };
    inputs[3].r#type = INPUT_KEYBOARD;
    inputs[3].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_CONTROL,
            dwFlags: KEYEVENTF_KEYUP,
            ..Default::default()
        },
    };

    let sent = unsafe { SendInput(&inputs, mem::size_of::<INPUT>() as i32) };
    if sent != 4 {
        return Err(anyhow!("SendInput returned {sent}, expected 4"));
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn copy_text_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;
    Ok(())
}

/// Gets the currently selected text from the focused accessibility element when supported on the platform.
///
/// On platforms without accessibility selection support this function returns `None`.
///
/// # Returns
///
/// `Some(String)` containing the selected text when available, `None` otherwise.
///
/// # Examples
///
/// ```
/// match get_selected_text_ax() {
///     Some(text) => println!("Selected text: {}", text),
///     None => println!("No selection or platform not supported"),
/// }
/// ```
#[cfg(not(target_os = "macos"))]
pub fn get_selected_text_ax() -> Option<String> {
    None
}

/// Indicates that assistive paste is unavailable on this platform.
///
/// This implementation does not attempt to perform a paste and returns an error
/// stating that assistive paste is not supported on the current operating system.
///
/// # Examples
///
/// ```
/// use anyhow::Result;
///
/// let res = crate::paste_text("hello");
/// assert!(res.is_err());
/// ```
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn paste_text(_text: &str) -> Result<()> {
    Err(anyhow!("Assistive paste is not supported on this platform"))
}
