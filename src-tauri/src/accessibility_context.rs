// Caps how long one cross-process Accessibility query may block.
#[cfg(target_os = "macos")]
pub(crate) const AX_MESSAGING_TIMEOUT_SECS: f32 = 2.0;

pub struct ActiveContext {
    pub app_name: String,
    /// Other names the app goes by on Windows (exe name, Start menu and
    /// Store names), matched alongside `app_name`.
    pub other_names: Vec<String>,
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
            other_names: Vec::new(),
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
    use std::sync::mpsc;
    use std::time::Duration;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationValuePattern,
        TreeScope_Descendants, UIA_AutomationIdPropertyId, UIA_ClassNamePropertyId,
        UIA_ValuePatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId,
    };
    use windows::core::{BOOL, Interface, PWSTR};

    // Reading a browser's address bar must never hold up a dictation.
    const URL_DEADLINE: Duration = Duration::from_millis(150);

    // Browsers whose address bar we read. Other apps match by name only, since
    // walking their accessibility tree can slow apps built on Chromium.
    const BROWSERS: &[&str] = &[
        "arc",
        "brave",
        "chrome",
        "chromium",
        "comet",
        "firefox",
        "floorp",
        "librewolf",
        "msedge",
        "opera",
        "thorium",
        "vivaldi",
        "waterfox",
        "zen",
    ];

    fn foreground_window() -> Option<HWND> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() { None } else { Some(hwnd) }
    }

    fn window_pid(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        pid
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

    // A packaged app's ID, like "Microsoft.WindowsStore_8wekyb3d8bbwe!App".
    fn app_user_model_id(pid: u32) -> Option<String> {
        use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
        let mut buffer = vec![0u16; 256];
        let mut len = buffer.len() as u32;
        let status = unsafe {
            GetApplicationUserModelId(handle, &mut len, Some(PWSTR(buffer.as_mut_ptr())))
        };
        let _ = unsafe { CloseHandle(handle) };
        if status.is_err() || len == 0 {
            return None;
        }
        let end = buffer
            .iter()
            .position(|ch| *ch == 0)
            .unwrap_or(len as usize);
        Some(String::from_utf16_lossy(&buffer[..end]))
    }

    fn exe_stem(path: &str) -> String {
        Path::new(path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(path)
            .trim()
            .to_string()
    }

    // Store apps draw inside ApplicationFrameHost; the app is the child window's process.
    fn hosted_app_pid(hwnd: HWND, host_pid: u32) -> Option<u32> {
        unsafe extern "system" fn visit(child: HWND, lparam: LPARAM) -> BOOL {
            let found = unsafe { &mut *(lparam.0 as *mut (u32, u32)) };
            let pid = window_pid(child);
            if pid != 0 && pid != found.0 {
                found.1 = pid;
                return BOOL(0);
            }
            BOOL(1)
        }
        let mut found = (host_pid, 0u32);
        unsafe {
            let _ = EnumChildWindows(
                Some(hwnd),
                Some(visit),
                LPARAM(&mut found as *mut (u32, u32) as isize),
            );
        }
        (found.1 != 0).then_some(found.1)
    }

    fn browser_url(hwnd: HWND) -> Option<String> {
        let raw = hwnd.0 as isize;
        let (tx, rx) = mpsc::channel();
        // Abandoned on timeout; a hung browser can't block the caller.
        std::thread::spawn(move || {
            let _ = tx.send(read_address_bar(HWND(raw as *mut _)));
        });
        rx.recv_timeout(URL_DEADLINE).ok().flatten()
    }

    fn read_address_bar(hwnd: HWND) -> Option<String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
            let value = query_address_bar(hwnd).ok();
            CoUninitialize();
            value.filter(|value| !value.trim().is_empty())
        }
    }

    unsafe fn query_address_bar(hwnd: HWND) -> windows::core::Result<String> {
        unsafe {
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)?;
            if let Ok(uia2) = uia.cast::<IUIAutomation2>() {
                let timeout = URL_DEADLINE.as_millis() as u32;
                let _ = uia2.SetConnectionTimeout(timeout);
                let _ = uia2.SetTransactionTimeout(timeout);
            }
            let window = uia.ElementFromHandle(hwnd)?;
            // Chromium's omnibox, and Firefox's address bar.
            let chromium = uia.CreatePropertyCondition(
                UIA_ClassNamePropertyId,
                &VARIANT::from("OmniboxViewViews"),
            )?;
            let firefox = uia.CreatePropertyCondition(
                UIA_AutomationIdPropertyId,
                &VARIANT::from("urlbar-input"),
            )?;
            let condition = uia.CreateOrCondition(&chromium, &firefox)?;
            let bar = window.FindFirst(TreeScope_Descendants, &condition)?;
            let pattern: IUIAutomationValuePattern = bar.GetCurrentPatternAs(UIA_ValuePatternId)?;
            Ok(pattern.CurrentValue()?.to_string())
        }
    }

    pub fn get_active_context() -> Option<ActiveContext> {
        let hwnd = foreground_window()?;
        let pid = window_pid(hwnd);
        if pid == 0 {
            return None;
        }
        let mut app_pid = pid;
        let mut path = process_image_path(pid)?;
        if exe_stem(&path).eq_ignore_ascii_case("ApplicationFrameHost")
            && let Some(hosted_pid) = hosted_app_pid(hwnd, pid)
            && let Some(hosted_path) = process_image_path(hosted_pid)
        {
            app_pid = hosted_pid;
            path = hosted_path;
        }

        let process_name = exe_stem(&path);
        if process_name.is_empty() {
            return None;
        }
        let app_name = crate::platform::windows::file_description(Path::new(&path))
            .unwrap_or_else(|| process_name.clone());
        let is_browser = BROWSERS
            .iter()
            .any(|browser| process_name.eq_ignore_ascii_case(browser));
        let url = if is_browser { browser_url(hwnd) } else { None };
        let mut other_names = crate::platform::windows::icons::picker_names(
            Path::new(&path),
            app_user_model_id(app_pid).as_deref(),
        );
        other_names.push(process_name);

        Some(ActiveContext {
            app_name,
            other_names,
            window_title: window_title(hwnd),
            url,
        })
    }
}

#[cfg(target_os = "windows")]
pub use windows_context::get_active_context;
