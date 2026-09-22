use std::cell::RefCell;
use std::thread;

use anyhow::{Result, anyhow};
use crossbeam_channel::Sender;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, EVENT_SYSTEM_DESKTOPSWITCH, GetMessageW, KBDLLHOOKSTRUCT,
    MSG, MSLLHOOKSTRUCT, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WINEVENT_OUTOFCONTEXT, WM_KEYDOWN, WM_KEYUP,
    WM_MBUTTONDOWN, WM_MBUTTONUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN,
    WM_XBUTTONUP, XBUTTON1, XBUTTON2,
};

use super::{
    BlockingHotkeys, Key, KeyEvent, Modifiers, PlatformShutdown, should_block_event,
    should_forward_event,
};
use crate::assistive::keyboard_input;

const LLKHF_EXTENDED_FLAG: u32 = 0x01;

struct HookState {
    tx: Sender<KeyEvent>,
    blocking_hotkeys: BlockingHotkeys,
    // Modifiers whose key-down this hook swallowed. Windows never saw them go down, so it
    // reports them as up and they have to be remembered here until their key-up.
    blocked_modifiers: Modifiers,
}

thread_local! {
    static HOOK_STATE: RefCell<Option<HookState>> = const { RefCell::new(None) };
}

pub(super) fn start(
    tx: Sender<KeyEvent>,
    blocking_hotkeys: BlockingHotkeys,
) -> Result<PlatformShutdown> {
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);

    let join_handle = thread::Builder::new()
        .name("glimpse-keyboard-windows".to_string())
        .spawn(move || {
            HOOK_STATE.with(|state| {
                *state.borrow_mut() = Some(HookState {
                    tx,
                    blocking_hotkeys,
                    blocked_modifiers: Modifiers::empty(),
                });
            });

            let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) };
            let hook = match hook {
                Ok(hook) => hook,
                Err(err) => {
                    crate::analytics::track_shortcut_failed(
                        "keyboard_hook",
                        crate::analytics::error_detail(&err.clone().into()),
                    );
                    let _ = ready_tx.send(Err(format!("Failed to install keyboard hook: {err}")));
                    return;
                }
            };

            // Out-of-context callbacks run on this thread through its message loop.
            let desktop_hook = unsafe {
                SetWinEventHook(
                    EVENT_SYSTEM_DESKTOPSWITCH,
                    EVENT_SYSTEM_DESKTOPSWITCH,
                    None,
                    Some(desktop_switch_proc),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                )
            };
            if desktop_hook.is_invalid() {
                unsafe {
                    let _ = UnhookWindowsHookEx(hook);
                }
                let _ = ready_tx.send(Err(
                    "Failed to install Windows shortcut desktop-switch hook".to_string(),
                ));
                return;
            }

            let mouse_hook =
                match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) } {
                    Ok(mouse_hook) => Some(mouse_hook),
                    Err(err) => {
                        tracing::warn!(
                            "Failed to install mouse hook, mouse-button shortcuts disabled: {err}"
                        );
                        crate::analytics::track_shortcut_failed(
                            "mouse_hook",
                            crate::analytics::error_detail(&err.into()),
                        );
                        None
                    }
                };

            let thread_id = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
            let _ = ready_tx.send(Ok(thread_id));

            let mut message = MSG::default();
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.into() {
                unsafe {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }

            unsafe {
                let _ = UnhookWinEvent(desktop_hook);
                if let Some(mouse_hook) = mouse_hook {
                    let _ = UnhookWindowsHookEx(mouse_hook);
                }
                let _ = UnhookWindowsHookEx(hook);
            }
            HOOK_STATE.with(|state| {
                *state.borrow_mut() = None;
            });
        })
        .map_err(|err| anyhow!("Failed to spawn Windows shortcut listener: {err}"))?;

    let thread_id = ready_rx
        .recv()
        .map_err(|_| anyhow!("Windows shortcut listener exited during startup"))?
        .map_err(anyhow::Error::msg)?;

    Ok(PlatformShutdown::new(
        move || unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        },
        join_handle,
    ))
}

