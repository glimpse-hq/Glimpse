//! `glimpse dev …` - drives the screenshot sandbox started by
//! `scripts/screenshots/run.mjs`. Debug builds only, and the app answers only
//! when it was started as the sandbox (see [`super::dev_sandbox`]).

use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Listener, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use super::{client, output, str_flag, wants_help};
use crate::license::DevLicense;
use crate::{AppRuntime, AppState, toast};

const REPLY_EVENT: &str = "dev:reply";
const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
const RESEND_INTERVAL: Duration = Duration::from_millis(250);
// How much of a parked window stays on screen. macOS can't capture a window
// that is entirely off screen.
#[cfg(target_os = "macos")]
const PARKED_VISIBLE_WIDTH: f64 = 40.0;

fn help() {
    super::print_command_help(
        "Drive the screenshot sandbox. Debug builds only.",
        "glimpse dev <command> [arguments]",
        &[(
            "COMMANDS",
            &[
                ("identifier", "Print this build's app identifier."),
                (
                    "license <state>",
                    "none, trial, trial-last-day, expired, unlocked-1 or unlocked-3.",
                ),
                (
                    "onboarding <action>",
                    "reset, complete, a step, download-failed, disk-full, setup-failed, faq or close.",
                ),
                (
                    "show <what>",
                    "trial-ended, release-notes [--markdown <text>], toast <id> or nothing.",
                ),
                (
                    "window <label> <action>",
                    "info, show, hide, size <w> <h> or position <x> <y>.",
                ),
                (
                    "focus on|off",
                    "macOS: activate the sandbox for active window chrome, then give focus back.",
                ),
                (
                    "wait-idle [--window <label>]",
                    "Wait until fonts, queries, images and animations settle.",
                ),
            ],
        )],
    );
}

pub(crate) fn run(identifier: &str, args: &[String], json: bool) -> Result<()> {
    let Some((command, rest)) = args.split_first() else {
        help();
        return Ok(());
    };
    if wants_help(args) {
        help();
        return Ok(());
    }
    if command == "identifier" {
        println!("{identifier}");
        return Ok(());
    }

    let markdown = str_flag(rest, "--markdown")?;
    let window = str_flag(rest, "--window")?;
    let words = super::positionals(rest, &["--markdown", "--window"]);
    let payload = json!({ "args": words, "markdown": markdown, "window": window });
    let Some(data) =
        client::try_request_data(&format!("dev.{command}"), payload, "dev command failed")?
    else {
        bail!("The sandbox app is not running.");
    };
    if json {
        output::print_json_ok(data);
    } else if !data.is_null() {
        println!("{data}");
    }
    Ok(())
}

