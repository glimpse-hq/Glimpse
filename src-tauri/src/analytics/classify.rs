// Maps raw errors onto fixed reason codes so free text never reaches analytics.

/// Maps an activation error onto a fixed set, so a typed key can never
/// reach analytics through the message.
pub(crate) fn classify_activation_failure(message: &str) -> &'static str {
    let lower = message.to_lowercase();
    if lower.contains("device limit") {
        "device_limit"
    } else if lower.contains("was not found") {
        "not_found"
    } else if lower.contains("not valid for this app") {
        "wrong_product"
    } else if lower.contains("no longer active") {
        "revoked"
    } else if lower.contains("has expired") {
        "expired"
    } else if lower.contains("could not reach") {
        "network"
    } else if lower.contains("unreadable") {
        "bad_response"
    } else if lower.contains("enter your glimpse activation code") {
        "empty_key"
    } else {
        "other"
    }
}

/// Maps a raw error message to a bounded, non-identifying reason code. Rules are
/// checked in order, so earlier (more specific) categories win.
pub fn classify_failure_reason(message: &str) -> &'static str {
    const RULES: &[(&str, &[&str])] = &[
        ("system_audio_permission", &["system_audio_permission"]),
        (
            "selected_apps_not_running",
            &["none of the selected apps are running"],
        ),
        (
            "no_app_audio",
            &["none of the selected apps are producing audio"],
        ),
        (
            "writer_start_failed",
            &[
                "writer did not start",
                "track writer",
                "loopback thread exited",
            ],
        ),
        (
            "worker_unresponsive",
            &[
                "did not respond",
                "not responding",
                "worker is gone",
                "channel closed",
            ],
        ),
        ("os_unsupported", &["needs macos", "needs windows"]),
        ("no_sources", &["no_sources"]),
        ("cancelled", &["cancel"]),
        (
            "permission",
            &["permission", "not allowed", "access denied"],
        ),
        (
            "unauthorized",
            &["unauthorized", "authentication", "api key"],
        ),
        (
            "already_recording",
            &["already in progress", "already_recording"],
        ),
        ("device_busy", &["devicebusy", "temporarily busy"]),
        (
            "device_unavailable",
            &[
                "devicenotavailable",
                "devicechanged",
                "no default input device",
                "no input device",
                "no_microphone",
                "device not found",
                "disconnected",
            ],
        ),
        (
            "unsupported_audio_config",
            &[
                "unsupportedconfig",
                "unsupportedoperation",
                "invalidinput",
                "input configuration",
                "sample format",
            ],
        ),
        (
            "audio_backend",
            &[
                "backenderror",
                "hostunavailable",
                "resourceexhausted",
                "streaminvalidated",
                "coreaudio",
                "wasapi",
                "loopback",
                "audio client",
                "capture client",
                "mix format",
                "com init",
                "io proc",
                "system audio",
            ],
        ),
        ("rate_limited", &["rate limit", "too many requests"]),
        ("quota_exceeded", &["quota", "billing"]),
        ("timeout", &["timeout", "timed out"]),
        ("network", &["network", "connect", "dns"]),
        (
            "model_missing",
            &["not fully installed", "is missing", "no_model"],
        ),
        (
            "model_load",
            &[
                "did not load",
                "whisper context",
                "state pointer",
                "load model",
                "load system language model",
            ],
        ),
        ("out_of_memory", &["out of memory", "alloc"]),
        (
            "inference",
            &[
                "encoder",
                "decoder",
                "evaluate model",
                "generic whisper error",
                "spectrogram",
                "null pointer",
                "onnx runtime",
            ],
        ),
        ("not_found", &["not found", "no such file"]),
        (
            "no_speech",
            &["no speech", "empty", "no samples", "no audio"],
        ),
        ("decode", &["decode", "ffmpeg", "wav", "audio processing"]),
        ("verification", &["checksum", "verify"]),
        ("storage", &["disk", "write", "save", "storage"]),
        ("task_failed", &["task", "join"]),
        ("lock_poisoned", &["poisoned"]),
        ("model_error", &["model"]),
    ];
    let message = message.to_ascii_lowercase();
    RULES
        .iter()
        .find(|(_, needles)| needles.iter().any(|needle| message.contains(needle)))
        .map_or("unknown", |(reason, _)| *reason)
}

