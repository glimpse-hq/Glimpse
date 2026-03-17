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
    use std::process::Command;

    pub fn check_accessibility_permission() -> bool {
        true // Windows doesn't gate accessibility like macOS (Thank you :) )
    }

    pub fn open_accessibility_settings() -> Result<(), String> {
        Command::new("cmd")
            .args(["/C", "start", "ms-settings:easeofaccess"])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open accessibility settings: {e}"))
    }

    pub fn open_microphone_settings() -> Result<(), String> {
        Command::new("cmd")
            .args(["/C", "start", "ms-settings:privacy-microphone"])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open microphone settings: {e}"))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    pub fn check_accessibility_permission() -> bool {
        true
    }

    pub fn open_accessibility_settings() -> Result<(), String> {
        Err("Not available on this platform".to_string())
    }

    pub fn open_microphone_settings() -> Result<(), String> {
        Err("Not available on this platform".to_string())
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use win::*;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use other::*;
