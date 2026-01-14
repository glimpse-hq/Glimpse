//! macOS permission checking for microphone and accessibility access.

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;

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
                eprintln!("[Glimpse] Accessibility osascript check: {}", success);
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

#[cfg(not(target_os = "macos"))]
mod other {
    pub fn check_accessibility_permission() -> bool {
        true
    }

    pub fn open_accessibility_settings() -> Result<(), String> {
        Err("Accessibility settings are only available on macOS".to_string())
    }

    pub fn open_microphone_settings() -> Result<(), String> {
        Err("Microphone settings are only available on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use other::*;