/// Classifies an error, falling back to the full cause chain when the outermost
/// message alone yields nothing. `anyhow`'s plain Display shows only the
/// outermost context, so the matchable text is often in the chain.
pub fn classify_error(err: &anyhow::Error) -> &'static str {
    match classify_failure_reason(&err.to_string()) {
        "unknown" => classify_failure_reason(&format!("{err:#}")),
        reason => reason,
    }
}

/// Bounded description of an error: a reason code, which error type matched,
/// and the numeric OS error code when there is one. Never any message text.
pub struct ErrorDetail {
    pub reason: &'static str,
    pub error_type: &'static str,
    pub os_error: Option<i64>,
}

/// Classifies by the first typed error in the cause chain, then by keywords.
/// Only numbers are ever read out of message text.
pub fn error_detail(err: &anyhow::Error) -> ErrorDetail {
    let typed = err
        .chain()
        .find_map(typed_detail)
        // A value attached with `.context(err)` is only reachable through anyhow.
        .or_else(|| err.downcast_ref::<reqwest::Error>().map(reqwest_detail));
    let text = format!("{err:#}");
    let mut detail = typed.unwrap_or(ErrorDetail {
        reason: "unknown",
        error_type: "anyhow",
        os_error: None,
    });
    if detail.os_error.is_none() {
        detail.os_error = os_code_in_text(&text);
    }
    if detail.reason == "unknown" {
        detail.reason = http_status_in_text(&text)
            .map(http_status_reason)
            .or_else(|| detail.os_error.and_then(hresult_reason))
            .unwrap_or_else(|| classify_error(err));
    }
    detail
}

