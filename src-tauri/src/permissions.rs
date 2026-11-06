//! macOS permission checking for microphone, accessibility, and input monitoring access.

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Check if accessibility (AX) permission is granted.
    pub fn check_accessibility_permission() -> bool {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXIsProcessTrusted() -> u8;
        }

        unsafe { AXIsProcessTrusted() != 0 }
    }

    static ACCESSIBILITY_WATCH: AtomicBool = AtomicBool::new(false);

    /// Polls until accessibility is granted, then runs `on_granted` once.
    /// Does nothing while a watch is already running.
    pub fn watch_accessibility_grant(on_granted: impl FnOnce() + Send + 'static) {
        if ACCESSIBILITY_WATCH.swap(true, Ordering::AcqRel) {
            return;
        }

        let spawned = std::thread::Builder::new()
            .name("accessibility-watch".to_string())
            .spawn(move || {
                while !check_accessibility_permission() {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                ACCESSIBILITY_WATCH.store(false, Ordering::Release);
                on_granted();
            });
        if spawned.is_err() {
            ACCESSIBILITY_WATCH.store(false, Ordering::Release);
        }
    }

    /// Opens the Accessibility pane with a tile beside it that drags Glimpse
    /// into the list. Main thread only.
    pub fn open_accessibility_settings(instruction: &str) -> Result<(), String> {
        unsafe extern "C" {
            fn glimpse_show_accessibility_guide(instruction: *const std::ffi::c_char);
        }
        let instruction = std::ffi::CString::new(instruction).map_err(|e| e.to_string())?;
        unsafe { glimpse_show_accessibility_guide(instruction.as_ptr()) };
        Ok(())
    }

    /// Open System Settings to the sound input devices.
    pub fn open_sound_settings() -> Result<(), String> {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.sound?input")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open System Settings: {e}"))
    }

    /// Open System Settings to the Microphone privacy pane.
    pub fn open_microphone_settings() -> Result<(), String> {
        let result = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn();

        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open System Settings: {}", e)),
        }
    }

    /// Check if microphone permission is granted. Preflights TCC over XPC, which can block.
    pub fn check_microphone_permission() -> bool {
        tauri::async_runtime::block_on(async {
            tauri_plugin_macos_permissions::check_microphone_permission().await
        })
    }

    static MICROPHONE_GRANTED: AtomicBool = AtomicBool::new(false);
    static MICROPHONE_CHECKED: AtomicBool = AtomicBool::new(false);

    pub fn check_microphone_permission_cached() -> bool {
        if MICROPHONE_GRANTED.load(Ordering::Relaxed) {
            return true;
        }

        let granted = check_microphone_permission();
        if granted {
            MICROPHONE_GRANTED.store(true, Ordering::Relaxed);
        }
        MICROPHONE_CHECKED.store(true, Ordering::Relaxed);
        granted
    }

    /// Re-queries TCC and updates the cache, so a revoked grant is picked up.
    pub fn refresh_microphone_permission() -> bool {
        let granted = check_microphone_permission();
        MICROPHONE_GRANTED.store(granted, Ordering::Relaxed);
        MICROPHONE_CHECKED.store(true, Ordering::Relaxed);
        granted
    }

    /// The last known grant without querying TCC; None before the first check.
    pub fn microphone_permission_known() -> Option<bool> {
        if MICROPHONE_GRANTED.load(Ordering::Relaxed) {
            Some(true)
        } else {
            MICROPHONE_CHECKED.load(Ordering::Relaxed).then_some(false)
        }
    }

    static REFRESH_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

    /// Refreshes off the caller's thread, for hot paths that must not block.
    pub fn refresh_microphone_permission_detached() {
        if REFRESH_IN_FLIGHT.swap(true, Ordering::Relaxed) {
            return;
        }

        std::thread::spawn(|| {
            let _ = refresh_microphone_permission();
            REFRESH_IN_FLIGHT.store(false, Ordering::Relaxed);
        });
    }

    /// Request microphone permission from macOS.
    pub fn request_microphone_permission() -> Result<(), String> {
        tauri::async_runtime::block_on(async {
            tauri_plugin_macos_permissions::request_microphone_permission().await
        })
    }

    /// Shows macOS's microphone prompt and waits for the answer, or opens the
    /// Microphone pane when macOS won't ask again.
    pub async fn ask_microphone_permission() -> Result<(), String> {
        use objc2::{class, msg_send, runtime::Bool};
        use objc2_foundation::NSString;

        let answered = {
            let media = NSString::from_str("soun");
            let status: isize = unsafe {
                msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media]
            };
            match status {
                3 => return Ok(()),
                0 => {}
                _ => return open_microphone_settings(),
            }
            let (tx, rx) = tokio::sync::oneshot::channel();
            let tx = std::sync::Mutex::new(Some(tx));
            let done = block2::RcBlock::new(move |_: Bool| {
                if let Some(tx) = tx.lock().ok().and_then(|mut tx| tx.take()) {
                    let _ = tx.send(());
                }
            });
            unsafe {
                let _: () = msg_send![
                    class!(AVCaptureDevice),
                    requestAccessForMediaType: &*media,
                    completionHandler: &*done
                ];
            }
            rx
        };
        let _ = answered.await;
        Ok(())
    }

    /// Open System Settings to the Input Monitoring privacy pane.
    pub fn open_input_monitoring_settings() -> Result<(), String> {
        let result = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn();

        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open System Settings: {}", e)),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod other {
    pub fn check_accessibility_permission() -> bool {
        true
    }

    pub fn open_accessibility_settings(_instruction: &str) -> Result<(), String> {
        Err("Accessibility settings are only available on macOS".to_string())
    }

    pub fn open_microphone_settings() -> Result<(), String> {
        std::process::Command::new("explorer")
            .arg("ms-settings:privacy-microphone")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open Windows Settings: {e}"))
    }

    pub fn open_sound_settings() -> Result<(), String> {
        std::process::Command::new("explorer")
            .arg("ms-settings:sound")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open Windows Settings: {e}"))
    }

    /// Reads the Windows privacy switches (device, all apps, this app) from the registry.
    pub fn check_microphone_permission() -> bool {
        const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

        let app_key = match crate::platform::windows::store::package_family_name() {
            Some(family) => format!(r"{CONSENT}\{family}"),
            None => format!(r"{CONSENT}\NonPackaged"),
        };

        !is_denied(CONSENT, true) && !is_denied(CONSENT, false) && !is_denied(&app_key, false)
    }

    // A missing key or value is the Windows default, which allows access.
    // hklm_only=false reads HKCU and falls back to HKLM.
    fn is_denied(subkey: &str, hklm_only: bool) -> bool {
        use windows::Win32::Foundation::ERROR_SUCCESS;
        use windows::Win32::UI::Shell::SHRegGetUSValueW;
        use windows::core::HSTRING;

        let mut buffer = [0u16; 16];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let err = unsafe {
            SHRegGetUSValueW(
                &HSTRING::from(subkey),
                &HSTRING::from("Value"),
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size as *mut u32),
                hklm_only,
                None,
                0,
            )
        };
        if err != ERROR_SUCCESS {
            return false;
        }
        let len = (size as usize / 2).min(buffer.len());
        String::from_utf16_lossy(&buffer[..len]).trim_end_matches('\0') == "Deny"
    }

    pub fn request_microphone_permission() -> Result<(), String> {
        Ok(())
    }

    pub async fn ask_microphone_permission() -> Result<(), String> {
        Ok(())
    }

    pub fn open_input_monitoring_settings() -> Result<(), String> {
        Err("Input Monitoring settings are only available on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use other::*;
