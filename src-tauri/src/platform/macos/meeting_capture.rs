use std::ffi::{CStr, CString, c_char};
use std::path::Path;

use anyhow::{Result, anyhow};
use serde::Deserialize;

unsafe extern "C" {
    fn gm_meeting_start(
        system_path: *const c_char,
        microphone_path: *const c_char,
        microphone_device_uid: *const c_char,
        application_bundle_identifier: *const c_char,
    ) -> *mut c_char;
    fn gm_meeting_stop() -> *mut c_char;
    fn gm_meeting_levels() -> *mut c_char;
    fn gm_meeting_string_free(value: *mut c_char);
}

#[derive(Deserialize)]
struct CaptureResult {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    microphone_name: Option<String>,
    #[serde(default)]
    microphone_level: f32,
    #[serde(default)]
    system_level: f32,
    #[serde(default)]
    application_isolated: bool,
    #[serde(default)]
    capture_error: Option<String>,
}

fn take_result(value: *mut c_char) -> Result<CaptureResult> {
    if value.is_null() {
        return Err(anyhow!("Meeting capture returned no result"));
    }
    let raw = unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .into_owned();
    unsafe { gm_meeting_string_free(value) };
    let result: CaptureResult = serde_json::from_str(&raw)
        .map_err(|err| anyhow!("Invalid meeting capture response: {err}"))?;
    match result.error {
        Some(message) => Err(anyhow!(message)),
        None => Ok(result),
    }
}

pub struct CaptureInfo {
    pub microphone_name: Option<String>,
    pub application_isolated: bool,
}

pub struct CaptureLevels {
    pub microphone: f32,
    pub system: f32,
    pub capture_error: Option<String>,
}

pub fn start(
    system_path: &Path,
    microphone_path: &Path,
    microphone_device_uid: Option<&str>,
    application_bundle_identifier: Option<&str>,
) -> Result<CaptureInfo> {
    let system_path = CString::new(system_path.to_string_lossy().as_bytes())?;
    let microphone_path = CString::new(microphone_path.to_string_lossy().as_bytes())?;
    let microphone_device_uid = microphone_device_uid.map(CString::new).transpose()?;
    let application_bundle_identifier = application_bundle_identifier
        .map(CString::new)
        .transpose()?;
    let result = take_result(unsafe {
        gm_meeting_start(
            system_path.as_ptr(),
            microphone_path.as_ptr(),
            microphone_device_uid
                .as_ref()
                .map_or(std::ptr::null(), |value| value.as_ptr()),
            application_bundle_identifier
                .as_ref()
                .map_or(std::ptr::null(), |value| value.as_ptr()),
        )
    })?;
    Ok(CaptureInfo {
        microphone_name: result
            .microphone_name
            .filter(|name| !name.trim().is_empty()),
        application_isolated: result.application_isolated,
    })
}

pub fn stop() -> Result<()> {
    take_result(unsafe { gm_meeting_stop() }).map(|_| ())
}

pub fn levels() -> Result<CaptureLevels> {
    let result = take_result(unsafe { gm_meeting_levels() })?;
    Ok(CaptureLevels {
        microphone: result.microphone_level.clamp(0.0, 1.0),
        system: result.system_level.clamp(0.0, 1.0),
        capture_error: result.capture_error,
    })
}