fn typed_detail(cause: &(dyn std::error::Error + 'static)) -> Option<ErrorDetail> {
    if let Some(err) = cause.downcast_ref::<std::io::Error>() {
        return Some(io_detail(err));
    }
    if let Some(err) = cause.downcast_ref::<cpal::Error>() {
        return Some(cpal_detail(err));
    }
    if let Some(err) = cause.downcast_ref::<reqwest::Error>() {
        return Some(reqwest_detail(err));
    }
    if let Some(err) = cause.downcast_ref::<tauri_plugin_updater::Error>() {
        return Some(updater_detail(err));
    }
    if let Some(err) = cause.downcast_ref::<glimpse_speech::remote::RemoteError>() {
        return Some(remote_detail(err));
    }
    if cause
        .downcast_ref::<crate::recorder::NoInputDevice>()
        .is_some()
    {
        return Some(ErrorDetail {
            reason: "device_unavailable",
            error_type: "recorder",
            os_error: None,
        });
    }
    #[cfg(target_os = "windows")]
    if let Some(err) = cause.downcast_ref::<windows::core::Error>() {
        let code = err.code().0;
        return Some(ErrorDetail {
            reason: hresult_reason(code.into()).unwrap_or("unknown"),
            error_type: "windows",
            os_error: Some(code.into()),
        });
    }
    None
}

fn io_detail(err: &std::io::Error) -> ErrorDetail {
    use std::io::ErrorKind;
    // `io::Error::other(inner)` hides a typed error behind kind Other.
    if err.raw_os_error().is_none()
        && let Some(detail) = err.get_ref().and_then(|inner| typed_detail(inner))
    {
        return detail;
    }
    let os_error = err.raw_os_error().map(i64::from);
    let reason = match err.kind() {
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => "permission",
        ErrorKind::NotFound => "not_found",
        ErrorKind::TimedOut => "timeout",
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded | ErrorKind::FileTooLarge => "storage",
        ErrorKind::ConnectionRefused
        | ErrorKind::ConnectionReset
        | ErrorKind::ConnectionAborted
        | ErrorKind::NotConnected
        | ErrorKind::HostUnreachable
        | ErrorKind::NetworkUnreachable
        | ErrorKind::NetworkDown
        | ErrorKind::BrokenPipe
        | ErrorKind::UnexpectedEof => "network",
        ErrorKind::OutOfMemory => "out_of_memory",
        ErrorKind::ResourceBusy | ErrorKind::ExecutableFileBusy => "file_busy",
        ErrorKind::Interrupted => "cancelled",
        ErrorKind::InvalidData => "decode",
        ErrorKind::AlreadyExists | ErrorKind::DirectoryNotEmpty | ErrorKind::CrossesDevices => {
            "storage"
        }
        _ => os_error.and_then(hresult_reason).unwrap_or("unknown"),
    };
    ErrorDetail {
        reason,
        error_type: "io",
        os_error,
    }
}

fn cpal_detail(err: &cpal::Error) -> ErrorDetail {
    use cpal::ErrorKind;
    let reason = match err.kind() {
        ErrorKind::DeviceBusy => "device_busy",
        ErrorKind::DeviceNotAvailable | ErrorKind::DeviceChanged => "device_unavailable",
        ErrorKind::PermissionDenied => "permission",
        ErrorKind::UnsupportedConfig
        | ErrorKind::UnsupportedOperation
        | ErrorKind::InvalidInput => "unsupported_audio_config",
        ErrorKind::ResourceExhausted
        | ErrorKind::StreamInvalidated
        | ErrorKind::HostUnavailable
        | ErrorKind::BackendError
        | ErrorKind::RealtimeDenied
        | ErrorKind::Xrun => "audio_backend",
        _ => "unknown",
    };
    // Backends carry the OSStatus or HRESULT only in the message.
    let os_error = err.message().and_then(os_code_in_text);
    ErrorDetail {
        reason: match reason {
            "audio_backend" => os_error.and_then(hresult_reason).unwrap_or(reason),
            _ => reason,
        },
        error_type: "cpal",
        os_error,
    }
}

fn reqwest_detail(err: &reqwest::Error) -> ErrorDetail {
    let reason = if err.is_timeout() {
        "timeout"
    } else if err.is_connect() {
        "network"
    } else if let Some(status) = err.status() {
        http_status_reason(status.as_u16())
    } else if err.is_decode() {
        "bad_response"
    } else if err.is_body() || err.is_request() {
        "network"
    } else {
        "unknown"
    };
    ErrorDetail {
        reason,
        error_type: "reqwest",
        os_error: None,
    }
}

fn updater_detail(err: &tauri_plugin_updater::Error) -> ErrorDetail {
    use tauri_plugin_updater::Error;
    let reason = match err {
        Error::Io(err) => return io_detail(err),
        Error::Reqwest(err) => return reqwest_detail(err),
        Error::Network(message) => http_status_in_text(message)
            .map(http_status_reason)
            .unwrap_or("network"),
        Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "not_found"
        }
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => "verification",
        Error::Serialization(_) | Error::Semver(_) | Error::InvalidUpdaterFormat => "bad_response",
        Error::AuthenticationFailed => "permission",
        Error::PackageInstallFailed | Error::BinaryNotFoundInArchive => "install",
        Error::TempDirNotFound | Error::FailedToDetermineExtractPath => "storage",
        _ => "unknown",
    };
    ErrorDetail {
        reason,
        error_type: "updater",
        os_error: None,
    }
}

fn remote_detail(err: &glimpse_speech::remote::RemoteError) -> ErrorDetail {
    use glimpse_speech::remote::RemoteErrorKind;
    let reason = match err.kind {
        RemoteErrorKind::RateLimited => "rate_limited",
        RemoteErrorKind::QuotaExceeded => "quota_exceeded",
        RemoteErrorKind::Unauthorized => "unauthorized",
        RemoteErrorKind::NotFound => "not_found",
        _ if err.status == 0 => "network",
        _ => http_status_reason(err.status),
    };
    ErrorDetail {
        reason,
        error_type: "remote",
        os_error: None,
    }
}

