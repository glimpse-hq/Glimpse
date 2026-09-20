use crate::native_i18n::MenuStrings;
use crate::recent_transcriptions::{
    MENU_ID_COPY_LAST_TRANSCRIPTION, MENU_ID_RECENT_TRANSCRIPTION_PREFIX, build_copy_last_item,
    build_recent_transcriptions_menu, copy_last_transcription_to_clipboard,
    copy_transcription_to_clipboard,
};
use crate::settings::UserSettings;
use crate::speech::menu::handle_speech_menu_event;
use crate::{AppRuntime, AppState, SETTINGS_WINDOW_LABEL, audio};
use parking_lot::Mutex;
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

pub(crate) const MENU_ID_CHECK_UPDATES: &str = "menu_check_updates";
const MENU_ID_OPEN_SETTINGS: &str = "open_settings";
const MENU_ID_QUIT: &str = "quit_glimpse";
const MENU_ID_MIC_PREFIX: &str = "menu_mic_";
const MENU_ID_MIC_DEFAULT: &str = "menu_mic_default";
const MENU_ID_RECORDING_START: &str = "menu_recording_start";
const MENU_ID_RECORDING_TOGGLE_PAUSE: &str = "menu_recording_toggle_pause";
const MENU_ID_RECORDING_BOOKMARK: &str = "menu_recording_bookmark";
const MENU_ID_RECORDING_FINISH: &str = "menu_recording_finish";
// Apple's system red, so the icon reads as "recording" on any menu bar.
const RECORDING_ICON_RGB: [u8; 3] = [255, 59, 48];
pub(crate) const EVENT_SETTINGS_RENDERER_READY: &str = "settings:renderer_ready";

#[derive(Clone, Copy)]
pub(crate) enum SettingsPage {
    About,
    History,
    Models,
    Account,
    Dictionary,
    Personalization,
    Library,
    Record,
}

impl SettingsPage {
    fn event(self) -> &'static str {
        match self {
            Self::About => "navigate:about",
            Self::History => "navigate:history",
            Self::Models => "navigate:models",
            Self::Account => "navigate:account",
            Self::Dictionary => "navigate:dictionary",
            Self::Personalization => "navigate:personalization",
            Self::Library => "navigate:library",
            Self::Record => "navigate:record",
        }
    }
}

fn format_clock(elapsed_ms: u64) -> String {
    let total = elapsed_ms / 1000;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// The menu bar glyph in white, for drawing on the recording pill.
#[cfg(target_os = "macos")]
fn white_tray_glyph(size: f64) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::AnyThread;
    use objc2::runtime::Bool;
    use objc2_app_kit::{NSColor, NSCompositingOperation, NSImage, NSRectFillUsingOperation};
    use objc2_foundation::{NSData, NSRect, NSSize};

    let data = NSData::with_bytes(include_bytes!("../icons/tray.png"));
    let glyph = NSImage::initWithData(NSImage::alloc(), &data)?;
    let draw = block2::RcBlock::new(move |rect: NSRect| {
        glyph.drawInRect_fromRect_operation_fraction(
            rect,
            NSRect::ZERO,
            NSCompositingOperation::SourceOver,
            1.0,
        );
        NSColor::whiteColor().set();
        NSRectFillUsingOperation(rect, NSCompositingOperation::SourceAtop);
        Bool::YES
    });
    Some(NSImage::imageWithSize_flipped_drawingHandler(
        NSSize::new(size, size),
        false,
        &draw,
    ))
}

