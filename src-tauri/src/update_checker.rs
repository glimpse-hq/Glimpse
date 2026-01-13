use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::{toast, AppRuntime, AppState};

const CHECK_INTERVAL_HOURS: u64 = 6;
const INITIAL_DELAY_SECS: u64 = 30;

#[derive(Default)]
pub struct UpdateState {
    available_version: Option<String>,
    toast_shown_this_session: bool,
}

impl UpdateState {
    pub fn set_available(&mut self, version: String) {
        self.available_version = Some(version);
    }

    pub fn is_available(&self) -> bool {
        self.available_version.is_some()
    }

    pub fn available_version(&self) -> Option<&String> {
        self.available_version.as_ref()
    }

    pub fn mark_toast_shown(&mut self) {
        self.toast_shown_this_session = true;
    }

    pub fn should_show_toast(&self) -> bool {
        self.is_available() && !self.toast_shown_this_session
    }

    pub fn clear(&mut self) {
        self.available_version = None;
        self.toast_shown_this_session = false;
    }
}

pub type SharedUpdateState = Arc<Mutex<UpdateState>>;

pub fn create_state() -> SharedUpdateState {
    Arc::new(Mutex::new(UpdateState::default()))
}

pub fn start_background_checker(app: AppHandle<AppRuntime>, state: SharedUpdateState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECS)).await;

        loop {
            if let Err(err) = check_for_update(&app, &state).await {
                eprintln!("[update_checker] Check failed: {err}");
            }
            tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_HOURS * 60 * 60)).await;
        }
    });
}

async fn check_for_update(
    app: &AppHandle<AppRuntime>,
    state: &SharedUpdateState,
) -> anyhow::Result<()> {
    eprintln!("[update_checker] Checking for updates...");

    let updater = app.updater()?;
    let update = updater.check().await?;

    if let Some(update) = update {
        let version = update.version.clone();
        eprintln!("[update_checker] Update available: v{version}");

        {
            let mut guard = state.lock();
            if guard.available_version.as_ref() != Some(&version) {
                guard.set_available(version.clone());
                guard.toast_shown_this_session = false;
            }
        }

        let _ = app.emit("update:available", version);
    } else {
        eprintln!("[update_checker] No updates available");
        state.lock().clear();
    }

    Ok(())
}

pub fn maybe_show_update_toast(app: &AppHandle<AppRuntime>, state: &SharedUpdateState) {
    let (should_show, new_version) = {
        let guard = state.lock();
        (
            guard.should_show_toast(),
            guard.available_version().cloned(),
        )
    };

    if !should_show {
        return;
    }

    state.lock().mark_toast_shown();

    let current_version = env!("CARGO_PKG_VERSION");
    let message = match new_version {
        Some(ref v) => format!("v{current_version} → v{v}"),
        None => "Update available.".to_string(),
    };

    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "update".to_string(),
            title: None,
            message,
            auto_dismiss: Some(false),
            duration: None,
            retry_id: None,
            mode: None,
            action: Some("open_about_page".to_string()),
            action_label: Some("Update".to_string()),
        },
    );
}

#[derive(Serialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub fn get_update_status(app: AppHandle<AppRuntime>) -> UpdateStatus {
    let state = app.state::<AppState>();
    let guard = state.update_state().lock();
    UpdateStatus {
        available: guard.is_available(),
        version: guard.available_version().cloned(),
    }
}

#[tauri::command]
pub fn trigger_update_check(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let update_state = state.update_state().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = check_for_update(&app, &update_state).await {
            eprintln!("[update_checker] Manual check failed: {err}");
        }
    });
}

#[tauri::command]
pub fn simulate_update_available(app: AppHandle<AppRuntime>, version: String) {
    let state = app.state::<AppState>();
    {
        let mut guard = state.update_state().lock();
        guard.set_available(version.clone());
        guard.toast_shown_this_session = false;
    }
    let _ = app.emit("update:available", version);
}

#[tauri::command]
pub fn clear_update_state(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    state.update_state().lock().clear();
    let _ = app.emit("update:cleared", ());
}

#[tauri::command]
pub fn show_update_toast_now(app: AppHandle<AppRuntime>) {
    let state = app.state::<AppState>();
    let update_state = state.update_state().clone();

    {
        let mut guard = update_state.lock();
        if !guard.is_available() {
            guard.set_available("99.0.0".to_string());
        }
        guard.toast_shown_this_session = false;
    }

    maybe_show_update_toast(&app, &update_state);
}
