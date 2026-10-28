// Caps how long one cross-process Accessibility query may block.
#[cfg(target_os = "macos")]
pub(crate) const AX_MESSAGING_TIMEOUT_SECS: f32 = 2.0;

pub struct ActiveContext {
    pub app_name: String,
    pub window_title: String,
    pub url: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AX_MESSAGING_TIMEOUT_SECS, ActiveContext};
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;

    #[allow(non_camel_case_types)]
    type pid_t = i32;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: pid_t) -> *mut c_void;
        fn AXUIElementCopyAttributeValue(
            element: *mut c_void,
            attribute: *const c_void,
            value: *mut *mut c_void,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: *mut c_void, timeout: f32) -> i32;
        fn CFRelease(cf: *const c_void);
    }

    unsafe fn copy_attribute(element: *mut c_void, attribute: &str) -> *mut c_void {
        unsafe {
            let attribute = CFString::new(attribute);
            let mut value: *mut c_void = std::ptr::null_mut();
            let result = AXUIElementCopyAttributeValue(
                element,
                attribute.as_concrete_TypeRef() as *const c_void,
                &mut value,
            );
            if result != 0 {
                std::ptr::null_mut()
            } else {
                value
            }
        }
    }

    unsafe fn read_string_attribute(element: *mut c_void, attribute: &str) -> Option<String> {
        unsafe {
            let value = copy_attribute(element, attribute);
            if value.is_null() {
                return None;
            }

            let cf_type: CFType = CFType::wrap_under_create_rule(value as *const _);
            let cf_string = cf_type.downcast::<CFString>()?;
            Some(cf_string.to_string())
        }
    }

    // The system-wide element's AXFocusedApplication fails with
    // kAXErrorCannotComplete on macOS 27, so ask NSWorkspace instead.
    fn get_frontmost_app() -> Option<(String, pid_t)> {
        let app = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let pid = app.processIdentifier();
        let name = app.localizedName()?.to_string().trim().to_string();
        (pid > 0 && !name.is_empty()).then_some((name, pid))
    }

    pub(crate) fn frontmost_pid() -> Option<pid_t> {
        get_frontmost_app().map(|(_, pid)| pid)
    }

    pub fn get_active_context() -> Option<ActiveContext> {
        let (app_name, pid) = get_frontmost_app()?;

        let (window_title, url) = unsafe {
            let app_element = AXUIElementCreateApplication(pid);
            if app_element.is_null() {
                return None;
            } else {
                AXUIElementSetMessagingTimeout(app_element, AX_MESSAGING_TIMEOUT_SECS);
                let window_element = copy_attribute(app_element, "AXFocusedWindow");
                if !window_element.is_null() {
                    AXUIElementSetMessagingTimeout(window_element, AX_MESSAGING_TIMEOUT_SECS);
                }
                let title = if window_element.is_null() {
                    String::new()
                } else {
                    read_string_attribute(window_element, "AXTitle")
                        .unwrap_or_default()
                        .trim()
                        .to_string()
                };

                let doc = if window_element.is_null() {
                    None
                } else {
                    read_string_attribute(window_element, "AXDocument")
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                };

                if !window_element.is_null() {
                    CFRelease(window_element);
                }
                CFRelease(app_element);

                (title, doc)
            }
        };

        Some(ActiveContext {
            app_name,
            window_title,
            url,
        })
    }
}

#[cfg(target_os = "macos")]
pub(crate) use macos::frontmost_pid;
#[cfg(target_os = "macos")]
pub use macos::get_active_context;

#[cfg(target_os = "windows")]
mod windows_context {
    use super::ActiveContext;
    use std::path::Path;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::core::PWSTR;

    fn foreground_window() -> Option<HWND> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() { None } else { Some(hwnd) }
    }

    fn window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }

        let mut buffer = vec![0u16; (len as usize) + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        if copied <= 0 {
            return String::new();
        }

        String::from_utf16_lossy(&buffer[..copied as usize])
            .trim()
            .to_string()
    }

    fn process_image_path(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
        let mut buffer = vec![0u16; 32_768];
        let mut size = buffer.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
        };
        let _ = unsafe { CloseHandle(handle) };
        result.ok()?;
        Some(String::from_utf16_lossy(&buffer[..size as usize]))
    }

    fn app_name_from_path(path: &str) -> String {
        Path::new(path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(path)
            .trim()
            .to_string()
    }

    pub fn get_active_context() -> Option<ActiveContext> {
        let hwnd = foreground_window()?;
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == 0 {
            return None;
        }

        let app_name = process_image_path(pid)
            .map(|path| app_name_from_path(&path))
            .filter(|name| !name.is_empty())?;

        Some(ActiveContext {
            app_name,
            window_title: window_title(hwnd),
            url: None,
        })
    }
}

#[cfg(target_os = "windows")]
pub use windows_context::get_active_context;
