use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;
use tauri_plugin_user_input::{EventType, InputEvent, InputEventData, UserInputExt};

use crate::AppRuntime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HotkeyState {
    Pressed,
    Released,
}

#[derive(Debug, Clone)]
pub(crate) struct HotkeyEvent {
    pub state: HotkeyState,
}

pub(crate) trait HotkeyProvider {
    fn unregister_all(&self) -> Result<()>;

    fn on_shortcut<F>(&self, shortcut: &str, handler: F) -> Result<()>
    where
        F: Fn(&AppHandle<AppRuntime>, HotkeyEvent) + Send + Sync + 'static;
}

type ShortcutHandler = Arc<dyn Fn(&AppHandle<AppRuntime>, HotkeyEvent) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModifierKey {
    ControlLeft,
    ControlRight,
    ShiftLeft,
    ShiftRight,
    AltLeft,
    AltRight,
    CommandLeft,
    CommandRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModifierToken {
    Control,
    Shift,
    ShiftLeft,
    ShiftRight,
    Alt,
    AltLeft,
    AltRight,
    CommandAny,
    CommandLeft,
    CommandRight,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct PressedModifiers {
    control_left: bool,
    control_right: bool,
    shift_left: bool,
    shift_right: bool,
    alt_left: bool,
    alt_right: bool,
    command_left: bool,
    command_right: bool,
}

impl PressedModifiers {
    fn set(&mut self, modifier: ModifierKey, down: bool) {
        match modifier {
            ModifierKey::ControlLeft => self.control_left = down,
            ModifierKey::ControlRight => self.control_right = down,
            ModifierKey::ShiftLeft => self.shift_left = down,
            ModifierKey::ShiftRight => self.shift_right = down,
            ModifierKey::AltLeft => self.alt_left = down,
            ModifierKey::AltRight => self.alt_right = down,
            ModifierKey::CommandLeft => self.command_left = down,
            ModifierKey::CommandRight => self.command_right = down,
        }
    }

    fn control_any(self) -> bool {
        self.control_left || self.control_right
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct ShortcutModifiers {
    control: bool,
    shift: SideRequirement,
    alt: SideRequirement,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum SideRequirement {
    #[default]
    None,
    Any,
    LeftOnly,
    RightOnly,
    Both,
}

#[derive(Debug, Clone)]
struct ShortcutSpec {
    key: Option<String>,
    modifiers: ShortcutModifiers,
    command_requirement: SideRequirement,
}

fn side_requirement_matches(requirement: SideRequirement, left: bool, right: bool) -> bool {
    match requirement {
        SideRequirement::None => !left && !right,
        SideRequirement::Any => left || right,
        SideRequirement::LeftOnly => left && !right,
        SideRequirement::RightOnly => right && !left,
        SideRequirement::Both => left && right,
    }
}

impl ShortcutSpec {
    fn is_active(
        &self,
        pressed_modifiers: PressedModifiers,
        pressed_keys: &HashSet<String>,
    ) -> bool {
        if self.modifiers.control != pressed_modifiers.control_any() {
            return false;
        }
        if !side_requirement_matches(
            self.modifiers.shift,
            pressed_modifiers.shift_left,
            pressed_modifiers.shift_right,
        ) {
            return false;
        }
        if !side_requirement_matches(
            self.modifiers.alt,
            pressed_modifiers.alt_left,
            pressed_modifiers.alt_right,
        ) {
            return false;
        }
        if let Some(key) = &self.key {
            if !pressed_keys.contains(key) {
                return false;
            }
        }

        side_requirement_matches(
            self.command_requirement,
            pressed_modifiers.command_left,
            pressed_modifiers.command_right,
        )
    }
}

#[derive(Clone)]
struct RegisteredShortcut {
    spec: ShortcutSpec,
    handler: ShortcutHandler,
    active: bool,
}

#[derive(Default)]
struct RuntimeHotkeyState {
    registrations: Vec<RegisteredShortcut>,
    pressed_modifiers: PressedModifiers,
    pressed_keys: HashSet<String>,
    listening: bool,
}

static RUNTIME_HOTKEY_STATE: LazyLock<Mutex<RuntimeHotkeyState>> =
    LazyLock::new(|| Mutex::new(RuntimeHotkeyState::default()));

fn platform_command_or_control() -> ModifierToken {
    #[cfg(target_os = "macos")]
    {
        ModifierToken::CommandAny
    }
    #[cfg(not(target_os = "macos"))]
    {
        ModifierToken::Control
    }
}

fn parse_modifier_token(token: &str) -> Option<ModifierToken> {
    match token.to_ascii_lowercase().as_str() {
        "control" | "ctrl" => Some(ModifierToken::Control),
        "shift" => Some(ModifierToken::Shift),
        "leftshift" | "shiftleft" => Some(ModifierToken::ShiftLeft),
        "rightshift" | "shiftright" => Some(ModifierToken::ShiftRight),
        "alt" | "option" => Some(ModifierToken::Alt),
        "leftalt" | "altleft" | "leftoption" | "optionleft" => Some(ModifierToken::AltLeft),
        "rightalt" | "altright" | "rightoption" | "optionright" => Some(ModifierToken::AltRight),
        "command" | "cmd" | "meta" | "super" => Some(ModifierToken::CommandAny),
        "leftcommand" | "commandleft" | "leftcmd" | "cmdleft" | "metaleft" | "superleft" => {
            Some(ModifierToken::CommandLeft)
        }
        "rightcommand" | "commandright" | "rightcmd" | "cmdright" | "metaright" | "superright" => {
            Some(ModifierToken::CommandRight)
        }
        "commandorcontrol" | "cmdorctrl" => Some(platform_command_or_control()),
        _ => None,
    }
}

fn normalize_registered_key(token: &str) -> Option<String> {
    let key = token.trim();
    if key.is_empty() {
        return None;
    }
    if parse_modifier_token(key).is_some() {
        return None;
    }

    if key.len() == 1 {
        let ch = key.chars().next()?;
        if ch.is_ascii_alphabetic() || ch.is_ascii_digit() {
            return Some(ch.to_ascii_lowercase().to_string());
        }
        if "`-=[]\\;',./".contains(ch) {
            return Some(ch.to_string());
        }
    }

    let lower = key.to_ascii_lowercase();
    if let Some(number) = lower.strip_prefix('f') {
        if let Ok(value) = number.parse::<u8>() {
            if (1..=24).contains(&value) {
                return Some(format!("f{value}"));
            }
        }
    }

    Some(
        match lower.as_str() {
            "space" | "spacebar" => "space",
            "enter" => "enter",
            "tab" => "tab",
            "backspace" => "backspace",
            "escape" | "esc" => "escape",
            "delete" | "del" => "delete",
            "up" => "arrowup",
            "down" => "arrowdown",
            "left" => "arrowleft",
            "right" => "arrowright",
            "arrowup" => "arrowup",
            "arrowdown" => "arrowdown",
            "arrowleft" => "arrowleft",
            "arrowright" => "arrowright",
            _ => lower.as_str(),
        }
        .to_string(),
    )
}

fn side_requirement_from_tokens(
    shortcut: &str,
    label: &str,
    any: bool,
    left: bool,
    right: bool,
) -> Result<SideRequirement> {
    if any && (left || right) {
        return Err(anyhow!(
            "Shortcut `{shortcut}` mixes generic {label} with left/right {label} side tokens"
        ));
    }

    Ok(if any {
        SideRequirement::Any
    } else if left && right {
        SideRequirement::Both
    } else if left {
        SideRequirement::LeftOnly
    } else if right {
        SideRequirement::RightOnly
    } else {
        SideRequirement::None
    })
}

fn parse_shortcut_spec(shortcut: &str) -> Result<ShortcutSpec> {
    let mut control = false;
    let mut shift_any = false;
    let mut shift_left = false;
    let mut shift_right = false;
    let mut alt_any = false;
    let mut alt_left = false;
    let mut alt_right = false;
    let mut command_any = false;
    let mut command_left = false;
    let mut command_right = false;
    let mut key: Option<String> = None;
    let mut saw_token = false;

    for token in shortcut
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        saw_token = true;

        if let Some(modifier) = parse_modifier_token(token) {
            match modifier {
                ModifierToken::Control => control = true,
                ModifierToken::Shift => shift_any = true,
                ModifierToken::ShiftLeft => shift_left = true,
                ModifierToken::ShiftRight => shift_right = true,
                ModifierToken::Alt => alt_any = true,
                ModifierToken::AltLeft => alt_left = true,
                ModifierToken::AltRight => alt_right = true,
                ModifierToken::CommandAny => command_any = true,
                ModifierToken::CommandLeft => command_left = true,
                ModifierToken::CommandRight => command_right = true,
            }
            continue;
        }

        let normalized_key = normalize_registered_key(token)
            .ok_or_else(|| anyhow!("Shortcut `{shortcut}` has an invalid base key `{token}`"))?;

        if key.replace(normalized_key).is_some() {
            return Err(anyhow!(
                "Shortcut `{shortcut}` has multiple base keys; expected one"
            ));
        }
    }

    if !saw_token {
        return Err(anyhow!("Shortcut `{shortcut}` is empty"));
    }

    let shift_requirement =
        side_requirement_from_tokens(shortcut, "Shift", shift_any, shift_left, shift_right)?;
    let alt_requirement =
        side_requirement_from_tokens(shortcut, "Alt/Option", alt_any, alt_left, alt_right)?;
    let command_requirement = side_requirement_from_tokens(
        shortcut,
        "Command",
        command_any,
        command_left,
        command_right,
    )?;

    Ok(ShortcutSpec {
        key,
        modifiers: ShortcutModifiers {
            control,
            shift: shift_requirement,
            alt: alt_requirement,
        },
        command_requirement,
    })
}

fn event_modifier_for_key_name(key_name: &str) -> Option<ModifierKey> {
    match key_name {
        "ControlLeft" => Some(ModifierKey::ControlLeft),
        "ControlRight" => Some(ModifierKey::ControlRight),
        "ShiftLeft" => Some(ModifierKey::ShiftLeft),
        "ShiftRight" => Some(ModifierKey::ShiftRight),
        "AltLeft" => Some(ModifierKey::AltLeft),
        "AltRight" => Some(ModifierKey::AltRight),
        "MetaLeft" => Some(ModifierKey::CommandLeft),
        "MetaRight" => Some(ModifierKey::CommandRight),
        _ => None,
    }
}

fn normalize_event_key_name(key_name: &str) -> Option<String> {
    if let Some(letter) = key_name.strip_prefix("Key") {
        if letter.len() == 1 && letter.chars().all(|ch| ch.is_ascii_alphabetic()) {
            return Some(letter.to_ascii_lowercase());
        }
    }

    if let Some(number) = key_name.strip_prefix("Num") {
        if number.len() == 1 && number.chars().all(|ch| ch.is_ascii_digit()) {
            return Some(number.to_string());
        }
    }

    if let Some(number) = key_name.strip_prefix('F') {
        if let Ok(value) = number.parse::<u8>() {
            if (1..=24).contains(&value) {
                return Some(format!("f{value}"));
            }
        }
    }

    Some(
        match key_name {
            "Space" => "space",
            "Enter" => "enter",
            "Tab" => "tab",
            "Backspace" => "backspace",
            "Escape" => "escape",
            "Delete" => "delete",
            "ArrowUp" => "arrowup",
            "ArrowDown" => "arrowdown",
            "ArrowLeft" => "arrowleft",
            "ArrowRight" => "arrowright",
            "Grave" => "`",
            "Minus" => "-",
            "Equal" => "=",
            "BracketLeft" => "[",
            "BracketRight" => "]",
            "Backslash" => "\\",
            "Semicolon" => ";",
            "Quote" => "'",
            "Comma" => ",",
            "Period" => ".",
            "Slash" => "/",
            _ => return Some(key_name.to_ascii_lowercase()),
        }
        .to_string(),
    )
}

fn handle_input_event(app: &AppHandle<AppRuntime>, event: InputEvent) {
    if !matches!(
        event.event_type,
        EventType::KeyPress | EventType::KeyRelease
    ) {
        return;
    }

    let is_press = event.event_type == EventType::KeyPress;
    let InputEventData::Key(key) = event.data else {
        return;
    };
    let key_name = format!("{key:?}");

    let mut callbacks: Vec<(ShortcutHandler, HotkeyEvent)> = Vec::new();
    {
        let mut runtime = RUNTIME_HOTKEY_STATE
            .lock()
            .expect("hotkey state lock poisoned");

        if let Some(modifier) = event_modifier_for_key_name(&key_name) {
            runtime.pressed_modifiers.set(modifier, is_press);
        } else if let Some(normalized_key) = normalize_event_key_name(&key_name) {
            if is_press {
                runtime.pressed_keys.insert(normalized_key);
            } else {
                runtime.pressed_keys.remove(&normalized_key);
            }
        } else {
            return;
        }

        let pressed_modifiers = runtime.pressed_modifiers;
        let pressed_keys = runtime.pressed_keys.clone();

        for registration in &mut runtime.registrations {
            let active_now = registration
                .spec
                .is_active(pressed_modifiers, &pressed_keys);
            if active_now == registration.active {
                continue;
            }

            registration.active = active_now;
            callbacks.push((
                Arc::clone(&registration.handler),
                HotkeyEvent {
                    state: if active_now {
                        HotkeyState::Pressed
                    } else {
                        HotkeyState::Released
                    },
                },
            ));
        }
    }

    for (handler, hotkey_event) in callbacks {
        handler(app, hotkey_event);
    }
}

fn ensure_listener_running(app: &AppHandle<AppRuntime>) -> Result<()> {
    let should_start = {
        let mut runtime = RUNTIME_HOTKEY_STATE
            .lock()
            .expect("hotkey state lock poisoned");
        if runtime.listening {
            false
        } else {
            runtime.listening = true;
            true
        }
    };

    if !should_start {
        return Ok(());
    }

    if let Err(err) = app
        .user_input()
        .set_event_types(vec![EventType::KeyPress, EventType::KeyRelease])
    {
        let mut runtime = RUNTIME_HOTKEY_STATE
            .lock()
            .expect("hotkey state lock poisoned");
        runtime.listening = false;
        return Err(anyhow!("Failed to configure user-input event types: {err}"));
    }

    let app_handle = app.clone();
    let channel = Channel::new(move |body: InvokeResponseBody| {
        if let InvokeResponseBody::Json(raw) = body {
            match serde_json::from_str::<InputEvent>(&raw) {
                Ok(event) => handle_input_event(&app_handle, event),
                Err(err) => {
                    eprintln!("Failed to parse user-input event payload: {err}");
                }
            }
        }
        Ok(())
    });

    if let Err(err) = app.user_input().start_listening(channel) {
        let mut runtime = RUNTIME_HOTKEY_STATE
            .lock()
            .expect("hotkey state lock poisoned");
        runtime.listening = false;
        return Err(anyhow!("Failed to start user-input listener: {err}"));
    }

    Ok(())
}

struct UserInputHotkeyProvider<'a> {
    app: &'a AppHandle<AppRuntime>,
}

impl<'a> UserInputHotkeyProvider<'a> {
    fn new(app: &'a AppHandle<AppRuntime>) -> Self {
        Self { app }
    }
}

impl HotkeyProvider for UserInputHotkeyProvider<'_> {
    fn unregister_all(&self) -> Result<()> {
        let was_listening = {
            let mut runtime = RUNTIME_HOTKEY_STATE
                .lock()
                .expect("hotkey state lock poisoned");
            runtime.registrations.clear();
            runtime.pressed_keys.clear();
            runtime.pressed_modifiers = PressedModifiers::default();
            std::mem::replace(&mut runtime.listening, false)
        };

        if was_listening {
            self.app
                .user_input()
                .stop_listening()
                .map_err(|err| anyhow!("Failed to stop user-input listener: {err}"))?;
        }

        Ok(())
    }

    fn on_shortcut<F>(&self, shortcut: &str, handler: F) -> Result<()>
    where
        F: Fn(&AppHandle<AppRuntime>, HotkeyEvent) + Send + Sync + 'static,
    {
        let spec = parse_shortcut_spec(shortcut)?;
        ensure_listener_running(self.app)?;

        let mut runtime = RUNTIME_HOTKEY_STATE
            .lock()
            .expect("hotkey state lock poisoned");
        runtime.registrations.push(RegisteredShortcut {
            spec,
            handler: Arc::new(handler),
            active: false,
        });

        Ok(())
    }
}

pub(crate) fn provider(app: &AppHandle<AppRuntime>) -> impl HotkeyProvider + '_ {
    UserInputHotkeyProvider::new(app)
}
