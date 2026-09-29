use crate::AppRuntime;
use crate::recording::live_window::WINDOW_LABEL;
use anyhow::{Context, Result, anyhow};
use tauri::{AppHandle, WebviewWindow};
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel,
};

// Key only when a text field is clicked, so buttons never pull focus from the meeting.
tauri_panel! {
    panel!(LivePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            becomes_key_only_if_needed: true,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

/// Runs on the main thread, since `open_live_view` is async and AppKit traps
/// panel changes from other threads. `show` queues after it.
pub fn init(app: &AppHandle<AppRuntime>, live_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let app_clone = app.clone();
    let live_window = live_window.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = make_panel(&app_clone, &live_window) {
            tracing::error!("Failed to initialize macOS live view panel: {err:#}");
        }
    })
    .context("schedule live view panel setup")
}

fn make_panel(app: &AppHandle<AppRuntime>, live_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    live_window
        .to_panel::<LivePanel>()
        .map_err(|err| anyhow!(format!("{err:?}")))
        .context("convert live view window to macOS NSPanel")?;

    let panel = app
        .get_webview_panel(WINDOW_LABEL)
        .map_err(|err| anyhow!(format!("{err:?}")))
        .context("get macOS live view panel")?;

    let style = StyleMask::empty()
        .borderless()
        .resizable()
        .nonactivating_panel();
    if let Err(err) = panel.set_style_mask(style.into()) {
        tracing::warn!("Failed to set live view panel style mask: {err}");
    }
    panel.set_level(PanelLevel::Floating.into());

    // Full screen auxiliary keeps it over full screen meeting apps.
    let behavior = CollectionBehavior::new()
        .can_join_all_spaces()
        .full_screen_auxiliary();
    panel.set_collection_behavior(behavior.into());
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);

    Ok(())
}

pub fn show(app: &AppHandle<AppRuntime>, _live_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(panel) = app_clone.get_webview_panel(WINDOW_LABEL) {
            panel.show();
        }
    });
    Ok(())
}

pub fn hide(app: &AppHandle<AppRuntime>, _live_window: &WebviewWindow<AppRuntime>) -> Result<()> {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Ok(panel) = app_clone.get_webview_panel(WINDOW_LABEL) {
            panel.hide();
        }
    });
    Ok(())
}
