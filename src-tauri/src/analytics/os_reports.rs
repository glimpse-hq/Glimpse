// Crash reports the OS wrote for a run that died without a marker of its own.
// Only the exception type or code and module+offset frames are kept.

use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde_json::json;

use super::crash::{capture_exception, crash_context, merge_json_objects};
use crate::AppRuntime;

#[cfg(target_os = "macos")]
const MAX_FRAMES: usize = 5;

struct OsFrame {
    // `module+0xoffset`, file name only.
    label: String,
    in_app: bool,
}

struct OsReport {
    kind: &'static str,
    crashed_version: Option<String>,
    exception_type: String,
    signal: Option<String>,
    termination_namespace: Option<String>,
    termination_code: Option<i64>,
    frames: Vec<OsFrame>,
}

/// Records the OS crash report (macOS `.ips`, Windows WER) for the previous
/// run, if one was written after it started: the exception type, signal or
/// exception code, termination code, and up to 5 frames as module+offset.
/// Paths, thread names, and any message text in the report are dropped.
pub(super) fn report_os_crash(app: &tauri::AppHandle<AppRuntime>, session_started_at: u64) {
    let Some(report) = newest_report(session_started_at) else {
        return;
    };
    let top_frame = report
        .frames
        .iter()
        .find(|frame| frame.in_app)
        .or(report.frames.first())
        .map_or("unknown", |frame| frame.label.as_str());
    let faulting_module = report
        .frames
        .first()
        .and_then(|frame| frame.label.split('+').next())
        .unwrap_or("unknown");
    let payload = json!({
        "crashed_version": report.crashed_version,
        "location": top_frame,
        "crash_type": "native",
        "crash_phase": "unknown",
        "activity": "unknown",
        "exception_code": report.exception_type,
        "faulting_module": faulting_module,
        "os_report": report.kind,
        "signal": report.signal,
        "termination_namespace": report.termination_namespace,
        "termination_code": report.termination_code,
        "frames": report.frames.iter().map(|frame| frame.label.as_str()).collect::<Vec<_>>(),
        "session_started_at": session_started_at,
    });
    let frames = report
        .frames
        .iter()
        .map(|frame| {
            json!({
                "filename": frame.label,
                "function": "<native>",
                "lang": "native",
                "platform": "native",
                "in_app": frame.in_app,
                "synthetic": true,
                "resolved": false,
            })
        })
        .collect();
    let diagnostics = crash_context(app, &payload);
    let extra = merge_json_objects(
        payload,
        json!({
            "diagnostics": diagnostics,
            "$exception_fingerprint": format!("native:{top_frame}:{}", report.exception_type),
        }),
    );
    capture_exception(
        app,
        &report.exception_type,
        top_frame,
        "os_report",
        false,
        frames,
        extra,
    );
}

