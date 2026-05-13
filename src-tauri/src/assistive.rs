use anyhow::{anyhow, Result};

#[cfg(not(target_os = "macos"))]
use arboard::Clipboard;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use arboard::Error as ClipboardError;
#[cfg(target_os = "macos")]
use arboard::{Clipboard, ImageData, SetExtApple};
#[cfg(target_os = "windows")]
use arboard::{ImageData, SetExtWindows};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::{thread, time::Duration};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_C, VK_CONTROL, VK_V,
};

#[cfg(target_os = "macos")]
pub fn get_selected_text_ax() -> Option<String> {
    match macos_ax::probe_selection() {
        macos_ax::SelectionProbe::Text(text) if !text.trim().is_empty() => return Some(text),
        macos_ax::SelectionProbe::Empty => return None,
        macos_ax::SelectionProbe::Text(_) | macos_ax::SelectionProbe::Unknown => {}
    }

    let mut clipboard = Clipboard::new().ok()?;

    let backup = ClipboardBackup::capture(&mut clipboard);

    if clipboard.clear().is_err() {
        backup.restore(&mut clipboard);
        return None;
    }
    thread::sleep(Duration::from_millis(5));

    if send_copy_keystroke().is_err() {
        backup.restore(&mut clipboard);
        return None;
    }
    thread::sleep(Duration::from_millis(50));

    let text = clipboard.get_text().ok();

    backup.restore(&mut clipboard);

    match text {
        Some(t) if !t.trim().is_empty() => Some(t),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
mod macos_ax {
    use core_foundation::base::{CFRelease, CFType, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::ptr;

    type AXUIElementRef = *mut c_void;
    type AXError = i32;
    const AX_ERROR_SUCCESS: AXError = 0;
    const AX_VALUE_TYPE_CF_RANGE: u32 = 4;

    #[repr(C)]
    struct CFRange {
        location: isize,
        length: isize,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn AXValueGetValue(value: *const c_void, ax_type: u32, value_ptr: *mut c_void) -> bool;
        fn AXIsProcessTrusted() -> u8;
    }

    pub(super) enum SelectionProbe {
        Text(String),
        Empty,
        Unknown,
    }

    pub(super) fn probe_selection() -> SelectionProbe {
        if unsafe { AXIsProcessTrusted() } == 0 {
            return SelectionProbe::Unknown;
        }

        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return SelectionProbe::Unknown;
            }

            let focused_attr = CFString::new("AXFocusedUIElement");
            let mut focused: *mut c_void = ptr::null_mut();
            let err = AXUIElementCopyAttributeValue(
                system,
                focused_attr.as_concrete_TypeRef() as *const c_void,
                &mut focused,
            );
            CFRelease(system as CFTypeRef);

            if err != AX_ERROR_SUCCESS || focused.is_null() {
                return SelectionProbe::Unknown;
            }

            let result = probe_focused(focused);
            CFRelease(focused as CFTypeRef);
            result
        }
    }

    unsafe fn probe_focused(focused: AXUIElementRef) -> SelectionProbe {
        if let Some(text) = read_string_attribute(focused, "AXSelectedText") {
            if !text.is_empty() {
                return SelectionProbe::Text(text);
            }
        }

        if matches!(
            read_selected_text_range(focused),
            Some(CFRange { length: 0, .. })
        ) {
            return SelectionProbe::Empty;
        }

        SelectionProbe::Unknown
    }

    unsafe fn read_string_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let value = copy_attribute(element, attribute)?;
        let cf_type: CFType = CFType::wrap_under_create_rule(value as *const _);
        let cf_string = cf_type.downcast::<CFString>()?;
        Some(cf_string.to_string())
    }

    unsafe fn read_selected_text_range(element: AXUIElementRef) -> Option<CFRange> {
        let value = copy_attribute(element, "AXSelectedTextRange")?;
        let mut range = CFRange {
            location: 0,
            length: 0,
        };
        let ok = AXValueGetValue(
            value,
            AX_VALUE_TYPE_CF_RANGE,
            &mut range as *mut CFRange as *mut c_void,
        );
        CFRelease(value as CFTypeRef);

        ok.then_some(range)
    }

    unsafe fn copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<*mut c_void> {
        let attribute = CFString::new(attribute);
        let mut value: *mut c_void = ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(
            element,
            attribute.as_concrete_TypeRef() as *const c_void,
            &mut value,
        );

        if err == AX_ERROR_SUCCESS && !value.is_null() {
            return Some(value);
        }

        None
    }
}

