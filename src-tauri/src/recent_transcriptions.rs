use crate::native_i18n::MenuStrings;
use crate::{AppRuntime, AppState, assistive, toast};
use tauri::menu::{MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager};

pub const MENU_ID_RECENT_TRANSCRIPTION_PREFIX: &str = "menu_recent_transcription_";
pub const MENU_ID_COPY_LAST_TRANSCRIPTION: &str = "menu_copy_last_transcription";
const MENU_ID_RECENT_TRANSCRIPTION_EMPTY: &str = "menu_recent_transcription_empty";
const MENU_ID_RECENT_TRANSCRIPTION_ERROR: &str = "menu_recent_transcription_error";
const RECENT_TRANSCRIPTIONS_LIMIT: usize = 5;
const RECENT_TRANSCRIPTIONS_PREVIEW_LEN: usize = 60;

pub fn build_recent_transcriptions_menu(
    app: &AppHandle<AppRuntime>,
    strings: &MenuStrings,
) -> tauri::Result<tauri::menu::Submenu<AppRuntime>> {
    let mut submenu = SubmenuBuilder::new(app, strings.get("native.menu.recent"));
    if let Some(state) = app.try_state::<AppState>() {
        match state
            .storage()
            .get_recent_transcriptions(RECENT_TRANSCRIPTIONS_LIMIT)
        {
            Ok(records) if !records.is_empty() => {
                for record in records {
                    let preview = format_transcription_preview(
                        &record.text,
                        RECENT_TRANSCRIPTIONS_PREVIEW_LEN,
                        strings.get("native.menu.recent_empty_item"),
                    );
                    let item = MenuItem::with_id(
                        app,
                        format!("{MENU_ID_RECENT_TRANSCRIPTION_PREFIX}{}", record.id),
                        preview,
                        true,
                        None::<&str>,
                    )?;
                    submenu = submenu.item(&item);
                }
            }
            Ok(_) => {
                let item = MenuItem::with_id(
                    app,
                    MENU_ID_RECENT_TRANSCRIPTION_EMPTY,
                    strings.get("native.menu.recent_empty"),
                    false,
                    None::<&str>,
                )?;
                submenu = submenu.item(&item);
            }
            Err(err) => {
                tracing::error!("Failed to load recent transcriptions for menu: {err}");
                let item = MenuItem::with_id(
                    app,
                    MENU_ID_RECENT_TRANSCRIPTION_ERROR,
                    strings.get("native.menu.recent_error"),
                    false,
                    None::<&str>,
                )?;
                submenu = submenu.item(&item);
            }
        }
    } else {
        let item = MenuItem::with_id(
            app,
            MENU_ID_RECENT_TRANSCRIPTION_EMPTY,
            strings.get("native.menu.recent_empty"),
            false,
            None::<&str>,
        )?;
        submenu = submenu.item(&item);
    }

    submenu.build()
}

/// Disabled until there is something to copy.
pub fn build_copy_last_item(
    app: &AppHandle<AppRuntime>,
    strings: &MenuStrings,
) -> tauri::Result<MenuItem<AppRuntime>> {
    let has_last = app.try_state::<AppState>().is_some_and(|state| {
        state
            .storage()
            .get_recent_transcriptions(1)
            .is_ok_and(|records| !records.is_empty())
    });
    MenuItem::with_id(
        app,
        MENU_ID_COPY_LAST_TRANSCRIPTION,
        strings.get("native.menu.copy_last"),
        has_last,
        None::<&str>,
    )
}

pub fn copy_last_transcription_to_clipboard(app: &AppHandle<AppRuntime>) {
    match app
        .state::<AppState>()
        .storage()
        .get_recent_transcriptions(1)
    {
        Ok(records) => match records.first() {
            Some(record) => copy_transcription_to_clipboard(app, &record.id),
            None => refresh_recent_menus(app),
        },
        Err(err) => {
            tracing::error!("Failed to load the last transcription: {err}");
            emit_copy_error_toast(app, "Unable to copy to clipboard");
        }
    }
}

pub fn copy_transcription_to_clipboard(app: &AppHandle<AppRuntime>, transcription_id: &str) {
    let record = app
        .state::<AppState>()
        .storage()
        .get_by_id(transcription_id);
    let Some(record) = record else {
        emit_copy_error_toast(app, "Transcription no longer available");
        refresh_recent_menus(app);
        return;
    };
    let text = record.text.trim();
    if text.is_empty() {
        emit_copy_error_toast(app, "Transcription is empty");
        refresh_recent_menus(app);
        return;
    }
    if let Err(err) = assistive::copy_text_to_clipboard(text) {
        tracing::error!("Failed to copy transcription to clipboard: {err}");
        emit_copy_error_toast(app, "Unable to copy to clipboard");
        return;
    }

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "success".to_string(),
            message: toast::native(app, "native.toast.copied"),
            auto_dismiss: Some(true),
            duration: Some(1200),
            ..Default::default()
        },
    );
}

fn emit_copy_error_toast(app: &AppHandle<AppRuntime>, message: &str) {
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "error".to_string(),
            message: message.to_string(),
            auto_dismiss: Some(true),
            duration: Some(1600),
            ..Default::default()
        },
    );
}

fn refresh_recent_menus(app: &AppHandle<AppRuntime>) {
    crate::tray::refresh_menus(app, &app.state::<AppState>().current_settings());
}

fn format_transcription_preview(text: &str, max_len: usize, empty_label: &str) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return empty_label.to_string();
    }

    let mut chars = cleaned.chars();
    let preview: String = chars.by_ref().take(max_len).collect();
    if chars.next().is_some() {
        let trim_len = max_len.saturating_sub(3);
        let mut shortened: String = preview.chars().take(trim_len).collect();
        shortened.push_str("...");
        shortened
    } else {
        preview
    }
}
