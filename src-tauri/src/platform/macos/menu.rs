use crate::AppRuntime;
use crate::native_i18n::MenuStrings;
use crate::settings::UserSettings;
use crate::speech::menu::{build_model_status_items, build_models_submenu};
use crate::tray::{MENU_ID_CHECK_UPDATES, build_microphone_submenu};
use tauri::AppHandle;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

const MENU_ID_WEBSITE: &str = "menu_website";
const MENU_ID_REPORT_ISSUE: &str = "menu_report_issue";

/// Items only the app menu has; the rest are handled in `tray::handle_menu_event`.
pub(crate) fn handle_app_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    use tauri_plugin_opener::OpenerExt;

    match id {
        MENU_ID_WEBSITE => {
            let _ = app
                .opener()
                .open_url("https://tryglimpse.cc/", None::<&str>);
        }
        MENU_ID_REPORT_ISSUE => {
            let _ = app.opener().open_url(crate::FEEDBACK_URL, None::<&str>);
        }
        _ => {}
    }
}

pub fn build_app_menu(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> tauri::Result<Menu<AppRuntime>> {
    let app_name = app.package_info().name.clone();
    let strings = MenuStrings::resolve(settings);

    // Everyday actions live in the tray menu; this one holds setup and app-level items.
    let mut app_submenu = SubmenuBuilder::new(app, &app_name)
        .item(
            &MenuItemBuilder::with_id(
                MENU_ID_CHECK_UPDATES,
                strings.get("native.menu.check_updates_long"),
            )
            .build(app)?,
        )
        .separator();
    for item in build_model_status_items(app, settings)? {
        app_submenu = app_submenu.item(&item);
    }
    let app_menu = app_submenu
        .item(&build_models_submenu(app, settings)?)
        .item(&build_microphone_submenu(app, settings, &strings)?)
        .separator()
        .item(&PredefinedMenuItem::services(
            app,
            Some(strings.get("native.menu.services")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(
            app,
            Some(&strings.format("native.menu.hide", &[("app", &app_name)])),
        )?)
        .item(&PredefinedMenuItem::hide_others(
            app,
            Some(strings.get("native.menu.hide_others")),
        )?)
        .item(&PredefinedMenuItem::show_all(
            app,
            Some(strings.get("native.menu.show_all")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::quit(
            app,
            Some(&strings.format("native.menu.quit", &[("app", &app_name)])),
        )?)
        .build()?;

    // View menu
    let view_menu = SubmenuBuilder::new(app, strings.get("native.menu.view"))
        .item(&PredefinedMenuItem::close_window(
            app,
            Some(strings.get("native.menu.close_window")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(strings.get("native.menu.fullscreen")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::minimize(
            app,
            Some(strings.get("native.menu.minimize")),
        )?)
        .item(&PredefinedMenuItem::maximize(
            app,
            Some(strings.get("native.menu.zoom")),
        )?)
        .build()?;

    // Edit menu (enables standard copy/paste shortcuts)
    let edit_menu = SubmenuBuilder::new(app, strings.get("native.menu.edit"))
        .item(&PredefinedMenuItem::undo(
            app,
            Some(strings.get("native.menu.undo")),
        )?)
        .item(&PredefinedMenuItem::redo(
            app,
            Some(strings.get("native.menu.redo")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::cut(
            app,
            Some(strings.get("native.menu.cut")),
        )?)
        .item(&PredefinedMenuItem::copy(
            app,
            Some(strings.get("native.menu.copy")),
        )?)
        .item(&PredefinedMenuItem::paste(
            app,
            Some(strings.get("native.menu.paste")),
        )?)
        .item(&PredefinedMenuItem::select_all(
            app,
            Some(strings.get("native.menu.select_all")),
        )?)
        .build()?;

    // Help menu
    let help_menu = SubmenuBuilder::new(app, strings.get("native.menu.help"))
        .item(
            &MenuItemBuilder::with_id(MENU_ID_WEBSITE, strings.get("native.menu.github"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id(
                MENU_ID_REPORT_ISSUE,
                strings.get("native.menu.send_feedback"),
            )
            .build(app)?,
        )
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &help_menu])
        .build()
}