unsafe extern "system" fn desktop_switch_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _window: HWND,
    _object_id: i32,
    _child_id: i32,
    _thread_id: u32,
    _time: u32,
) {
    // Releases on the secure desktop are invisible to our keyboard hook. Discard
    // remembered keys and release active shortcuts instead of carrying them back.
    HOOK_STATE.with(|state| {
        let mut state = state.borrow_mut();
        let Some(state) = state.as_mut() else {
            return;
        };
        state.blocked_modifiers = Modifiers::empty();
        let _ = state.tx.try_send(KeyEvent {
            occurred_at: std::time::Instant::now(),
            modifiers: Modifiers::empty(),
            key: None,
            is_key_down: false,
            changed_modifier: None,
            repeat: false,
        });
    });
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let is_key_down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
    let is_key_up = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
    if !is_key_down && !is_key_up {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let decision = HOOK_STATE.with(|state| {
        let mut state = state.borrow_mut();
        let state = state.as_mut()?;
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let event = build_event(state.blocked_modifiers, info, is_key_down)?;

        let should_block =
            should_block_event(&state.blocking_hotkeys, state.blocked_modifiers, &event);
        let mut passed_through = Modifiers::empty();
        if let Some(modifier) = event.changed_modifier {
            if is_key_down && should_block {
                if !state.blocked_modifiers.contains(modifier) {
                    state.blocked_modifiers.insert(modifier);
                    passed_through = event.modifiers;
                    passed_through.remove(state.blocked_modifiers);
                }
            } else if !is_key_down {
                state.blocked_modifiers.remove(modifier);
            }
        }

        if should_forward_event(&state.blocking_hotkeys, &event) {
            let _ = state.tx.try_send(event);
        }

        Some((should_block, passed_through))
    });

    let Some((should_block, passed_through)) = decision else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };

    if should_block {
        mask_menu_activation(passed_through);
        LRESULT(1)
    } else {
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let message = wparam.0 as u32;
    let is_key_down = matches!(message, WM_MBUTTONDOWN | WM_XBUTTONDOWN);
    let is_key_up = matches!(message, WM_MBUTTONUP | WM_XBUTTONUP);
    if !is_key_down && !is_key_up {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
    let Some(key) = mouse_key(message, info.mouseData) else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };

    let event = HOOK_STATE.with(|state| {
        let state = state.borrow();
        let state = state.as_ref()?;
        let event = KeyEvent {
            occurred_at: std::time::Instant::now(),
            modifiers: held_modifiers(state.blocked_modifiers, os_held_modifiers(), None),
            key: Some(key),
            is_key_down,
            changed_modifier: None,
            repeat: false,
        };
        Some((event, state.blocking_hotkeys.clone(), state.tx.clone()))
    });

    let Some((event, blocking_hotkeys, tx)) = event else {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    };

    let should_block = should_block_event(&blocking_hotkeys, Modifiers::empty(), &event);
    if should_forward_event(&blocking_hotkeys, &event) {
        let _ = tx.try_send(event);
    }

    if should_block {
        LRESULT(1)
    } else {
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }
}

fn mouse_key(message: u32, mouse_data: u32) -> Option<Key> {
    match message {
        WM_MBUTTONDOWN | WM_MBUTTONUP => Some(Key::MouseMiddle),
        WM_XBUTTONDOWN | WM_XBUTTONUP => match (mouse_data >> 16) as u16 {
            XBUTTON1 => Some(Key::MouseBack),
            XBUTTON2 => Some(Key::MouseForward),
            _ => None,
        },
        _ => None,
    }
}

fn build_event(
    blocked_modifiers: Modifiers,
    info: &KBDLLHOOKSTRUCT,
    is_key_down: bool,
) -> Option<KeyEvent> {
    let vk = VIRTUAL_KEY(info.vkCode as u16);
    let is_extended = (info.flags.0 & LLKHF_EXTENDED_FLAG) != 0;

    if let Some(modifier) = modifier_from_vk(vk, info.scanCode, is_extended) {
        let os_held = os_held_modifiers();
        return Some(KeyEvent {
            occurred_at: std::time::Instant::now(),
            modifiers: held_modifiers(blocked_modifiers, os_held, Some((modifier, is_key_down))),
            key: None,
            is_key_down,
            changed_modifier: Some(modifier),
            // Windows auto-repeats held modifiers; a swallowed one never shows as held.
            repeat: is_key_down && os_held.contains(modifier),
        });
    }

    Some(KeyEvent {
        occurred_at: std::time::Instant::now(),
        modifiers: held_modifiers(blocked_modifiers, os_held_modifiers(), None),
        key: Some(key_from_vk(vk, is_extended)?),
        is_key_down,
        changed_modifier: None,
        repeat: false,
    })
}

const MODIFIER_KEYS: [(VIRTUAL_KEY, Modifiers); 8] = [
    (VK_LWIN, Modifiers::CMD_LEFT),
    (VK_RWIN, Modifiers::CMD_RIGHT),
    (VK_LSHIFT, Modifiers::SHIFT_LEFT),
    (VK_RSHIFT, Modifiers::SHIFT_RIGHT),
    (VK_LCONTROL, Modifiers::CTRL_LEFT),
    (VK_RCONTROL, Modifiers::CTRL_RIGHT),
    (VK_LMENU, Modifiers::OPT_LEFT),
    (VK_RMENU, Modifiers::OPT_RIGHT),
];

fn os_held_modifiers() -> Modifiers {
    let mut modifiers = Modifiers::empty();
    for (vk, modifier) in MODIFIER_KEYS {
        if unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000 != 0 {
            modifiers.insert(modifier);
        }
    }
    modifiers
}

// Read unblocked modifiers from Windows so missed releases do not leave them stuck.
// Swallowed modifiers must be remembered until release or a desktop switch. This
// event's own modifier comes from the hook, before Windows updates its state.
fn held_modifiers(
    blocked_modifiers: Modifiers,
    os_held: Modifiers,
    changed: Option<(Modifiers, bool)>,
) -> Modifiers {
    let mut modifiers = blocked_modifiers | os_held;

    if let Some((modifier, is_key_down)) = changed {
        if is_key_down {
            modifiers.insert(modifier);
        } else {
            modifiers.remove(modifier);
        }
    }

    modifiers
}

// A lone Alt or Win press-and-release opens the menu bar or Start. When one of them
// passed through before the chord completed, send a no-op key so Windows sees the press
// as part of a combination. Same trick as PowerToys Keyboard Manager.
fn mask_menu_activation(passed_through: Modifiers) {
    let opens_menu = [
        Modifiers::CMD_LEFT,
        Modifiers::CMD_RIGHT,
        Modifiers::OPT_LEFT,
        Modifiers::OPT_RIGHT,
    ]
    .into_iter()
    .any(|modifier| passed_through.contains(modifier));
    if !opens_menu {
        return;
    }

    const VK_DUMMY: VIRTUAL_KEY = VIRTUAL_KEY(0xFF);
    let inputs = [
        keyboard_input(VK_DUMMY, KEYBD_EVENT_FLAGS(0)),
        keyboard_input(VK_DUMMY, KEYEVENTF_KEYUP),
    ];
    unsafe {
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn modifier_from_vk(vk: VIRTUAL_KEY, scan_code: u32, is_extended: bool) -> Option<Modifiers> {
    match vk {
        VK_LWIN => Some(Modifiers::CMD_LEFT),
        VK_RWIN => Some(Modifiers::CMD_RIGHT),
        VK_LSHIFT => Some(Modifiers::SHIFT_LEFT),
        VK_RSHIFT => Some(Modifiers::SHIFT_RIGHT),
        VK_SHIFT => {
            if scan_code == 0x36 {
                Some(Modifiers::SHIFT_RIGHT)
            } else {
                Some(Modifiers::SHIFT_LEFT)
            }
        }
        VK_LCONTROL => Some(Modifiers::CTRL_LEFT),
        VK_RCONTROL => Some(Modifiers::CTRL_RIGHT),
        VK_CONTROL => {
            if is_extended {
                Some(Modifiers::CTRL_RIGHT)
            } else {
                Some(Modifiers::CTRL_LEFT)
            }
        }
        VK_LMENU => Some(Modifiers::OPT_LEFT),
        VK_RMENU => Some(Modifiers::OPT_RIGHT),
        VK_MENU => {
            if is_extended {
                Some(Modifiers::OPT_RIGHT)
            } else {
                Some(Modifiers::OPT_LEFT)
            }
        }
        _ => None,
    }
}

fn key_from_vk(vk: VIRTUAL_KEY, is_extended: bool) -> Option<Key> {
    match vk {
        VK_A => Some(Key::A),
        VK_B => Some(Key::B),
        VK_C => Some(Key::C),
        VK_D => Some(Key::D),
        VK_E => Some(Key::E),
        VK_F => Some(Key::F),
        VK_G => Some(Key::G),
        VK_H => Some(Key::H),
        VK_I => Some(Key::I),
        VK_J => Some(Key::J),
        VK_K => Some(Key::K),
        VK_L => Some(Key::L),
        VK_M => Some(Key::M),
        VK_N => Some(Key::N),
        VK_O => Some(Key::O),
        VK_P => Some(Key::P),
        VK_Q => Some(Key::Q),
        VK_R => Some(Key::R),
        VK_S => Some(Key::S),
        VK_T => Some(Key::T),
        VK_U => Some(Key::U),
        VK_V => Some(Key::V),
        VK_W => Some(Key::W),
        VK_X => Some(Key::X),
        VK_Y => Some(Key::Y),
        VK_Z => Some(Key::Z),
        VK_0 => Some(Key::Num0),
        VK_1 => Some(Key::Num1),
        VK_2 => Some(Key::Num2),
        VK_3 => Some(Key::Num3),
        VK_4 => Some(Key::Num4),
        VK_5 => Some(Key::Num5),
        VK_6 => Some(Key::Num6),
        VK_7 => Some(Key::Num7),
        VK_8 => Some(Key::Num8),
        VK_9 => Some(Key::Num9),
        VK_F1 => Some(Key::F1),
        VK_F2 => Some(Key::F2),
        VK_F3 => Some(Key::F3),
        VK_F4 => Some(Key::F4),
        VK_F5 => Some(Key::F5),
        VK_F6 => Some(Key::F6),
        VK_F7 => Some(Key::F7),
        VK_F8 => Some(Key::F8),
        VK_F9 => Some(Key::F9),
        VK_F10 => Some(Key::F10),
        VK_F11 => Some(Key::F11),
        VK_F12 => Some(Key::F12),
        VK_F13 => Some(Key::F13),
        VK_F14 => Some(Key::F14),
        VK_F15 => Some(Key::F15),
        VK_F16 => Some(Key::F16),
        VK_F17 => Some(Key::F17),
        VK_F18 => Some(Key::F18),
        VK_F19 => Some(Key::F19),
        VK_F20 => Some(Key::F20),
        VK_SPACE => Some(Key::Space),
        VK_RETURN if is_extended => Some(Key::KeypadEnter),
        VK_RETURN => Some(Key::Return),
        VK_TAB => Some(Key::Tab),
        VK_ESCAPE => Some(Key::Escape),
        VK_BACK => Some(Key::Delete),
        VK_DELETE => Some(Key::ForwardDelete),
        VK_INSERT => Some(Key::Insert),
        VK_HOME => Some(Key::Home),
        VK_END => Some(Key::End),
        VK_PRIOR => Some(Key::PageUp),
        VK_NEXT => Some(Key::PageDown),
        VK_LEFT => Some(Key::LeftArrow),
        VK_RIGHT => Some(Key::RightArrow),
        VK_UP => Some(Key::UpArrow),
        VK_DOWN => Some(Key::DownArrow),
        VK_OEM_MINUS => Some(Key::Minus),
        VK_OEM_PLUS => Some(Key::Equal),
        VK_OEM_4 => Some(Key::LeftBracket),
        VK_OEM_6 => Some(Key::RightBracket),
        VK_OEM_5 => Some(Key::Backslash),
        VK_OEM_1 => Some(Key::Semicolon),
        VK_OEM_7 => Some(Key::Quote),
        VK_OEM_COMMA => Some(Key::Comma),
        VK_OEM_PERIOD => Some(Key::Period),
        VK_OEM_2 => Some(Key::Slash),
        VK_OEM_3 => Some(Key::Grave),
        VK_NUMPAD0 => Some(Key::Keypad0),
        VK_NUMPAD1 => Some(Key::Keypad1),
        VK_NUMPAD2 => Some(Key::Keypad2),
        VK_NUMPAD3 => Some(Key::Keypad3),
        VK_NUMPAD4 => Some(Key::Keypad4),
        VK_NUMPAD5 => Some(Key::Keypad5),
        VK_NUMPAD6 => Some(Key::Keypad6),
        VK_NUMPAD7 => Some(Key::Keypad7),
        VK_NUMPAD8 => Some(Key::Keypad8),
        VK_NUMPAD9 => Some(Key::Keypad9),
        VK_DECIMAL => Some(Key::KeypadDecimal),
        VK_MULTIPLY => Some(Key::KeypadMultiply),
        VK_ADD => Some(Key::KeypadPlus),
        VK_CLEAR => Some(Key::KeypadClear),
        VK_DIVIDE => Some(Key::KeypadDivide),
        VK_SUBTRACT => Some(Key::KeypadMinus),
        VK_CAPITAL => Some(Key::CapsLock),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_switch_clears_swallowed_modifiers_and_releases_shortcuts() {
        let (tx, rx) = crossbeam_channel::unbounded();
        HOOK_STATE.with(|state| {
            *state.borrow_mut() = Some(HookState {
                tx,
                blocking_hotkeys: super::super::empty_blocking_hotkeys(),
                blocked_modifiers: Modifiers::CTRL_LEFT | Modifiers::OPT_LEFT,
            });
        });

        unsafe {
            desktop_switch_proc(
                HWINEVENTHOOK::default(),
                EVENT_SYSTEM_DESKTOPSWITCH,
                HWND::default(),
                0,
                0,
                0,
                0,
            );
        }

        let state = HOOK_STATE.with(|state| state.borrow_mut().take().unwrap());
        assert!(state.blocked_modifiers.is_empty());
        assert!(rx.try_recv().unwrap().releases_everything());
        assert!(rx.try_recv().is_err());
    }
}