/// White glyph and clock on a red rounded box. Drawn as one image so the
/// status item only changes width when the clock gains an hours field.
#[cfg(target_os = "macos")]
fn recording_pill_image(clock: &str) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};
    use objc2_app_kit::{
        NSBezierPath, NSColor, NSCompositingOperation, NSFont, NSFontAttributeName,
        NSFontWeightMedium, NSForegroundColorAttributeName, NSImage, NSStringDrawing,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    const HEIGHT: f64 = 18.0;
    const GLYPH: f64 = 14.0;
    const PAD_LEFT: f64 = 5.0;
    const GAP: f64 = 3.0;
    const PAD_RIGHT: f64 = 7.0;
    const RADIUS: f64 = 5.0;

    let glyph = white_tray_glyph(GLYPH)?;
    let font = NSFont::monospacedDigitSystemFontOfSize_weight(12.0, unsafe { NSFontWeightMedium });
    let keys = unsafe { [NSFontAttributeName, NSForegroundColorAttributeName] };
    let attrs = NSDictionary::<NSString, AnyObject>::from_retained_objects(
        &keys,
        &[
            Retained::into_super(Retained::into_super(font)),
            Retained::into_super(Retained::into_super(NSColor::whiteColor())),
        ],
    );
    let text = NSString::from_str(clock);
    let text_size = unsafe { text.sizeWithAttributes(Some(&attrs)) };
    let text_x = PAD_LEFT + GLYPH + GAP;
    let width = (text_x + text_size.width + PAD_RIGHT).ceil();

    let [red, green, blue] = RECORDING_ICON_RGB.map(|channel| f64::from(channel) / 255.0);
    let draw = block2::RcBlock::new(move |rect: NSRect| {
        NSColor::colorWithSRGBRed_green_blue_alpha(red, green, blue, 1.0).setFill();
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(rect, RADIUS, RADIUS).fill();
        glyph.drawInRect_fromRect_operation_fraction(
            NSRect::new(
                NSPoint::new(PAD_LEFT, (HEIGHT - GLYPH) / 2.0),
                NSSize::new(GLYPH, GLYPH),
            ),
            NSRect::ZERO,
            NSCompositingOperation::SourceOver,
            1.0,
        );
        unsafe {
            text.drawAtPoint_withAttributes(
                NSPoint::new(text_x, ((HEIGHT - text_size.height) / 2.0).round()),
                Some(&attrs),
            );
        }
        Bool::YES
    });
    Some(NSImage::imageWithSize_flipped_drawingHandler(
        NSSize::new(width, HEIGHT),
        false,
        &draw,
    ))
}

/// Rasterizes the pill at 2x into straight-alpha RGBA for the tray icon.
#[cfg(target_os = "macos")]
fn recording_pill_icon(clock: &str) -> Option<tauri::image::Image<'static>> {
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace, NSGraphicsContext,
    };
    use objc2_foundation::{NSPoint, NSRect};

    const SCALE: f64 = 2.0;

    let image = recording_pill_image(clock)?;
    let size = image.size();
    let width = (size.width * SCALE) as usize;
    let height = (size.height * SCALE) as usize;
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            width as isize,
            height as isize,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }?;
    // Point size, so drawing in points fills the 2x pixel grid.
    rep.setSize(size);
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    image.drawInRect_fromRect_operation_fraction(
        NSRect::new(NSPoint::new(0.0, 0.0), size),
        NSRect::ZERO,
        NSCompositingOperation::SourceOver,
        1.0,
    );
    context.flushGraphics();
    NSGraphicsContext::restoreGraphicsState_class();

    let data = rep.bitmapData();
    if data.is_null() {
        return None;
    }
    let stride = rep.bytesPerRow() as usize;
    let pixels = unsafe { std::slice::from_raw_parts(data, stride * height) };
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in pixels.chunks_exact(stride) {
        for pixel in row[..width * 4].chunks_exact(4) {
            // The bitmap is premultiplied.
            let alpha = u16::from(pixel[3]);
            let straight = |channel: u8| match alpha {
                0 => 0,
                _ => (u16::from(channel) * 255 / alpha).min(255) as u8,
            };
            rgba.extend([
                straight(pixel[0]),
                straight(pixel[1]),
                straight(pixel[2]),
                pixel[3],
            ]);
        }
    }
    Some(tauri::image::Image::new_owned(
        rgba,
        width as u32,
        height as u32,
    ))
}

