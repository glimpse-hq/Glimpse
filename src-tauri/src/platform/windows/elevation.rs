//! Windows keeps a normal process from sending input to, or hooking the keys
//! of, an app running as administrator. Glimpse's shortcut and paste both stop
//! working there without any error, so this detects it and says so.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetMessageW,
    GetWindowThreadProcessId, MSG, TranslateMessage, WINEVENT_OUTOFCONTEXT,
};

use crate::AppRuntime;

static APP: OnceLock<AppHandle<AppRuntime>> = OnceLock::new();
static NOTICE_SHOWN: AtomicBool = AtomicBool::new(false);

/// True when the window in front belongs to an app running as administrator
/// and Glimpse doesn't, so Windows drops Glimpse's keystrokes there.
pub fn foreground_blocks_input() -> bool {
    let window = unsafe { GetForegroundWindow() };
    // A process Glimpse can't query runs above it; Windows blocks input there too.
    !window.is_invalid() && window_blocks_input(window).unwrap_or(true)
}

fn window_blocks_input(window: HWND) -> Option<bool> {
    if process_is_elevated(unsafe { GetCurrentProcess() }) == Some(true) {
        return Some(false);
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    if pid == 0 {
        return Some(false);
    }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let elevated = process_is_elevated(process);
    unsafe {
        let _ = CloseHandle(process);
    }
    elevated
}

fn process_is_elevated(process: HANDLE) -> Option<bool> {
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut size = 0u32;
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
    };
    unsafe {
        let _ = CloseHandle(token);
    }
    result.ok()?;
    Some(elevation.TokenIsElevated != 0)
}

/// Explains once per session, when an app running as administrator comes to
/// the front, why the shortcut won't work in it.
pub fn watch_foreground(app: AppHandle<AppRuntime>) {
    if process_is_elevated(unsafe { GetCurrentProcess() }) == Some(true) {
        return;
    }
    let _ = APP.set(app);
    let spawned = std::thread::Builder::new()
        .name("glimpse-foreground-watch".to_string())
        .spawn(|| {
            let hook = unsafe {
                SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    None,
                    Some(foreground_proc),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                )
            };
            if hook.is_invalid() {
                tracing::warn!("Failed to watch the foreground window");
                return;
            }
            let mut message = MSG::default();
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.0 > 0 {
                unsafe {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("Failed to start the foreground watcher: {err}");
    }
}

unsafe extern "system" fn foreground_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    window: HWND,
    _object_id: i32,
    _child_id: i32,
    _thread_id: u32,
    _time: u32,
) {
    if NOTICE_SHOWN.load(Ordering::Relaxed) || window.is_invalid() {
        return;
    }
    if window_blocks_input(window) != Some(true) || NOTICE_SHOWN.swap(true, Ordering::Relaxed) {
        return;
    }
    if let Some(app) = APP.get() {
        crate::toast::show(
            app,
            "info",
            None,
            &crate::toast::native(app, "native.toast.admin_app_shortcut"),
        );
    }
}