#[cfg(target_os = "macos")]
fn send_copy_keystroke() -> Result<()> {
    const C_KEY: CGKeyCode = 8;

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| anyhow!("Failed to create CGEventSource"))?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), C_KEY, true)
        .map_err(|_| anyhow!("Failed to create key-down event"))?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    thread::sleep(Duration::from_millis(5));

    let key_up = CGEvent::new_keyboard_event(source, C_KEY, false)
        .map_err(|_| anyhow!("Failed to create key-up event"))?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn get_selected_text_ax() -> Option<String> {
    let mut clipboard = Clipboard::new().ok()?;

    let backup = ClipboardBackup::capture(&mut clipboard);

    if clipboard.clear().is_err() {
        backup.restore(&mut clipboard);
        return None;
    }
    thread::sleep(Duration::from_millis(5));

    if send_copy_keystroke().is_err() {
        backup.restore(&mut clipboard);
        return None;
    }
    thread::sleep(Duration::from_millis(80));

    let text = clipboard.get_text().ok();

    backup.restore(&mut clipboard);

    match text {
        Some(t) if !t.trim().is_empty() => Some(t),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn send_copy_keystroke() -> Result<()> {
    let inputs = [
        keyboard_input(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        keyboard_input(VK_C, KEYBD_EVENT_FLAGS(0)),
        keyboard_input(VK_C, KEYEVENTF_KEYUP),
        keyboard_input(VK_CONTROL, KEYEVENTF_KEYUP),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(anyhow!("Failed to send Ctrl+C copy keystroke"));
    }

    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn paste_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;

    let backup = ClipboardBackup::capture(&mut clipboard);

    let inserted_text = text.to_string();
    set_text_excluding_history(&mut clipboard, inserted_text.clone())?;

    thread::sleep(Duration::from_millis(10));

    let paste_result = send_paste_keystroke();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1000));
        if let Ok(mut clipboard) = Clipboard::new() {
            if should_restore_after_paste(&mut clipboard, &inserted_text) {
                backup.restore(&mut clipboard);
            }
        }
    });

    paste_result
}

#[cfg(target_os = "windows")]
pub fn copy_text_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;
    set_text_excluding_history(&mut clipboard, text.to_string())
}

#[cfg(target_os = "macos")]
pub fn copy_text_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;
    set_text_excluding_history(&mut clipboard, text.to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn set_text_excluding_history(clipboard: &mut Clipboard, text: String) -> Result<()> {
    clipboard
        .set()
        .exclude_from_history()
        .text(text)
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn should_restore_after_paste(clipboard: &mut Clipboard, inserted_text: &str) -> bool {
    match clipboard.get_text() {
        Ok(current) => return current == inserted_text || current.is_empty(),
        Err(ClipboardError::ContentNotAvailable) => {}
        Err(_) => return false,
    }

    clipboard
        .get()
        .html()
        .is_err_and(|err| matches!(err, ClipboardError::ContentNotAvailable))
        && clipboard
            .get_image()
            .is_err_and(|err| matches!(err, ClipboardError::ContentNotAvailable))
        && clipboard
            .get()
            .file_list()
            .is_err_and(|err| matches!(err, ClipboardError::ContentNotAvailable))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct ClipboardBackup {
    text: Option<String>,
    html: Option<String>,
    image: Option<ImageData<'static>>,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
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
                let _ = set_text_excluding_history(clipboard, text);
                return;
            }
        }

        if let Some(image) = image {
            let _ = clipboard.set_image(image);
            return;
        }

        if let Some(text) = text {
            let _ = set_text_excluding_history(clipboard, text);
        } else {
            let _ = clipboard.clear();
        }
    }
}

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

#[cfg(target_os = "windows")]
fn send_paste_keystroke() -> Result<()> {
    let inputs = [
        keyboard_input(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        keyboard_input(VK_V, KEYBD_EVENT_FLAGS(0)),
        keyboard_input(VK_V, KEYEVENTF_KEYUP),
        keyboard_input(VK_CONTROL, KEYEVENTF_KEYUP),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(anyhow!("Failed to send Ctrl+V paste keystroke"));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn keyboard_input(key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