#[cfg(target_os = "windows")]
fn tray_icon(app: &AppHandle<AppRuntime>, recording: bool) -> Option<tauri::image::Image<'static>> {
    let icon = app.default_window_icon()?.clone().to_owned();
    if !recording {
        return Some(icon);
    }
    // A red badge in the corner, the Windows convention for live state.
    let (width, height) = (icon.width() as i32, icon.height() as i32);
    let mut rgba = icon.rgba().to_vec();
    let radius = (width.min(height) as f32 * 0.28).max(3.0);
    let (cx, cy) = (width as f32 - radius - 1.0, height as f32 - radius - 1.0);
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy <= radius * radius {
                let index = ((y * width + x) * 4) as usize;
                rgba[index..index + 3].copy_from_slice(&RECORDING_ICON_RGB);
                rgba[index + 3] = 255;
            }
        }
    }
    Some(tauri::image::Image::new_owned(
        rgba,
        width as u32,
        height as u32,
    ))
}

/// Shows the recording indicator with the elapsed time while a session is
/// active; `None` restores the idle icon.
pub(crate) fn set_recording_indicator(app: &AppHandle<AppRuntime>, elapsed_ms: Option<u64>) {
    static SHOWING_RECORDING: AtomicBool = AtomicBool::new(false);
    let state = app.state::<AppState>();
    let Some(tray) = state.tray.lock().clone() else {
        return;
    };
    let recording = elapsed_ms.is_some();
    let changed = SHOWING_RECORDING.swap(recording, Ordering::Relaxed) != recording;

    #[cfg(target_os = "macos")]
    {
        match elapsed_ms {
            Some(elapsed) => match recording_pill_icon(&format_clock(elapsed)) {
                Some(icon) => {
                    if let Err(err) = tray.set_icon_with_as_template(Some(icon), false) {
                        tracing::warn!("Failed to update tray icon: {err}");
                    }
                }
                None => tracing::warn!("Failed to draw the recording tray icon"),
            },
            None if changed => {
                match tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
                    Ok(icon) => {
                        if let Err(err) = tray.set_icon_with_as_template(Some(icon), true) {
                            tracing::warn!("Failed to restore tray icon: {err}");
                        }
                    }
                    Err(err) => tracing::warn!("Failed to build tray icon: {err}"),
                }
            }
            None => {}
        }
    }

    #[cfg(target_os = "windows")]
    {
        if changed {
            if let Some(icon) = tray_icon(app, recording)
                && let Err(err) = tray.set_icon(Some(icon))
            {
                tracing::warn!("Failed to update tray icon: {err}");
            }
        }
        let app_name = app.package_info().name.clone();
        let tooltip = match elapsed_ms {
            Some(elapsed) => format!("{app_name} · {}", format_clock(elapsed)),
            None => app_name,
        };
        if let Err(err) = tray.set_tooltip(Some(tooltip)) {
            tracing::warn!("Failed to update tray tooltip: {err}");
        }
    }
}

#[derive(Default)]
struct PendingSettingsNavigation {
    renderer_ready: bool,
    target: Option<SettingsPage>,
}

fn pending_settings_navigation() -> &'static Mutex<PendingSettingsNavigation> {
    static PENDING: OnceLock<Mutex<PendingSettingsNavigation>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(PendingSettingsNavigation::default()))
}

fn flush_pending_settings_navigation(app: &AppHandle<AppRuntime>) {
    let target = {
        let mut pending = pending_settings_navigation().lock();
        if !pending.renderer_ready {
            return;
        }
        pending.target.take()
    };

    if let Some(page) = target {
        let _ = app.emit(page.event(), ());
    }
}

pub(crate) fn mark_settings_renderer_ready(app: &AppHandle<AppRuntime>) {
    pending_settings_navigation().lock().renderer_ready = true;
    flush_pending_settings_navigation(app);
}

