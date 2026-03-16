use crate::AppRuntime;
use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime, TitleBarStyle, WebviewWindowBuilder};

pub fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
}

pub fn prepare_to_show(app: &AppHandle<AppRuntime>) -> Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular)?;
    Ok(())
}

pub fn prepare_to_hide(app: &AppHandle<AppRuntime>) -> Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    Ok(())
}
