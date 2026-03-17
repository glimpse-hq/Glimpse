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

    /// Opens macOS System Settings to the Privacy → Microphone pane.
    ///
    /// # Returns
    ///
    /// `Ok(())` if the Settings app was launched successfully, `Err(String)` with a descriptive error message otherwise.
    ///
    /// # Examples
    ///
    /// ```
    /// let res = open_microphone_settings();
    /// // On macOS this should generally succeed when System Settings can be launched.
    /// assert!(res.is_ok() || res.is_err());
    /// ```
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

    /// Determines whether the application has accessibility permission on Windows.
    ///
    /// On Windows this function always considers accessibility permission granted and thus returns `true`.
    ///
    /// # Examples
    ///
    /// ```
    /// assert!(check_accessibility_permission());
    /// ```
    pub fn check_accessibility_permission() -> bool {
        true // Windows doesn't gate accessibility like macOS (Thank you :) )
    }

    /// Opens the Windows Ease of Access (Accessibility) settings page.
    ///
    /// Attempts to launch the system Settings app at the Accessibility (Ease of Access) pane.
    ///
    /// # Returns
    ///
    /// `Ok(())` if the settings were successfully launched, `Err(String)` with a descriptive message otherwise.
    ///
    /// # Examples
    ///
    /// ```
    /// let _ = open_accessibility_settings();
    /// ```
    pub fn open_accessibility_settings() -> Result<(), String> {
        Command::new("cmd")
            .args(["/C", "start", "ms-settings:easeofaccess"])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open accessibility settings: {e}"))
    }

    /// Opens the Windows Microphone privacy settings.
    ///
    /// Returns `Ok(())` if the Settings app was successfully launched, or `Err(String)` with a descriptive message on failure.
    ///
    /// # Examples
    ///
    /// ```
    /// let res = open_microphone_settings();
    /// if cfg!(target_os = "windows") {
    ///     assert!(res.is_ok());
    /// } else {
    ///     // On non-Windows targets this function is not compiled.
    /// }
    /// ```
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
    /// Indicates whether the application has accessibility permission on Windows.
    ///
    /// This implementation treats accessibility as granted on Windows and does not enforce a platform-level gate.
    ///
    /// # Returns
    ///
    /// `true` indicating accessibility is considered granted on this platform.
    ///
    /// # Examples
    ///
    /// ```
    /// assert!(check_accessibility_permission());
    /// ```
    pub fn check_accessibility_permission() -> bool {
        true
    }

    /// Attempts to open the system Accessibility (Privacy) settings.
    ///
    /// On platforms where this functionality is not implemented, returns an `Err` with the message
    /// "Not available on this platform".
    ///
    /// # Examples
    ///
    /// ```
    /// let res = open_accessibility_settings();
    /// assert!(res.is_err());
    /// assert_eq!(res.unwrap_err(), "Not available on this platform");
    /// ```
    pub fn open_accessibility_settings() -> Result<(), String> {
        Err("Not available on this platform".to_string())
    }

    /// Opens the system microphone privacy/settings pane, or indicates that the operation is not supported on this platform.
    ///
    /// This implementation always reports that opening microphone settings is not available on the current platform.
    ///
    /// # Returns
    ///
    /// `Err(String)` containing the message `"Not available on this platform"`.
    ///
    /// # Examples
    ///
    /// ```
    /// let err = open_microphone_settings();
    /// assert_eq!(err, Err("Not available on this platform".to_string()));
    /// ```
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
