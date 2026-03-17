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
struct ClipboardBackup {
    text: Option<String>,
    html: Option<String>,
    image: Option<ImageData<'static>>,
}

#[cfg(target_os = "windows")]
struct ClipboardBackup {
    text: Option<String>,
    html: Option<String>,
    image: Option<arboard::ImageData<'static>>,
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
            #[cfg(target_os = "macos")]
            {
                if clipboard
                    .set()
                    .exclude_from_history()
                    .html(html, alt_text.clone())
                    .is_ok()
                {
                    return;
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if clipboard.set_html(&html, alt_text.clone()).is_ok() {
                    return;
                }
            }

            if let Some(text) = alt_text {
                #[cfg(target_os = "macos")]
                let _ = clipboard.set().exclude_from_history().text(text);
                #[cfg(not(target_os = "macos"))]
                let _ = clipboard.set_text(text);
                return;
            }
        }

        if let Some(image) = image {
            let _ = clipboard.set_image(image);
            return;
        }

        if let Some(text) = text {
            #[cfg(target_os = "macos")]
            let _ = clipboard.set().exclude_from_history().text(text);
            #[cfg(not(target_os = "macos"))]
            let _ = clipboard.set_text(text);
        } else {
            let _ = clipboard.clear();
        }
    }
}

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
pub fn paste_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;

    let backup = ClipboardBackup::capture(&mut clipboard);

    let temporary_text = text.to_string();
    clipboard
        .set_text(temporary_text.clone())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;

    thread::sleep(Duration::from_millis(10));

    let paste_result = send_paste_keystroke_windows();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1000));
        if let Ok(mut cb) = Clipboard::new() {
            let current = cb.get_text().ok();
            if current.as_deref() != Some(&temporary_text) {
                return;
            }
            backup.restore(&mut cb);
        }
    });

    paste_result
}

#[cfg(target_os = "windows")]
fn send_paste_keystroke_windows() -> Result<()> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    let mut down_inputs: [INPUT; 2] = unsafe { mem::zeroed() };
    down_inputs[0].r#type = INPUT_KEYBOARD;
    down_inputs[0].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_CONTROL,
            ..Default::default()
        },
    };
    down_inputs[1].r#type = INPUT_KEYBOARD;
    down_inputs[1].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_V,
            ..Default::default()
        },
    };

    let sent_down = unsafe { SendInput(&down_inputs, mem::size_of::<INPUT>() as i32) };
    if sent_down != down_inputs.len() as u32 {
        return Err(anyhow!(
            "SendInput (down phase) returned {sent_down}, expected {}",
            down_inputs.len()
        ));
    }

    thread::sleep(Duration::from_millis(5));

    let mut up_inputs: [INPUT; 2] = unsafe { mem::zeroed() };
    up_inputs[0].r#type = INPUT_KEYBOARD;
    up_inputs[0].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_V,
            dwFlags: KEYEVENTF_KEYUP,
            ..Default::default()
        },
    };
    up_inputs[1].r#type = INPUT_KEYBOARD;
    up_inputs[1].Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_CONTROL,
            dwFlags: KEYEVENTF_KEYUP,
            ..Default::default()
        },
    };

    let sent_up = unsafe { SendInput(&up_inputs, mem::size_of::<INPUT>() as i32) };
    if sent_up != up_inputs.len() as u32 {
        return Err(anyhow!(
            "SendInput (up phase) returned {sent_up}, expected {}",
            up_inputs.len()
        ));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn copy_text_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().map_err(|e| anyhow!("Failed to access clipboard: {e}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|e| anyhow!("Failed to set clipboard: {e}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn get_selected_text_ax() -> Option<String> {
    None
}
