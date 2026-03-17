//! Platform permission checking for microphone and accessibility access.

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;
    #[cfg(debug_assertions)]
    use tracing::debug;

    /// Check if accessibility (AX) permission is granted.
    /// Uses AXIsProcessTrusted() from ApplicationServices framework.
    pub fn check_accessibility_permission() -> bool {
        if let Some(result) = check_accessibility_native() {
            return result;
        }

        check_accessibility_osascript()
    }

    /// Native check using AXIsProcessTrusted
    fn check_accessibility_native() -> Option<bool> {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> u8;
        }

        let result = unsafe { AXIsProcessTrusted() };
        Some(result != 0)
    }

    /// Fallback check using osascript to test if we can send keystrokes
    fn check_accessibility_osascript() -> bool {
        let output = Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to return 1"])
            .output();

        match output {
            Ok(result) => {
                let success = result.status.success();
                #[cfg(debug_assertions)]
                debug!(success, "accessibility osascript permission check");
                success
            }
            Err(_) => false,
        }
    }

    /// Open System Settings to the Accessibility privacy pane.
    pub fn open_accessibility_settings() -> Result<(), String> {
        let result = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();

        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open System Settings: {}", e)),
        }
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
}

#[cfg(target_os = "windows")]
mod win {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    const ACCESSIBILITY_URI: &str = "ms-settings:easeofaccess";
    const MICROPHONE_URI: &str = "ms-settings:privacy-microphone";

    /// Windows does not gate accessibility behind a system permission.
    pub fn check_accessibility_permission() -> bool {
        true
    }

    pub fn open_accessibility_settings() -> Result<(), String> {
        shell_open_uri(ACCESSIBILITY_URI)
    }

    pub fn open_microphone_settings() -> Result<(), String> {
        shell_open_uri(MICROPHONE_URI)
    }

    fn shell_open_uri(uri: &str) -> Result<(), String> {
        let uri_value = HSTRING::from(uri);
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &uri_value,
                None::<PCWSTR>,
                None::<PCWSTR>,
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;
        if code > 32 {
            return Ok(());
        }

        Err(format!("ShellExecuteW failed for '{uri}' with code {code}"))
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use win::*;
