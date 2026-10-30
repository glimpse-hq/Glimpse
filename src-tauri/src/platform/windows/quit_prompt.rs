use crate::AppRuntime;
use crate::platform::QuitPrompt;
use std::ffi::c_void;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::{
    TASKDIALOG_BUTTON, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TDF_ALLOW_DIALOG_CANCELLATION,
    TaskDialogIndirect,
};
use windows::core::PCWSTR;

const SAVE: i32 = 100;
const KEEP: i32 = 101;

/// Runs on its own thread so the event loop keeps going. Escape and the close
/// button keep recording. `on_answer(true)` means save and quit, also when the
/// dialog can't be shown, since the user asked to quit.
pub fn confirm(
    app: &AppHandle<AppRuntime>,
    prompt: QuitPrompt,
    on_answer: impl FnOnce(bool) + Send + 'static,
) {
    // Owned by an open main window, so it can't open behind it.
    let owner = app
        .get_webview_window(crate::SETTINGS_WINDOW_LABEL)
        .filter(|window| window.is_visible().unwrap_or(false))
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize);
    std::thread::spawn(move || on_answer(ask(&prompt, owner)));
}

fn ask(prompt: &QuitPrompt, owner: Option<isize>) -> bool {
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (caption, title, message) = (wide("Glimpse"), wide(prompt.title), wide(prompt.message));
    let (save, keep) = (wide(prompt.save), wide(prompt.keep));
    // Windows orders the action first and the safe choice last.
    let buttons = [
        TASKDIALOG_BUTTON {
            nButtonID: SAVE,
            pszButtonText: PCWSTR(save.as_ptr()),
        },
        TASKDIALOG_BUTTON {
            nButtonID: KEEP,
            pszButtonText: PCWSTR(keep.as_ptr()),
        },
    ];
    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: HWND(owner.unwrap_or_default() as *mut c_void),
        hInstance: unsafe { GetModuleHandleW(None) }.unwrap_or_default().into(),
        dwFlags: TDF_ALLOW_DIALOG_CANCELLATION,
        pszWindowTitle: PCWSTR(caption.as_ptr()),
        // The exe's icon resource, as embedded by tauri-build.
        Anonymous1: TASKDIALOGCONFIG_0 {
            pszMainIcon: PCWSTR(tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID as usize as _),
        },
        pszMainInstruction: PCWSTR(title.as_ptr()),
        pszContent: PCWSTR(message.as_ptr()),
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        nDefaultButton: KEEP,
        ..Default::default()
    };
    let mut pressed = 0;
    match unsafe { TaskDialogIndirect(&config, Some(&mut pressed), None, None) } {
        Ok(()) => pressed == SAVE,
        Err(err) => {
            tracing::error!("Failed to show the quit prompt; saving the recording: {err}");
            true
        }
    }
}
