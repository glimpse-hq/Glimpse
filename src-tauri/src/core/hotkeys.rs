use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{anyhow, Result};
use handy_keys::{Hotkey, KeyboardListener, Modifiers};
use handy_keys::{HotkeyManager, HotkeyState as HandyHotkeyState};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{pill, AppRuntime};

const REGISTRATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(20);
pub(crate) const SHORTCUT_CAPTURE_EVENT: &str = "shortcut:capture";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HotkeyState {
    Pressed,
    Released,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShortcutAction {
    Smart,
    Hold,
    Toggle,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RegisteredHotkey {
    pub hotkey: Hotkey,
    pub action: ShortcutAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ShortcutCapturePayload {
    Preview { shortcut: String },
    Captured { shortcut: String },
    Error { message: String },
}

#[derive(Default)]
pub(crate) struct HotkeyCoordinator {
    registration: Mutex<Option<WorkerSession>>,
    capture: Mutex<Option<WorkerSession>>,
}

impl HotkeyCoordinator {
    pub(crate) fn replace_registrations(
        &self,
        app: &AppHandle<AppRuntime>,
        bindings: Vec<RegisteredHotkey>,
    ) -> Result<()> {
        self.stop_registration();

        if bindings.is_empty() {
            return Ok(());
        }

        let app_handle = app.clone();
        let session = WorkerSession::spawn("shortcut-registration", move |stop_rx| {
            let manager = HotkeyManager::new_with_blocking()?;
            let mut actions = Vec::with_capacity(bindings.len());

            for binding in bindings {
                let id = manager.register(binding.hotkey).map_err(|err| {
                    anyhow!("Failed to register shortcut `{}`: {err}", binding.hotkey)
                })?;
                actions.push((id, binding.action));
            }

            loop {
                if should_stop(&stop_rx) {
                    break;
                }

                if let Some(event) = manager.try_recv() {
                    if let Some((_, action)) = actions
                        .iter()
                        .find(|(registered_id, _)| *registered_id == event.id)
                    {
                        let state = match event.state {
                            HandyHotkeyState::Pressed => HotkeyState::Pressed,
                            HandyHotkeyState::Released => HotkeyState::Released,
                        };
                        pill::handle_registered_hotkey_event(&app_handle, *action, state);
                    }
                    continue;
                }

                thread::sleep(REGISTRATION_POLL_INTERVAL);
            }

            Ok(())
        })?;

        *self.registration.lock() = Some(session);
        Ok(())
    }

    pub(crate) fn stop_registration(&self) {
        self.registration.lock().take();
    }

    pub(crate) fn start_capture(&self, app: &AppHandle<AppRuntime>) -> Result<()> {
        self.stop_capture();

        let app_handle = app.clone();
        let session = WorkerSession::spawn("shortcut-capture", move |stop_rx| {
            let listener = KeyboardListener::new()?;
            let mut captured_hotkey: Option<Hotkey> = None;

            loop {
                if should_stop(&stop_rx) {
                    break;
                }

                match listener.recv_timeout(CAPTURE_POLL_INTERVAL) {
                    Ok(event) => {
                        if !event.is_key_down {
                            if captured_hotkey
                                .as_ref()
                                .is_some_and(|hotkey| hotkey.key.is_some())
                            {
                                let hotkey = captured_hotkey.take().expect("checked above");
                                emit_capture_event(
                                    &app_handle,
                                    ShortcutCapturePayload::Captured {
                                        shortcut: hotkey.to_string(),
                                    },
                                );
                                break;
                            }
                            continue;
                        }

                        if let Ok(hotkey) = event.as_hotkey() {
                            let captured = merge_capture_hotkey(captured_hotkey, hotkey);
                            captured_hotkey = Some(captured);
                            emit_capture_event(
                                &app_handle,
                                ShortcutCapturePayload::Preview {
                                    shortcut: captured.to_string(),
                                },
                            );
                        }
                    }
                    Err(handy_keys::Error::Timeout) => {}
                    Err(err) => {
                        emit_capture_event(
                            &app_handle,
                            ShortcutCapturePayload::Error {
                                message: format!("Shortcut capture failed: {err}"),
                            },
                        );
                        break;
                    }
                }
            }

            Ok(())
        })?;

        *self.capture.lock() = Some(session);
        Ok(())
    }

    pub(crate) fn stop_capture(&self) {
        self.capture.lock().take();
    }
}

fn merge_capture_hotkey(previous: Option<Hotkey>, current: Hotkey) -> Hotkey {
    if let Some(previous) = previous {
        Hotkey {
            modifiers: previous.modifiers | current.modifiers,
            key: current.key.or(previous.key),
        }
    } else {
        current
    }
}

fn emit_capture_event(app: &AppHandle<AppRuntime>, payload: ShortcutCapturePayload) {
    if let Err(err) = app.emit(SHORTCUT_CAPTURE_EVENT, payload) {
        eprintln!("Failed to emit shortcut capture event: {err}");
    }
}

struct WorkerSession {
    stop_tx: Sender<()>,
    join_handle: Option<JoinHandle<()>>,
}

impl WorkerSession {
    fn spawn<F>(thread_name: &str, task: F) -> Result<Self>
    where
        F: FnOnce(Receiver<()>) -> Result<()> + Send + 'static,
    {
        let (stop_tx, stop_rx) = mpsc::channel();
        let join_handle = thread::Builder::new()
            .name(thread_name.to_string())
            .spawn(move || {
                if let Err(err) = task(stop_rx) {
                    eprintln!("Hotkey worker exited with error: {err}");
                }
            })
            .map_err(|err| anyhow!("Failed to spawn hotkey worker: {err}"))?;

        Ok(Self {
            stop_tx,
            join_handle: Some(join_handle),
        })
    }
}

impl Drop for WorkerSession {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }
}

fn should_stop(stop_rx: &Receiver<()>) -> bool {
    matches!(stop_rx.try_recv(), Ok(()) | Err(TryRecvError::Disconnected))
}

pub(crate) fn parse_shortcut(shortcut: &str) -> Result<Hotkey> {
    let normalized = normalize_legacy_shortcut_input(shortcut);
    normalized
        .parse::<Hotkey>()
        .map_err(|err| anyhow!("Shortcut `{shortcut}` is invalid: {err}"))
}

pub(crate) fn normalize_recording_shortcut(shortcut: &str) -> Result<String> {
    let hotkey = parse_shortcut(shortcut)?;
    Ok(hotkey.to_string())
}

fn normalize_legacy_shortcut_input(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|token| match token.trim().to_ascii_lowercase().as_str() {
            "commandorcontrol" | "commandorctrl" | "cmdorctrl" | "cmdorcontrol" => {
                if cfg!(target_os = "macos") {
                    "Cmd".to_string()
                } else {
                    "Ctrl".to_string()
                }
            }
            "command" | "cmd" | "meta" | "win" | "windows" => "Cmd".to_string(),
            "control" | "ctrl" => "Ctrl".to_string(),
            "alt" | "option" | "opt" => "Opt".to_string(),
            "shift" => "Shift".to_string(),
            "leftcommand" => "CmdLeft".to_string(),
            "rightcommand" => "CmdRight".to_string(),
            "leftcontrol" => "CtrlLeft".to_string(),
            "rightcontrol" => "CtrlRight".to_string(),
            "leftalt" | "leftoption" => "OptLeft".to_string(),
            "rightalt" | "rightoption" => "OptRight".to_string(),
            "leftshift" => "ShiftLeft".to_string(),
            "rightshift" => "ShiftRight".to_string(),
            // Glimpse historically stored `Delete` for the forward-delete key.
            "delete" => "ForwardDelete".to_string(),
            "arrowleft" => "Left".to_string(),
            "arrowright" => "Right".to_string(),
            "arrowup" => "Up".to_string(),
            "arrowdown" => "Down".to_string(),
            "spacebar" => "Space".to_string(),
            _ => token.trim().to_string(),
        })
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

pub(crate) fn shortcuts_conflict(left: &Hotkey, right: &Hotkey) -> bool {
    left == right || is_modifier_only_prefix(left, right) || is_modifier_only_prefix(right, left)
}

fn is_modifier_only_prefix(prefix: &Hotkey, full: &Hotkey) -> bool {
    prefix.key.is_none()
        && !prefix.modifiers.is_empty()
        && modifier_group_subset(
            prefix.modifiers,
            full.modifiers,
            Modifiers::CMD_LEFT,
            Modifiers::CMD_RIGHT,
        )
        && modifier_group_subset(
            prefix.modifiers,
            full.modifiers,
            Modifiers::CTRL_LEFT,
            Modifiers::CTRL_RIGHT,
        )
        && modifier_group_subset(
            prefix.modifiers,
            full.modifiers,
            Modifiers::OPT_LEFT,
            Modifiers::OPT_RIGHT,
        )
        && modifier_group_subset(
            prefix.modifiers,
            full.modifiers,
            Modifiers::SHIFT_LEFT,
            Modifiers::SHIFT_RIGHT,
        )
        && (!prefix.modifiers.contains(Modifiers::FN) || full.modifiers.contains(Modifiers::FN))
        && (full.key.is_some() || prefix.modifiers != full.modifiers)
}

fn modifier_group_subset(
    prefix: Modifiers,
    full: Modifiers,
    left: Modifiers,
    right: Modifiers,
) -> bool {
    let prefix_has_left = prefix.contains(left);
    let prefix_has_right = prefix.contains(right);

    if !prefix_has_left && !prefix_has_right {
        return true;
    }

    let full_has_left = full.contains(left);
    let full_has_right = full.contains(right);

    if prefix_has_left && prefix_has_right {
        full_has_left || full_has_right
    } else if prefix_has_left {
        full_has_left
    } else {
        full_has_right
    }
}