pub(crate) fn open_settings_page(
    app: &AppHandle<AppRuntime>,
    page: SettingsPage,
) -> tauri::Result<()> {
    pending_settings_navigation().lock().target = Some(page);
    if let Err(err) = toggle_settings_window(app) {
        pending_settings_navigation().lock().target = None;
        return Err(err);
    }
    flush_pending_settings_navigation(app);
    Ok(())
}

pub(crate) fn build_microphone_submenu(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
    strings: &MenuStrings,
) -> tauri::Result<Submenu<AppRuntime>> {
    let mut mic_submenu = SubmenuBuilder::new(app, strings.get("native.menu.microphone"));
    let default_mic = CheckMenuItemBuilder::with_id(
        MENU_ID_MIC_DEFAULT,
        strings.get("native.menu.mic_system_default"),
    )
    .checked(settings.microphone_device.is_none())
    .build(app)?;
    mic_submenu = mic_submenu.item(&default_mic);

    match audio::list_input_devices() {
        Ok(devices) => {
            if devices.is_empty() {
                let unavailable = MenuItem::with_id(
                    app,
                    "menu_mic_none",
                    strings.get("native.menu.mic_none"),
                    false,
                    None::<&str>,
                )?;
                mic_submenu = mic_submenu.item(&unavailable);
            } else {
                for device in devices {
                    let label = if device.is_default {
                        strings.format("native.menu.mic_default_suffix", &[("name", &device.name)])
                    } else {
                        device.name.clone()
                    };
                    let checked = settings.microphone_device.as_deref() == Some(device.id.as_str());
                    let item = CheckMenuItemBuilder::with_id(
                        format!("{MENU_ID_MIC_PREFIX}dev:{}", device.id),
                        label,
                    )
                    .checked(checked)
                    .build(app)?;
                    mic_submenu = mic_submenu.item(&item);
                }
            }
        }
        Err(err) => {
            let unavailable = MenuItem::with_id(
                app,
                "menu_mic_error",
                strings.format(
                    "native.menu.mic_unavailable",
                    &[("error", &err.to_string())],
                ),
                false,
                None::<&str>,
            )?;
            mic_submenu = mic_submenu.item(&unavailable);
        }
    }
    mic_submenu.build()
}

/// Session controls while recording, otherwise Start Recording, which is
/// disabled without a license.
fn build_recording_items(
    app: &AppHandle<AppRuntime>,
    strings: &MenuStrings,
) -> tauri::Result<Vec<MenuItem<AppRuntime>>> {
    let state = app.state::<AppState>();
    let recording = state.recording().state();
    if recording.status != "recording" && recording.status != "paused" {
        let licensed = crate::license::license_gate_active(&state.settings_store);
        return Ok(vec![MenuItem::with_id(
            app,
            MENU_ID_RECORDING_START,
            strings.get("native.menu.recording_start"),
            licensed,
            None::<&str>,
        )?]);
    }

    let paused = recording.status == "paused";
    Ok(vec![
        MenuItem::with_id(
            app,
            "menu_recording_status",
            if paused {
                strings.get("native.menu.recording_paused")
            } else {
                strings.get("native.menu.recording_active")
            },
            false,
            None::<&str>,
        )?,
        MenuItem::with_id(
            app,
            MENU_ID_RECORDING_TOGGLE_PAUSE,
            if paused {
                strings.get("native.menu.recording_resume")
            } else {
                strings.get("native.menu.recording_pause")
            },
            true,
            None::<&str>,
        )?,
        MenuItem::with_id(
            app,
            MENU_ID_RECORDING_BOOKMARK,
            strings.get("native.menu.recording_bookmark"),
            true,
            None::<&str>,
        )?,
        MenuItem::with_id(
            app,
            MENU_ID_RECORDING_FINISH,
            strings.get("native.menu.recording_finish"),
            true,
            None::<&str>,
        )?,
    ])
}