pub(crate) fn handle(
    app: &AppHandle<AppRuntime>,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    if !super::dev_sandbox() {
        return Err("glimpse dev only drives the screenshot sandbox.".to_string());
    }
    let words: Vec<&str> = args
        .get("args")
        .and_then(Value::as_array)
        .map(|words| words.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    match command {
        "dev.license" => license(app, &words),
        "dev.onboarding" => onboarding(app, &words),
        "dev.show" => show(app, &words, args.get("markdown").and_then(Value::as_str)),
        "dev.window" => window(app, &words),
        "dev.focus" => match words.first().copied() {
            Some("on") => focus(app, true),
            Some("off") => focus(app, false),
            _ => Err("Use glimpse dev focus on|off.".to_string()),
        },
        "dev.wait-idle" => {
            let label = args
                .get("window")
                .and_then(Value::as_str)
                .unwrap_or(crate::SETTINGS_WINDOW_LABEL);
            ask(app, label, "dev:idle", json!({}))
        }
        other => Err(format!("Unknown command: {other}")),
    }
}

fn license(app: &AppHandle<AppRuntime>, words: &[&str]) -> Result<Value, String> {
    let name = words.first().copied().unwrap_or_default();
    let license = DevLicense::parse(name).ok_or_else(|| {
        format!(
            "Unknown license state `{name}`. Use one of: {}.",
            DevLicense::NAMES.join(", ")
        )
    })?;
    crate::license::set_dev_license(Some(license), false);
    license_changed(app)?;
    Ok(json!({ "license": name }))
}

fn license_changed(app: &AppHandle<AppRuntime>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let license_state = crate::license::get_license_state(&state.settings_store)?;
    crate::note_license_state(app, &state, &license_state);
    let _ = app.emit("license:changed", &license_state);
    refetch(app);
    Ok(())
}

// Every query refetches, so screens pick up state that has no event of its own.
fn refetch(app: &AppHandle<AppRuntime>) {
    let _ = app.emit("dev:refetch", ());
}

fn onboarding(app: &AppHandle<AppRuntime>, words: &[&str]) -> Result<Value, String> {
    let action = words.first().copied().unwrap_or_default();
    let state = app.state::<AppState>();
    match action {
        "reset" => crate::core::settings::reset_onboarding(app, &state)?,
        "complete" => {
            let mut settings = state.current_settings_unmasked();
            settings.onboarding_completed = true;
            let next = state
                .persist_settings(settings)
                .map_err(|err| err.to_string())?;
            state.emit_settings_changed(app, &next);
        }
        _ => {
            ask(
                app,
                crate::SETTINGS_WINDOW_LABEL,
                "dev:onboarding",
                json!({ "action": action }),
            )?;
        }
    }
    Ok(json!({ "onboarding": action }))
}

fn show(
    app: &AppHandle<AppRuntime>,
    words: &[&str],
    markdown: Option<&str>,
) -> Result<Value, String> {
    let what = words.first().copied().unwrap_or_default();
    match what {
        "trial-ended" => {
            crate::license::set_dev_license(Some(DevLicense::None), true);
            license_changed(app)?;
        }
        "release-notes" => {
            *crate::announcements::DEV_RELEASE_NOTES.lock() =
                Some(markdown.unwrap_or("- Release notes go here.").to_string());
            refetch(app);
        }
        "nothing" => {
            crate::announcements::DEV_RELEASE_NOTES.lock().take();
            crate::license::set_dev_license(None, false);
            toast::hide(app);
            license_changed(app)?;
        }
        "toast" => show_toast(app, words.get(1).copied().unwrap_or_default())?,
        other => return Err(format!("Unknown screen `{other}`.")),
    }
    Ok(json!({ "shown": words.join(" ") }))
}

fn show_toast(app: &AppHandle<AppRuntime>, id: &str) -> Result<(), String> {
    if id == "milestone" {
        toast::show_word_milestone(app, 9_999, 10_000);
        return Ok(());
    }
    let (toast_type, key, action) = match id {
        "update" => (
            "update",
            "native.toast.update_available",
            Some(("open_about_page", "native.toast.update_action")),
        ),
        "no-words" => ("warning", "native.toast.no_words", None),
        "disk-full" => ("warning", "native.toast.dictation_disk_full", None),
        other => return Err(format!("Unknown toast `{other}`.")),
    };
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: toast_type.to_string(),
            message: toast::native(app, key),
            auto_dismiss: Some(false),
            action: action.map(|(action, _)| action.to_string()),
            action_label: action.map(|(_, label)| toast::native(app, label)),
            ..Default::default()
        },
    );
    Ok(())
}

fn window(app: &AppHandle<AppRuntime>, words: &[&str]) -> Result<Value, String> {
    let [label, action, rest @ ..] = words else {
        return Err("Usage: glimpse dev window <label> <action>".to_string());
    };
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No `{label}` window is open."))?;
    let numbers = || -> Result<(f64, f64), String> {
        match rest {
            [a, b] => a
                .parse()
                .and_then(|a| b.parse().map(|b| (a, b)))
                .map_err(|_| "Expected two numbers.".to_string()),
            _ => Err("Expected two numbers.".to_string()),
        }
    };
    let result = match *action {
        "info" => return window_info(&window),
        "show" => show_in_background(&window),
        "hide" => window.hide(),
        "size" => {
            let (width, height) = numbers()?;
            window.set_size(LogicalSize::new(width, height))
        }
        "position" => {
            let (x, y) = numbers()?;
            window.set_position(LogicalPosition::new(x, y))
        }
        other => return Err(format!("Unknown window action `{other}`.")),
    };
    result.map_err(|err| err.to_string())?;
    window_info(&window)
}

/// The README shots want active window chrome, which needs the app active.
/// Only the sandbox activates itself; hiding it afterwards lets macOS hand
/// focus back to whatever was in front before.
fn focus(app: &AppHandle<AppRuntime>, on: bool) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        if on {
            app.set_activation_policy(ActivationPolicy::Accessory)
                .map_err(|err| err.to_string())?;
            let window = app
                .get_webview_window(crate::SETTINGS_WINDOW_LABEL)
                .ok_or("No settings window is open.")?;
            window.set_focus().map_err(|err| err.to_string())?;
        } else {
            let hidden = app.hide();
            app.set_activation_policy(ActivationPolicy::Prohibited)
                .map_err(|err| err.to_string())?;
            hidden.map_err(|err| err.to_string())?;
        }
    }
    #[cfg(target_os = "windows")]
    let _ = app;
    Ok(json!({ "focus": on }))
}

