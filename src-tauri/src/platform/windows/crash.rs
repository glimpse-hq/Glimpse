use std::os::windows::io::AsRawHandle;
use std::path::PathBuf;
use std::sync::OnceLock;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HMODULE};
use windows::Win32::System::Diagnostics::Debug::{
    MiniDumpWithThreadInfo, MiniDumpWriteDump, SetUnhandledExceptionFilter, EXCEPTION_POINTERS,
    MINIDUMP_EXCEPTION_INFORMATION, MINIDUMP_TYPE,
};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId,
};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
const DUMP_FILE_NAME: &str = "crash.dmp";

struct CrashPaths {
    log_dir: PathBuf,
    marker: PathBuf,
}

static PATHS: OnceLock<CrashPaths> = OnceLock::new();

pub fn install(log_dir: PathBuf, marker: PathBuf) {
    if PATHS.set(CrashPaths { log_dir, marker }).is_err() {
        return;
    }
    unsafe {
        SetUnhandledExceptionFilter(Some(handler));
    }
}

unsafe extern "system" fn handler(info: *const EXCEPTION_POINTERS) -> i32 {
    let Some(paths) = PATHS.get() else {
        return EXCEPTION_CONTINUE_SEARCH;
    };
    if info.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }

    let dump_written = write_minidump(paths, info);

    let record = (*info).ExceptionRecord;
    let (code, address) = if record.is_null() {
        (0u32, std::ptr::null_mut())
    } else {
        ((*record).ExceptionCode.0 as u32, (*record).ExceptionAddress)
    };
    let module = faulting_module(address).unwrap_or_else(|| "unknown".to_string());

    // First three lines match the panic marker; analytics folds in the rest.
    let marker_body = format!(
        "{APP_VERSION}\n{module}+{:#x}\nnative\nexception_code={code:#010x}\nfaulting_module={module}\nminidump={}\n",
        address as usize,
        if dump_written { DUMP_FILE_NAME } else { "none" },
    );
    let _ = std::fs::write(&paths.marker, marker_body);

    EXCEPTION_CONTINUE_SEARCH
}

// Best-effort, in-process. MS suggests a separate process/thread (loader-lock
// risk); accepted here, and we capture the dump before any other handler work.
unsafe fn write_minidump(paths: &CrashPaths, info: *const EXCEPTION_POINTERS) -> bool {
    let Ok(file) = std::fs::File::create(paths.log_dir.join(DUMP_FILE_NAME)) else {
        return false;
    };
    let file_handle = HANDLE(file.as_raw_handle() as _);

    let exception = MINIDUMP_EXCEPTION_INFORMATION {
        ThreadId: GetCurrentThreadId(),
        ExceptionPointers: info as *mut EXCEPTION_POINTERS,
        ClientPointers: false.into(),
    };

    MiniDumpWriteDump(
        GetCurrentProcess(),
        GetCurrentProcessId(),
        file_handle,
        MINIDUMP_TYPE(MiniDumpWithThreadInfo.0),
        Some(std::ptr::addr_of!(exception)),
        None,
        None,
    )
    .is_ok()
}

unsafe fn faulting_module(address: *mut core::ffi::c_void) -> Option<String> {
    if address.is_null() {
        return None;
    }
    let mut module = HMODULE::default();
    GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        PCWSTR(address as *const u16),
        &mut module,
    )
    .ok()?;

    let mut buffer = [0u16; 260];
    let len = GetModuleFileNameW(Some(module), &mut buffer);
    if len == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    Some(path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string())
}