fn build_tray_menu(
    app: &AppHandle<AppRuntime>,
    settings: &UserSettings,
) -> tauri::Result<Menu<AppRuntime>> {
    let strings = MenuStrings::resolve(settings);
    let app_name = app.package_info().name.clone();
    let mut menu = MenuBuilder::new(app);

    for item in build_recording_items(app, &strings)? {
        menu = menu.item(&item);
    }
    menu = menu
        .separator()
        .item(&build_copy_last_item(app, &strings)?)
        .item(&build_recent_transcriptions_menu(app, &strings)?)
        .separator();

    // Windows has no app menu, so the tray also carries what macOS puts there.
    #[cfg(target_os = "windows")]
    {
        use crate::speech::menu::{build_model_status_items, build_models_submenu};

        for item in build_model_status_items(app, settings)? {
            menu = menu.item(&item);
        }
        menu = menu
            .item(&build_models_submenu(app, settings)?)
            .item(&build_microphone_submenu(app, settings, &strings)?)
            .separator();

        // Store builds update through the Store.
        if !crate::platform::is_store_build() {
            let check_updates = MenuItem::with_id(
                app,
                MENU_ID_CHECK_UPDATES,
                strings.get("native.menu.check_updates_long"),
                true,
                None::<&str>,
            )?;
            menu = menu.item(&check_updates).separator();
        }
    }

    let open_settings = MenuItem::with_id(
        app,
        MENU_ID_OPEN_SETTINGS,
        strings.format("native.tray.open", &[("app", &app_name)]),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_ID_QUIT,
        strings.format("native.tray.quit", &[("app", &app_name)]),
        true,
        None::<&str>,
    )?;
    menu = menu.item(&open_settings).item(&quit);

    menu.build()
}

/// Rebuilds the tray menu and, on macOS, the app menu.
pub(crate) fn refresh_menus(app: &AppHandle<AppRuntime>, settings: &UserSettings) {
    if let Some(tray) = app.state::<AppState>().tray.lock().clone()
        && let Err(err) = build_tray_menu(app, settings).and_then(|menu| tray.set_menu(Some(menu)))
    {
        tracing::error!("Failed to refresh tray menu: {err}");
    }
    #[cfg(target_os = "macos")]
    if let Err(err) = crate::set_app_menu(app, settings) {
        tracing::error!("Failed to refresh app menu: {err}");
    }
}

fn set_microphone_from_menu(app: &AppHandle<AppRuntime>, device_id: Option<&str>) {
    let state = app.state::<AppState>();
    let mut settings = state.current_settings_unmasked();
    if settings.microphone_device.as_deref() == device_id {
        return;
    }
    let previous = settings.clone();
    settings.microphone_device = device_id.map(|id| id.to_string());
    match state.persist_settings(settings) {
        Ok(saved) => {
            crate::analytics::track_settings_changes(app, &previous, &saved);
            refresh_menus(app, &saved);
            state.emit_settings_changed(app, &saved);
        }
        Err(err) => tracing::error!("Failed to update microphone selection: {err}"),
    }
}