fn window_info(window: &WebviewWindow<AppRuntime>) -> Result<Value, String> {
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let position = window
        .outer_position()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .outer_size()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(scale);
    Ok(json!({
        "label": window.label(),
        "id": native_id(window)?,
        "visible": window.is_visible().unwrap_or(false),
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
        "scale": scale,
    }))
}

/// The CGWindowID on macOS (for `screencapture -l`), the HWND on Windows.
fn native_id(window: &WebviewWindow<AppRuntime>) -> Result<i64, String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|err| err.to_string())? as usize;
        let (sender, receiver) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                // SAFETY: Tauri's NSWindow pointer, used on the main thread while the window lives.
                let ns_window = unsafe { &*(ns_window as *const objc2::runtime::AnyObject) };
                let number: isize = unsafe { objc2::msg_send![ns_window, windowNumber] };
                let _ = sender.send(number as i64);
            })
            .map_err(|err| err.to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|err| err.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        Ok(hwnd.0 as i64)
    }
}

/// Shows a window without activating the app or raising the window. On macOS
/// it goes behind every other window with all but a sliver right of the
/// displays, and its webview keeps rendering there; on Windows it goes to the
/// bottom of the z-order.
pub(crate) fn show_in_background(window: &WebviewWindow<AppRuntime>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // Right of the rightmost display, at its top. Anchored by the left edge,
        // so a window that resizes stays parked.
        let (right, top) = window
            .available_monitors()?
            .iter()
            .map(|monitor| {
                let scale = monitor.scale_factor();
                let position = monitor.position().to_logical::<f64>(scale);
                let size = monitor.size().to_logical::<f64>(scale);
                (position.x + size.width, position.y)
            })
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .unwrap_or((0.0, 0.0));
        window.set_position(LogicalPosition::new(
            right - PARKED_VISIBLE_WIDTH,
            top + PARKED_VISIBLE_WIDTH,
        ))?;
        let ns_window = window.ns_window()? as usize;
        window.run_on_main_thread(move || {
            // SAFETY: Tauri's NSWindow pointer, used on the main thread while the window lives.
            let ns_window = unsafe { &*(ns_window as *const objc2::runtime::AnyObject) };
            // Panels float above other apps; level 0 is NSNormalWindowLevel.
            let no_sender: Option<&objc2::runtime::AnyObject> = None;
            unsafe {
                let _: () = objc2::msg_send![ns_window, setLevel: 0isize];
                let _: () = objc2::msg_send![ns_window, orderBack: no_sender];
            }
        })?;
        // WebKit stops painting a covered window; this private switch keeps it painting.
        window.with_webview(|webview| {
            // SAFETY: wry's WKWebView, on the main thread.
            let view = unsafe { &*(webview.inner() as *const objc2::runtime::AnyObject) };
            let selector = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
            let supported: bool = unsafe { objc2::msg_send![view, respondsToSelector: selector] };
            if supported {
                let _: () =
                    unsafe { objc2::msg_send![view, _setWindowOcclusionDetectionEnabled: false] };
            }
        })?;
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            HWND_BOTTOM, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
            ShowWindow,
        };
        let hwnd = HWND(window.hwnd()?.0);
        // SAFETY: a live HWND owned by this process.
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        // tao's own show is a no-op now, but it records the window as visible.
        window.show()?;
        // SAFETY: as above.
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
    Ok(())
}

/// Sends `event` to a window's dev hooks (`src/shared/hooks/devSandbox.ts`) and waits for the
/// reply. Resent until answered, since a window that is still loading has no
/// listener yet; the hooks handle each token once.
fn ask(
    app: &AppHandle<AppRuntime>,
    label: &str,
    event: &str,
    mut payload: Value,
) -> Result<Value, String> {
    let token = uuid::Uuid::new_v4().to_string();
    payload["token"] = json!(token);
    let (sender, receiver) = std::sync::mpsc::channel::<Value>();
    let listener = app.listen_any(REPLY_EVENT, move |event| {
        if let Ok(reply) = serde_json::from_str::<Value>(event.payload())
            && reply.get("token").and_then(Value::as_str) == Some(token.as_str())
        {
            let _ = sender.send(reply);
        }
    });
    let deadline = Instant::now() + REPLY_TIMEOUT;
    let reply = loop {
        if app.get_webview_window(label).is_some() {
            let _ = app.emit_to(label, event, &payload);
        }
        if let Ok(reply) = receiver.recv_timeout(RESEND_INTERVAL) {
            break Ok(reply);
        }
        if Instant::now() >= deadline {
            break Err(format!("The `{label}` window didn't answer {event}."));
        }
    };
    app.unlisten(listener);
    let reply = reply?;
    match reply.get("error").and_then(Value::as_str) {
        Some(error) => Err(error.to_string()),
        None => Ok(reply),
    }
}
