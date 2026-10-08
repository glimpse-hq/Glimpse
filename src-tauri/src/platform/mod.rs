use std::fs;
use std::io;
use std::path::Path;

/// Forwarders for a native panel (NSPanel on macOS, tool window on Windows).
macro_rules! native_panel {
    ($name:ident, $label:literal) => {
        pub mod $name {
            use crate::AppRuntime;
            use tauri::{AppHandle, WebviewWindow};

            pub fn init(app: &AppHandle<AppRuntime>, window: &WebviewWindow<AppRuntime>) {
                #[cfg(target_os = "macos")]
                if let Err(err) = crate::platform::macos::$name::init(app, window) {
                    tracing::error!("Failed to initialize macOS {} panel: {err}", $label);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = app;
                    if let Err(err) = crate::platform::windows::$name::init(window) {
                        tracing::error!("Failed to initialize Windows {} surface: {err}", $label);
                    }
                }
            }

            pub fn show(app: &AppHandle<AppRuntime>, window: &WebviewWindow<AppRuntime>) {
                #[cfg(target_os = "macos")]
                if let Err(err) = crate::platform::macos::$name::show(app, window) {
                    tracing::error!("Failed to show macOS {} panel: {err}", $label);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = app;
                    if let Err(err) = crate::platform::windows::$name::show(window) {
                        tracing::error!("Failed to show Windows {} surface: {err}", $label);
                    }
                }
            }

            pub fn hide(app: &AppHandle<AppRuntime>, window: &WebviewWindow<AppRuntime>) {
                #[cfg(target_os = "macos")]
                if let Err(err) = crate::platform::macos::$name::hide(app, window) {
                    tracing::error!("Failed to hide macOS {} panel: {err}", $label);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = app;
                    if let Err(err) = crate::platform::windows::$name::hide(window) {
                        tracing::error!("Failed to hide Windows {} surface: {err}", $label);
                    }
                }
            }
        }
    };
}

native_panel!(live, "live view");
native_panel!(overlay, "overlay");
native_panel!(toast, "toast");

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

/// True when this install's updates are owned by an app store
/// (MSIX from the Microsoft Store); the built-in updater stays off.
pub fn is_store_build() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows::store::is_msix_packaged()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Distribution channel for analytics. macOS currently ships through GitHub;
/// packaged Windows builds are distributed through the Microsoft Store.
pub fn install_type() -> &'static str {
    install_type_for_store_build(is_store_build())
}

fn install_type_for_store_build(store_build: bool) -> &'static str {
    if store_build {
        "windows_store"
    } else {
        "github"
    }
}

/// Bytes the current user can still write on the volume holding `path`.
pub fn available_space(path: &Path) -> io::Result<u64> {
    // statfs leaves out purgeable space, which macOS frees on demand; Finder counts it.
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{
            NSArray, NSNumber, NSString, NSURL, NSURLVolumeAvailableCapacityForImportantUsageKey,
        };
        // Callers run on worker threads, which have no autorelease pool.
        let important = objc2::rc::autoreleasepool(|_| {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let key = unsafe { NSURLVolumeAvailableCapacityForImportantUsageKey };
            url.resourceValuesForKeys_error(&NSArray::from_slice(&[key]))
                .ok()
                .and_then(|values| values.objectForKey(key))
                .and_then(|value| value.downcast::<NSNumber>().ok())
                .map(|number| number.longLongValue())
                .filter(|&bytes| bytes > 0)
        });
        match important {
            Some(bytes) => Ok(bytes as u64),
            None => fs2::available_space(path),
        }
    }
    // fs2 uses GetDiskFreeSpaceW, which ignores per-user quotas.
    #[cfg(target_os = "windows")]
    {
        use ::windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut available = 0u64;
        unsafe {
            GetDiskFreeSpaceExW(
                &::windows::core::HSTRING::from(path),
                Some(&mut available),
                None,
                None,
            )
        }?;
        Ok(available)
    }
}

pub fn is_disk_full(err: &anyhow::Error) -> bool {
    err.chain()
        .filter_map(|cause| cause.downcast_ref::<io::Error>())
        .any(|io| {
            matches!(
                io.kind(),
                io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded
            )
        })
}

/// `std::fs::remove_dir_all` deletes through handle-based NT calls that the
/// MSIX file system filter can reject, so Store builds fail to remove
/// directories. `remove_file` and `remove_dir` use the ordinary Win32 calls.
pub fn remove_dir_all_compat(dir: &Path) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            remove_dir_all_compat(&path)?;
        } else {
            remove_file_compat(&path)?;
        }
    }

    fs::remove_dir(dir)
}

/// Moves a file or folder to the Trash (Recycle Bin on Windows).
#[cfg(target_os = "macos")]
pub fn move_to_trash(path: &Path) -> io::Result<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|err| io::Error::other(err.localizedDescription().to_string()))
}

/// Moves a file or folder to the Trash (Recycle Bin on Windows).
#[cfg(target_os = "windows")]
pub fn move_to_trash(path: &Path) -> io::Result<()> {
    use ::windows::Win32::UI::Shell::{
        FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FOF_WANTNUKEWARNING, SHFILEOPSTRUCTW, SHFileOperationW,
    };
    use ::windows::core::PCWSTR;
    use std::os::windows::ffi::OsStrExt;

    // The Shell rejects verbatim (\\?\) paths, which is what canonicalize returns.
    let plain = dunce::simplified(path);

    // pFrom is a list of paths, so it ends with two nulls.
    let from: Vec<u16> = plain.as_os_str().encode_wide().chain([0, 0]).collect();
    // FOF_NOCONFIRMATION alone deletes for good when an item can't be recycled
    // (too large, or no Recycle Bin on that drive); the nuke warning asks first.
    let flags =
        FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING | FOF_NOERRORUI | FOF_SILENT;
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: flags.0 as u16,
        ..Default::default()
    };
    match unsafe { SHFileOperationW(&mut op) } {
        0 if op.fAnyOperationsAborted.as_bool() => Err(io::Error::other("Recycle aborted")),
        0 => Ok(()),
        code => Err(io::Error::other(format!(
            "SHFileOperationW failed: {code:#x}"
        ))),
    }
}

fn remove_file_compat(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        // Windows won't delete a read-only file.
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => {
            let mut permissions = fs::metadata(path)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions)?;
            fs::remove_file(path)
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_type_distinguishes_store_and_github_builds() {
        assert_eq!(install_type_for_store_build(true), "windows_store");
        assert_eq!(install_type_for_store_build(false), "github");
    }
}