/// Handles clicks from the tray menu and the macOS app menu. Tauri delivers
/// every menu event to every global listener, so this is the only one.
pub(crate) fn handle_menu_event(app: &AppHandle<AppRuntime>, id: &str) {
    if let Some(saved) = handle_speech_menu_event(app, id) {
        refresh_menus(app, &saved);
        return;
    }

    match id {
        MENU_ID_OPEN_SETTINGS => {
            if let Err(err) = toggle_settings_window(app) {
                tracing::error!("Failed to open settings window: {err}");
            }
        }
        MENU_ID_QUIT => app.exit(0),
        MENU_ID_CHECK_UPDATES => {
            if let Err(err) = open_settings_page(app, SettingsPage::About) {
                tracing::error!("Failed to open the About screen: {err}");
            }
        }
        MENU_ID_MIC_DEFAULT => set_microphone_from_menu(app, None),
        MENU_ID_COPY_LAST_TRANSCRIPTION => copy_last_transcription_to_clipboard(app),
        MENU_ID_RECORDING_START => crate::recording::start_from_tray(app),
        MENU_ID_RECORDING_TOGGLE_PAUSE => crate::recording::toggle_pause_from_tray(app),
        MENU_ID_RECORDING_BOOKMARK => crate::recording::add_bookmark_from_tray(app),
        MENU_ID_RECORDING_FINISH => crate::recording::request_finish_from_tray(app),
        _ => {
            if let Some(transcription_id) = id.strip_prefix(MENU_ID_RECENT_TRANSCRIPTION_PREFIX) {
                copy_transcription_to_clipboard(app, transcription_id);
            } else if let Some(device_id_raw) = id.strip_prefix(MENU_ID_MIC_PREFIX) {
                let device_id = device_id_raw.strip_prefix("dev:").unwrap_or(device_id_raw);
                set_microphone_from_menu(app, Some(device_id));
            } else {
                #[cfg(target_os = "macos")]
                crate::platform::macos::menu::handle_app_menu_event(app, id);
            }
        }
    }
}

pub fn build_tray(app: &AppHandle<AppRuntime>) -> tauri::Result<TrayIcon<AppRuntime>> {
    let settings = app.state::<AppState>().current_settings();
    let menu = build_tray_menu(app, &settings)?;

    let builder = TrayIconBuilder::new();

    #[cfg(target_os = "macos")]
    let builder = {
        let icon_bytes = include_bytes!("../icons/tray.png");
        let icon = tauri::image::Image::from_bytes(icon_bytes)?.to_owned();
        builder.icon(icon).icon_as_template(true)
    };

    #[cfg(target_os = "windows")]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    }
    .tooltip(app.package_info().name.clone());

    builder
        .menu(&menu)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button,
                button_state,
                ..
            } if button == MouseButton::Left && button_state == MouseButtonState::Up => {
                if let Err(err) = toggle_settings_window(tray.app_handle()) {
                    tracing::error!("Failed to toggle settings window: {err}");
                }
            }
            _ => {}
        })
        .build(app)
}

pub fn toggle_settings_window(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let mut reset_close_flag = false;

    let window = match app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        Some(existing) => existing,
        _ => {
            reset_close_flag = true;
            let builder =
                WebviewWindowBuilder::new(app, SETTINGS_WINDOW_LABEL, WebviewUrl::default())
                    .title("Glimpse")
                    .inner_size(900.0, 750.0)
                    .min_inner_size(900.0, 750.0)
                    .resizable(true)
                    .visible(false);

            #[cfg(target_os = "macos")]
            let builder = builder
                .hidden_title(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay);

            #[cfg(target_os = "windows")]
            let builder = builder.decorations(false);

            builder.build()?
        }
    };

    if reset_close_flag {
        state
            .settings_close_handler_registered
            .store(false, Ordering::SeqCst);
    }

    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Regular);

    if window.is_minimized().unwrap_or(false) {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()?;

    // Show a toast if the app just restarted via auto-update
    if state.take_auto_update_completed() {
        let current_version = env!("CARGO_PKG_VERSION");
        crate::toast::emit_toast(
            app,
            crate::toast::Payload {
                toast_type: "success".to_string(),
                message: format!("Glimpse updated to v{current_version}."),
                auto_dismiss: Some(true),
                duration: Some(5000),
                ..Default::default()
            },
        );
    }

    let already_registered = state
        .settings_close_handler_registered
        .swap(true, Ordering::SeqCst);
    if !already_registered {
        let app_handle = app.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_clone.hide();
                tauri::Manager::state::<crate::AppState>(&app_handle)
                    .pill()
                    .stop_microphone_test(&app_handle);
                #[cfg(target_os = "macos")]
                let _ = app_handle.set_activation_policy(ActivationPolicy::Accessory);
            }
        });
    }

    Ok(())
}
