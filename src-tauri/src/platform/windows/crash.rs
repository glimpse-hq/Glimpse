use std::os::windows::io::AsRawHandle;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::Foundation::{HANDLE, HMODULE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Diagnostics::Debug::{
    EXCEPTION_POINTERS, MINIDUMP_EXCEPTION_INFORMATION, MINIDUMP_TYPE, MiniDumpWithThreadInfo,
    MiniDumpWriteDump, SetUnhandledExceptionFilter,
};
use windows::Win32::System::LibraryLoader::{
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    GetModuleFileNameW, GetModuleHandleExW, GetModuleHandleW,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, RegisterClassW,
    WINDOW_EX_STYLE, WM_ENDSESSION, WM_QUERYENDSESSION, WNDCLASSW, WS_OVERLAPPED,
};
use windows::core::{PCWSTR, w};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
const DUMP_FILE_NAME: &str = "crash.dmp";

type ExceptionFilter = unsafe extern "system" fn(*const EXCEPTION_POINTERS) -> i32;

struct CrashPaths {
    log_dir: PathBuf,
    marker: PathBuf,
}

static PATHS: OnceLock<CrashPaths> = OnceLock::new();
static PREV_FILTER: OnceLock<Option<ExceptionFilter>> = OnceLock::new();
static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);
static SESSION_ENDING: AtomicBool = AtomicBool::new(false);

pub fn note_exit_requested() {
    EXIT_REQUESTED.store(true, Ordering::Relaxed);
}

// Logoff and shutdown end tao's loop from WM_ENDSESSION with no ExitRequested,
// and tao keeps pumping messages into the destroyed loop until Windows kills
// the process, which panics in runner.rs ("cannot move state from Destroyed").
pub fn exit_if_session_ending() {
    if !EXIT_REQUESTED.load(Ordering::Relaxed) {
        std::process::exit(0);
    }
}

// tao ends its loop on WM_ENDSESSION even when its event handler is on the
// stack (a nested message loop, or a blocking call that dispatches sent
// messages), which panics in runner.rs ("event handler is re-entrant").
// Store updates and restarts send it. This window runs on its own thread, so
// it gets WM_QUERYENDSESSION even while the main thread is busy, and the query
// reaches every window before any WM_ENDSESSION does.
pub fn watch_session_end() {
    let spawned = std::thread::Builder::new()
        .name("glimpse-session-end".to_string())
        .spawn(|| {
            let class_name = w!("GlimpseSessionEnd");
            let instance = unsafe { GetModuleHandleW(None) }.unwrap_or_default();
            let class = WNDCLASSW {
                lpfnWndProc: Some(session_end_proc),
                hInstance: instance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            if unsafe { RegisterClassW(&class) } == 0 {
                tracing::warn!(
                    "Failed to register the Windows session-end window: {}",
                    windows::core::Error::from_thread()
                );
                return;
            }
            // Not message-only: those windows don't get session-end messages.
            let created = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    class_name,
                    w!(""),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    None,
                    None,
                    Some(instance.into()),
                    None,
                )
            };
            if let Err(err) = created {
                tracing::warn!("Failed to create the Windows session-end window: {err}");
                return;
            }
            let mut message = MSG::default();
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.into() {
                unsafe { DispatchMessageW(&message) };
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("Failed to start the Windows session-end watcher: {err}");
    }
}

unsafe extern "system" fn session_end_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_QUERYENDSESSION => {
            SESSION_ENDING.store(true, Ordering::Relaxed);
            LRESULT(1)
        }
        // wParam is FALSE when the shutdown was cancelled.
        WM_ENDSESSION => {
            SESSION_ENDING.store(wparam.0 != 0, Ordering::Relaxed);
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

// Windows is closing the app, so a panic in tao's event loop is a clean exit.
pub fn exit_if_session_end_panic(location: &str) {
    if SESSION_ENDING.load(Ordering::Relaxed)
        && location.contains("tao-")
        && location.contains("event_loop")
    {
        crate::analytics::set_crash_phase("shutdown");
        crate::analytics::end_session();
        std::process::exit(0);
    }
}

pub fn install(log_dir: PathBuf, marker: PathBuf) {
    if PATHS.set(CrashPaths { log_dir, marker }).is_err() {
        return;
    }
    unsafe {
        let prev = SetUnhandledExceptionFilter(Some(handler));
        let _ = PREV_FILTER.set(prev);
    }
}

unsafe extern "system" fn handler(info: *const EXCEPTION_POINTERS) -> i32 {
    let Some(paths) = PATHS.get() else {
        return EXCEPTION_CONTINUE_SEARCH;
    };
    if info.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    let dump_written = unsafe { write_minidump(paths, info) };

    let record = unsafe { (*info).ExceptionRecord };
    let (code, address) = if record.is_null() {
        (0u32, std::ptr::null_mut())
    } else {
        unsafe { ((*record).ExceptionCode.0 as u32, (*record).ExceptionAddress) }
    };
    // Group on a module-relative offset, not the absolute (ASLR-randomized) address.
    let (module, location) = match unsafe { faulting_module(address) } {
        Some((name, base)) => {
            let offset = (address as usize).saturating_sub(base);
            (name.clone(), format!("{name}+{offset:#x}"))
        }
        None => ("unknown".to_string(), "unknown".to_string()),
    };

    // First three lines match the panic marker; analytics folds in the rest.
    let marker_body = format!(
        "{APP_VERSION}\n{location}\nnative\nexception_code={code:#010x}\nfaulting_module={module}\nminidump={}\ncrash_phase={}\nactivity={}\n",
        if dump_written { DUMP_FILE_NAME } else { "none" },
        crate::analytics::crash_phase(),
        crate::analytics::activity().as_str(),
    );
    crate::analytics::write_marker_atomically(&paths.marker, &marker_body);

    // Chain to whatever filter we replaced so an existing reporter still runs.
    match PREV_FILTER.get().copied().flatten() {
        Some(prev) => unsafe { prev(info) },
        None => EXCEPTION_CONTINUE_SEARCH,
    }
}

// Best-effort, in-process. MS suggests a separate process/thread (loader-lock
// risk); accepted here, and we capture the dump before any other handler work.
unsafe fn write_minidump(paths: &CrashPaths, info: *const EXCEPTION_POINTERS) -> bool {
    let Ok(file) = std::fs::File::create(paths.log_dir.join(DUMP_FILE_NAME)) else {
        return false;
    };
    let file_handle = HANDLE(file.as_raw_handle() as _);

    let exception = MINIDUMP_EXCEPTION_INFORMATION {
        ThreadId: unsafe { GetCurrentThreadId() },
        ExceptionPointers: info as *mut EXCEPTION_POINTERS,
        ClientPointers: false.into(),
    };

    unsafe {
        MiniDumpWriteDump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file_handle,
            MINIDUMP_TYPE(MiniDumpWithThreadInfo.0),
            Some(std::ptr::addr_of!(exception)),
            None,
            None,
        )
    }
    .is_ok()
}

// Returns the faulting module's file name and its base address, so the caller
// can record an ASLR-independent module-relative offset.
unsafe fn faulting_module(address: *mut core::ffi::c_void) -> Option<(String, usize)> {
    if address.is_null() {
        return None;
    }
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(address as *const u16),
            &mut module,
        )
    }
    .ok()?;

    let mut buffer = [0u16; 260];
    let len = unsafe { GetModuleFileNameW(Some(module), &mut buffer) };
    if len == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    let name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
    Some((name, module.0 as usize))
}
