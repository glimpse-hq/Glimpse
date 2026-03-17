use crate::AppRuntime;
use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime, TitleBarStyle, WebviewWindowBuilder};

/// Configure a Tauri WebviewWindowBuilder with an overlay title bar and a hidden native title area.
///
/// This returns the provided `WebviewWindowBuilder` after setting its title bar style to
/// `TitleBarStyle::Overlay` and enabling the hidden native title area.
///
/// # Examples
///
/// ```
/// use tauri::{Manager, Runtime, WebviewWindowBuilder};
/// use tauri::TitleBarStyle;
/// // assume `builder` is a valid WebviewWindowBuilder instance
/// let builder = WebviewWindowBuilder::<_, _>::new("id", "url");
/// let builder = crate::platform::macos::glimpse_window::configure_builder(builder);
/// // builder now has overlay title bar and hidden native title area
/// ```
pub fn configure_builder<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
}

/// Prepare the application to be shown by setting its activation policy to `Regular`.
///
/// This sets the app's activation policy so the application can become a foreground app and receive focus.
///
/// # Returns
///
/// `Ok(())` on success.
///
/// # Errors
///
/// Propagates any error returned by `AppHandle::set_activation_policy`.
///
/// # Examples
///
/// ```no_run
/// # use anyhow::Result;
/// # use tauri::{AppHandle, Runtime};
/// # use crate::prepare_to_show;
/// # fn example(app: &AppHandle<impl Runtime>) -> Result<()> {
/// prepare_to_show(app)?;
/// # Ok(())
/// # }
/// ```
pub fn prepare_to_show(app: &AppHandle<AppRuntime>) -> Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular)?;
    Ok(())
}

/// Prepare the running application to be hidden by setting its macOS activation policy to `Accessory`.
///
/// This changes the app's activation behavior so it does not appear in the Dock or receive regular activations.
///
/// # Parameters
///
/// - `app`: The Tauri application handle for which the activation policy will be changed.
///
/// # Returns
///
/// `Ok(())` on success, or an error if changing the activation policy fails.
///
/// # Examples
///
/// ```no_run
/// # use tauri::AppHandle;
/// # use your_crate::prepare_to_hide;
/// fn some_handler(app: AppHandle<AppRuntime>) {
///     prepare_to_hide(&app).expect("failed to set activation policy");
/// }
/// ```
pub fn prepare_to_hide(app: &AppHandle<AppRuntime>) -> Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    Ok(())
}