fn newest_modified(paths: impl Iterator<Item = PathBuf>, since: u64) -> Option<PathBuf> {
    paths
        .filter_map(|path| {
            let modified = path
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_secs();
            (modified >= since).then_some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .chars()
        .take(64)
        .collect()
}

#[cfg(target_os = "macos")]
fn newest_report(since: u64) -> Option<OsReport> {
    let dir = PathBuf::from(std::env::var_os("HOME")?).join("Library/Logs/DiagnosticReports");
    let candidates = std::fs::read_dir(dir).ok()?.flatten().filter_map(|entry| {
        let name = entry.file_name();
        let name = name.to_str()?;
        (name.starts_with("Glimpse-") && name.ends_with(".ips")).then(|| entry.path())
    });
    parse_ips(&std::fs::read_to_string(newest_modified(candidates, since)?).ok()?)
}

// Line 1 is a JSON header, the rest is the JSON report body.
#[cfg(target_os = "macos")]
fn parse_ips(contents: &str) -> Option<OsReport> {
    let (header, body) = contents.split_once('\n')?;
    let header: serde_json::Value = serde_json::from_str(header).ok()?;
    // 309 is a crash; other types (hangs, resource reports) share the extension.
    if header["bug_type"].as_str() != Some("309") {
        return None;
    }
    let body: serde_json::Value = serde_json::from_str(body).ok()?;
    let images = body["usedImages"].as_array();
    let thread = body["threads"].get(usize::try_from(body["faultingThread"].as_u64()?).ok()?)?;
    let frames = thread["frames"]
        .as_array()?
        .iter()
        .take(MAX_FRAMES)
        .map(|frame| {
            let image = frame["imageIndex"]
                .as_u64()
                .and_then(|index| images?.get(usize::try_from(index).ok()?));
            let name = image
                .and_then(|image| image["name"].as_str())
                .map_or_else(|| "unknown".to_string(), file_name);
            let in_app = image
                .and_then(|image| image["path"].as_str())
                .is_some_and(|path| path.contains("Glimpse.app/Contents/"));
            OsFrame {
                label: format!("{name}+{:#x}", frame["imageOffset"].as_u64().unwrap_or(0)),
                in_app,
            }
        })
        .collect();
    let text = |value: &serde_json::Value| value.as_str().map(str::to_string);
    Some(OsReport {
        kind: "ips",
        crashed_version: text(&header["app_version"]),
        exception_type: text(&body["exception"]["type"]).unwrap_or_else(|| "unknown".into()),
        signal: text(&body["exception"]["signal"]),
        termination_namespace: text(&body["termination"]["namespace"]),
        termination_code: body["termination"]["code"].as_i64(),
        frames,
    })
}

#[cfg(target_os = "windows")]
fn newest_report(since: u64) -> Option<OsReport> {
    let wer = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(r"Microsoft\Windows\WER");
    let candidates = ["ReportArchive", "ReportQueue"]
        .iter()
        .filter_map(|folder| std::fs::read_dir(wer.join(folder)).ok())
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let (kind, rest) = name.to_str()?.split_once('_')?;
            let ours = matches!(kind, "AppCrash" | "BEX64" | "BEX")
                && rest
                    .get(..12)
                    .is_some_and(|exe| exe.eq_ignore_ascii_case("Glimpse.exe_"));
            ours.then(|| entry.path().join("Report.wer"))
        });
    let bytes = std::fs::read(newest_modified(candidates, since)?).ok()?;
    let text = match bytes.strip_prefix(&[0xFF, 0xFE]) {
        Some(utf16) => String::from_utf16_lossy(
            &utf16
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        ),
        None => String::from_utf8_lossy(&bytes).into_owned(),
    };
    parse_wer(&text)
}

// Key=value lines. APPCRASH puts the exception code in Sig[6] and the offset
// in Sig[7]; BEX (fail-fast, buffer overrun) swaps them.
#[cfg(target_os = "windows")]
fn parse_wer(text: &str) -> Option<OsReport> {
    let value = |key: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
            .map(str::trim)
    };
    if !value("Sig[0].Value")?.eq_ignore_ascii_case("Glimpse.exe") {
        return None;
    }
    let (code_key, offset_key) = if value("EventType")?.starts_with("BEX") {
        ("Sig[7].Value", "Sig[6].Value")
    } else {
        ("Sig[6].Value", "Sig[7].Value")
    };
    let hex = |raw: &str| u64::from_str_radix(raw.trim_start_matches("0x"), 16).ok();
    let code = hex(value(code_key)?)?;
    let module = value("Sig[3].Value").map_or_else(|| "unknown".to_string(), file_name);
    let offset = value(offset_key).and_then(hex).unwrap_or(0);
    let in_app = module.eq_ignore_ascii_case("Glimpse.exe");
    Some(OsReport {
        kind: "wer",
        crashed_version: value("Sig[1].Value").map(str::to_string),
        exception_type: format!("{code:#010x}"),
        signal: None,
        termination_namespace: None,
        termination_code: None,
        frames: vec![OsFrame {
            label: format!("{module}+{offset:#x}"),
            in_app,
        }],
    })
}