fn http_status_reason(status: u16) -> &'static str {
    match status {
        401 | 403 => "unauthorized",
        404 => "not_found",
        408 => "timeout",
        429 => "rate_limited",
        400..=499 => "http_4xx",
        500..=599 => "http_5xx",
        _ => "unknown",
    }
}

// HRESULTs are the same numbers on every platform, and flattened Windows
// errors carry them in their message.
fn hresult_reason(code: i64) -> Option<&'static str> {
    let reason = match code as i32 as u32 {
        0x8007_0005 => "permission",                       // E_ACCESSDENIED
        0x8007_000E => "out_of_memory",                    // E_OUTOFMEMORY
        0x8007_0002 | 0x8007_0003 => "not_found",          // ERROR_FILE/PATH_NOT_FOUND
        0x8007_0070 => "storage",                          // ERROR_DISK_FULL
        0x8007_0020 => "file_busy",                        // ERROR_SHARING_VIOLATION
        0x8889_0004 | 0x8889_000F => "device_unavailable", // DEVICE_INVALIDATED, ENDPOINT_CREATE_FAILED
        0x8889_000A => "device_busy",                      // AUDCLNT_E_DEVICE_IN_USE
        0x8889_0008 => "unsupported_audio_config",         // AUDCLNT_E_UNSUPPORTED_FORMAT
        0x8889_0010 => "audio_backend",                    // AUDCLNT_E_SERVICE_NOT_RUNNING
        _ => return None,
    };
    Some(reason)
}

/// Reads the numeric OS code that Rust, Core Audio and Windows put in error
/// messages: `(os error N)`, `OSStatus N`, or a `0x` HRESULT.
fn os_code_in_text(text: &str) -> Option<i64> {
    for marker in ["os error ", "OSStatus: ", "OSStatus "] {
        if let Some(code) = text
            .split(marker)
            .nth(1)
            .and_then(|rest| leading_int(rest.trim_start()))
        {
            return Some(code);
        }
    }
    text.match_indices("0x").find_map(|(index, _)| {
        let hex: String = text[index + 2..]
            .chars()
            .take_while(char::is_ascii_hexdigit)
            .collect();
        let code = u32::from_str_radix(&hex, 16).ok()?;
        (hex.len() == 8 && code >= 0x8000_0000).then_some(i64::from(code as i32))
    })
}

fn leading_int(text: &str) -> Option<i64> {
    let end = text
        .char_indices()
        .find(|&(index, c)| !(c.is_ascii_digit() || (index == 0 && c == '-')))
        .map_or(text.len(), |(index, _)| index);
    text[..end].parse().ok()
}

/// Finds an HTTP status written as `status 503` or `status: 503`.
fn http_status_in_text(text: &str) -> Option<u16> {
    let lower = text.to_ascii_lowercase();
    lower.match_indices("status").find_map(|(index, word)| {
        let rest = lower[index + word.len()..].trim_start_matches([':', ' ']);
        let digits = rest.get(..3)?;
        let after = rest[3..].chars().next();
        if after.is_some_and(|c| c.is_ascii_digit()) {
            return None;
        }
        digits
            .parse()
            .ok()
            .filter(|status| (400..600).contains(status))
    })
}

impl From<&'static str> for ErrorDetail {
    fn from(reason: &'static str) -> Self {
        ErrorDetail {
            reason,
            error_type: "none",
            os_error: None,
        }
    }
}

impl ErrorDetail {
    /// Adds `reason`, plus `error_type` and `os_error` when known.
    pub(crate) fn insert_into(&self, props: &mut serde_json::Value) {
        props["reason"] = self.reason.into();
        if self.error_type != "none" {
            props["error_type"] = self.error_type.into();
        }
        if let Some(code) = self.os_error {
            props["os_error"] = code.into();
        }
    }
}
