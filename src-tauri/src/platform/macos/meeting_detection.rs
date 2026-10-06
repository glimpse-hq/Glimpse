#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingProvider {
    FaceTime,
    Zoom,
    Teams,
    GoogleMeetSafari,
    GoogleMeetChrome,
    GoogleMeetEdge,
    GoogleMeetFirefox,
    ZoomWebSafari,
    ZoomWebChrome,
    ZoomWebEdge,
    ZoomWebFirefox,
}

impl MeetingProvider {
    pub const CONFIGURABLE: [Self; 7] = [
        Self::FaceTime,
        Self::Zoom,
        Self::Teams,
        Self::GoogleMeetSafari,
        Self::GoogleMeetChrome,
        Self::GoogleMeetEdge,
        Self::GoogleMeetFirefox,
    ];

    pub fn setting_id(self) -> &'static str {
        match self {
            Self::FaceTime => "facetime",
            Self::Zoom => "zoom",
            Self::Teams => "teams",
            Self::GoogleMeetSafari | Self::ZoomWebSafari => "browser_safari",
            Self::GoogleMeetChrome | Self::ZoomWebChrome => "browser_chrome",
            Self::GoogleMeetEdge | Self::ZoomWebEdge => "browser_edge",
            Self::GoogleMeetFirefox | Self::ZoomWebFirefox => "browser_firefox",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::FaceTime => "FaceTime",
            Self::Zoom => "Zoom",
            Self::Teams => "Microsoft Teams",
            Self::GoogleMeetSafari => "Google Meet (Safari)",
            Self::GoogleMeetChrome => "Google Meet (Google Chrome)",
            Self::GoogleMeetEdge => "Google Meet (Microsoft Edge)",
            Self::GoogleMeetFirefox => "Google Meet (Firefox)",
            Self::ZoomWebSafari => "Zoom (Safari)",
            Self::ZoomWebChrome => "Zoom (Google Chrome)",
            Self::ZoomWebEdge => "Zoom (Microsoft Edge)",
            Self::ZoomWebFirefox => "Zoom (Firefox)",
        }
    }

    pub fn browser_name(self) -> Option<&'static str> {
        match self {
            Self::GoogleMeetSafari | Self::ZoomWebSafari => Some("Safari"),
            Self::GoogleMeetChrome | Self::ZoomWebChrome => Some("Google Chrome"),
            Self::GoogleMeetEdge | Self::ZoomWebEdge => Some("Microsoft Edge"),
            Self::GoogleMeetFirefox | Self::ZoomWebFirefox => Some("Firefox"),
            _ => None,
        }
    }

    pub fn capture_bundle_identifier(self) -> &'static str {
        match self {
            Self::FaceTime => "com.apple.FaceTime",
            Self::Zoom => "us.zoom.xos",
            Self::Teams => "com.microsoft.teams2",
            Self::GoogleMeetSafari | Self::ZoomWebSafari => "com.apple.Safari",
            Self::GoogleMeetChrome | Self::ZoomWebChrome => "com.google.Chrome",
            Self::GoogleMeetEdge | Self::ZoomWebEdge => "com.microsoft.edgemac",
            Self::GoogleMeetFirefox | Self::ZoomWebFirefox => "org.mozilla.firefox",
        }
    }
}

pub fn installed_app_matches(provider: MeetingProvider, name: &str, path: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    let bundle_name = std::path::Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim_end_matches(".app")
        .to_ascii_lowercase();
    let values = [name.as_str(), bundle_name.as_str()];

    match provider {
        MeetingProvider::FaceTime => values.contains(&"facetime"),
        MeetingProvider::Zoom => values
            .iter()
            .any(|value| matches!(*value, "zoom" | "zoom.us" | "zoom workplace")),
        MeetingProvider::Teams => values.iter().any(|value| {
            *value == "teams" || value.starts_with("microsoft teams") || value.starts_with("teams ")
        }),
        MeetingProvider::GoogleMeetSafari
        | MeetingProvider::GoogleMeetChrome
        | MeetingProvider::GoogleMeetEdge
        | MeetingProvider::GoogleMeetFirefox
        | MeetingProvider::ZoomWebSafari
        | MeetingProvider::ZoomWebChrome
        | MeetingProvider::ZoomWebEdge
        | MeetingProvider::ZoomWebFirefox => provider.browser_name().is_some_and(|browser| {
            let browser = browser.to_ascii_lowercase();
            values.iter().any(|value| *value == browser)
        }),
    }
}

pub fn inspect_meeting_activity(browser_detection_enabled: bool) -> DetectionSample {
    let browser_sample =
        if browser_detection_enabled && crate::permissions::check_accessibility_permission() {
            crate::accessibility_context::get_active_context()
                .map(|context| {
                    classify_browser_context(
                        &context.app_name,
                        context.url.as_deref(),
                        &context.window_title,
                    )
                })
                .unwrap_or(DetectionSample::Other)
        } else {
            DetectionSample::Other
        };

    if matches!(browser_sample, DetectionSample::Active(_)) {
        return browser_sample;
    }

    match inspect_visible_windows() {
        DetectionSample::Other => browser_sample,
        native_sample => native_sample,
    }
}

fn classify_browser_context(
    app_name: &str,
    url: Option<&str>,
    window_title: &str,
) -> DetectionSample {
    let Some(google_meet_provider) = browser_provider(app_name) else {
        return DetectionSample::Other;
    };
    let Some(url) = url else {
        return DetectionSample::Other;
    };
    if is_google_meet_url(url) {
        return if has_google_meet_code(url) && !is_meeting_exit_page(window_title) {
            DetectionSample::Active(google_meet_provider)
        } else {
            DetectionSample::Idle(google_meet_provider)
        };
    }

    if is_zoom_web_url(url) {
        let zoom_provider = zoom_web_provider(google_meet_provider);
        return if has_zoom_web_meeting(url) && !is_meeting_exit_page(window_title) {
            DetectionSample::Active(zoom_provider)
        } else {
            DetectionSample::Idle(zoom_provider)
        };
    }

    DetectionSample::Other
}

fn browser_provider(app_name: &str) -> Option<MeetingProvider> {
    let app = app_name
        .trim()
        .trim_end_matches(".app")
        .to_ascii_lowercase();
    match app.as_str() {
        "safari" => Some(MeetingProvider::GoogleMeetSafari),
        "google chrome" | "chrome" => Some(MeetingProvider::GoogleMeetChrome),
        "microsoft edge" | "edge" => Some(MeetingProvider::GoogleMeetEdge),
        "firefox" => Some(MeetingProvider::GoogleMeetFirefox),
        _ => None,
    }
}

fn zoom_web_provider(browser_provider: MeetingProvider) -> MeetingProvider {
    match browser_provider {
        MeetingProvider::GoogleMeetSafari => MeetingProvider::ZoomWebSafari,
        MeetingProvider::GoogleMeetChrome => MeetingProvider::ZoomWebChrome,
        MeetingProvider::GoogleMeetEdge => MeetingProvider::ZoomWebEdge,
        MeetingProvider::GoogleMeetFirefox => MeetingProvider::ZoomWebFirefox,
        _ => unreachable!("browser_provider only returns browser variants"),
    }
}

fn google_meet_path(url: &str) -> Option<&str> {
    let without_scheme = url
        .trim()
        .strip_prefix("https://")
        .or_else(|| url.trim().strip_prefix("http://"))?;
    let (host, rest) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let host = host.split(':').next().unwrap_or(host);
    if !host.eq_ignore_ascii_case("meet.google.com") {
        return None;
    }
    Some(rest.split(['?', '#']).next().unwrap_or_default())
}

fn is_google_meet_url(url: &str) -> bool {
    google_meet_path(url).is_some()
}

fn has_google_meet_code(url: &str) -> bool {
    let Some(path) = google_meet_path(url) else {
        return false;
    };
    let code = path.trim_matches('/').split('/').next().unwrap_or_default();
    let groups: Vec<&str> = code.split('-').collect();
    groups.len() == 3
        && groups[0].len() == 3
        && groups[1].len() == 4
        && groups[2].len() == 3
        && groups
            .iter()
            .all(|group| group.bytes().all(|byte| byte.is_ascii_lowercase()))
}

fn zoom_web_path(url: &str) -> Option<&str> {
    let without_scheme = url
        .trim()
        .strip_prefix("https://")
        .or_else(|| url.trim().strip_prefix("http://"))?;
    let (host, rest) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let host = host.split(':').next().unwrap_or(host);
    if !host.eq_ignore_ascii_case("app.zoom.us") {
        return None;
    }
    Some(rest.split(['?', '#']).next().unwrap_or_default())
}

fn is_zoom_web_url(url: &str) -> bool {
    zoom_web_path(url).is_some()
}

fn has_zoom_web_meeting(url: &str) -> bool {
    let Some(path) = zoom_web_path(url) else {
        return false;
    };
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    let meeting_id = match segments.as_slice() {
        ["wc", meeting_id, "join"] | ["wc", "join", meeting_id] => *meeting_id,
        _ => return false,
    };
    meeting_id.len() >= 9 && meeting_id.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_meeting_exit_page(window_title: &str) -> bool {
    let title = window_title.trim().to_ascii_lowercase();
    [
        "you left the meeting",
        "has salido de la reunión",
        "vous avez quitté la réunion",
        "sie haben die besprechung verlassen",
        "hai abbandonato la riunione",
        "u heeft de vergadering verlaten",
        "meeting has been ended",
        "the meeting has ended",
        "reunión finalizada",
        "la reunión ha finalizado",
        "la réunion est terminée",
        "die besprechung wurde beendet",
        "la riunione è terminata",
        "de vergadering is beëindigd",
    ]
    .iter()
    .any(|candidate| title.contains(candidate))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectionSample {
    Active(MeetingProvider),
    Idle(MeetingProvider),
    Other,
}

pub fn inspect_visible_windows() -> DetectionSample {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        kCGWindowName, kCGWindowOwnerName,
    };

    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let Some(windows) = core_graphics::window::copy_window_info(options, kCGNullWindowID) else {
        return DetectionSample::Other;
    };
    let mut idle_provider = None;

    for raw_window in windows.iter() {
        let dictionary = unsafe {
            CFDictionary::<*const std::ffi::c_void, *const std::ffi::c_void>::wrap_under_get_rule(
                *raw_window as CFDictionaryRef,
            )
        };
        let Some(owner) = dictionary.find(unsafe { kCGWindowOwnerName } as *const _) else {
            continue;
        };
        let owner = unsafe { CFString::wrap_under_get_rule(*owner as CFStringRef) }.to_string();
        let title = dictionary
            .find(unsafe { kCGWindowName } as *const _)
            .map(|value| {
                unsafe { CFString::wrap_under_get_rule(*value as CFStringRef) }.to_string()
            })
            .unwrap_or_default();

        match classify_window(&owner, &title) {
            active @ DetectionSample::Active(_) => return active,
            DetectionSample::Idle(provider) => idle_provider = Some(provider),
            DetectionSample::Other => {}
        }
    }

    idle_provider
        .map(DetectionSample::Idle)
        .unwrap_or(DetectionSample::Other)
}

fn classify_window(app_name: &str, window_title: &str) -> DetectionSample {
    let app = app_name.trim().to_lowercase();
    let title = window_title.trim().to_lowercase();

    if app == "facetime" {
        // FaceTime's in-call window uses the participant name as its title;
        // the idle window keeps the application name.
        return if !title.is_empty() && title != "facetime" {
            DetectionSample::Active(MeetingProvider::FaceTime)
        } else {
            DetectionSample::Idle(MeetingProvider::FaceTime)
        };
    }

    if app == "zoom.us" || app == "zoom" || app.contains("zoom workplace") {
        return if contains_any(
            &title,
            &[
                "zoom meeting",
                "zoom webinar",
                "reunión de zoom",
                "seminario web de zoom",
                "réunion zoom",
                "zoom-konferenz",
                "riunione zoom",
            ],
        ) {
            DetectionSample::Active(MeetingProvider::Zoom)
        } else {
            DetectionSample::Idle(MeetingProvider::Zoom)
        };
    }

    if app == "teams" || app.contains("microsoft teams") {
        return if contains_any(
            &title,
            &[
                "meeting",
                "reunión",
                "réunion",
                "besprechung",
                "riunione",
                "vergadering",
                "call",
                "llamada",
                "appel",
                "anruf",
                "chiamata",
                "gesprek",
            ],
        ) {
            DetectionSample::Active(MeetingProvider::Teams)
        } else {
            DetectionSample::Idle(MeetingProvider::Teams)
        };
    }

    DetectionSample::Other
}

fn contains_any(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| value.contains(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_call_windows_without_treating_app_home_as_a_call() {
        assert_eq!(
            classify_window("zoom.us", "Design review - Zoom Meeting"),
            DetectionSample::Active(MeetingProvider::Zoom)
        );
        assert_eq!(
            classify_window("zoom.us", "Zoom Workplace"),
            DetectionSample::Idle(MeetingProvider::Zoom)
        );
        assert_eq!(
            classify_window("Microsoft Teams", "Weekly meeting | Microsoft Teams"),
            DetectionSample::Active(MeetingProvider::Teams)
        );
        assert_eq!(
            classify_window("Microsoft Teams", "Chat | Microsoft Teams"),
            DetectionSample::Idle(MeetingProvider::Teams)
        );
        assert_eq!(
            classify_window("FaceTime", "FaceTime"),
            DetectionSample::Idle(MeetingProvider::FaceTime)
        );
        assert_eq!(
            classify_window("FaceTime", "Example Participant"),
            DetectionSample::Active(MeetingProvider::FaceTime)
        );
    }

    #[test]
    fn matches_supported_installed_app_names_without_matching_helpers() {
        assert!(installed_app_matches(
            MeetingProvider::Zoom,
            "zoom.us",
            "/Applications/zoom.us.app"
        ));
        assert!(installed_app_matches(
            MeetingProvider::Teams,
            "Microsoft Teams (work or school)",
            "/Applications/Microsoft Teams.app"
        ));
        assert!(!installed_app_matches(
            MeetingProvider::Zoom,
            "Zoom Outlook Plugin",
            "/Applications/Zoom Outlook Plugin.app"
        ));
        assert!(installed_app_matches(
            MeetingProvider::GoogleMeetSafari,
            "Safari",
            "/System/Applications/Safari.app"
        ));
        assert!(installed_app_matches(
            MeetingProvider::GoogleMeetChrome,
            "Google Chrome",
            "/Applications/Google Chrome.app"
        ));
    }

    #[test]
    fn detects_a_valid_google_meet_code_but_not_the_home_page() {
        assert_eq!(
            classify_browser_context(
                "Safari",
                Some("https://meet.google.com/abc-defg-hij"),
                "Meet - abc-defg-hij"
            ),
            DetectionSample::Active(MeetingProvider::GoogleMeetSafari)
        );
        assert_eq!(
            classify_browser_context(
                "Safari",
                Some("https://meet.google.com/home"),
                "Google Meet"
            ),
            DetectionSample::Idle(MeetingProvider::GoogleMeetSafari)
        );
        assert_eq!(
            classify_browser_context(
                "Google Chrome",
                Some("https://calendar.google.com/calendar/u/0/r"),
                "Google Calendar"
            ),
            DetectionSample::Other
        );
    }

    #[test]
    fn detects_the_zoom_web_client_in_each_supported_browser() {
        let url = "https://app.zoom.us/wc/12345678901/join?ref_from=launch";
        assert_eq!(
            classify_browser_context("Safari", Some(url), "Reunión de Zoom de ejemplo"),
            DetectionSample::Active(MeetingProvider::ZoomWebSafari)
        );
        assert_eq!(
            classify_browser_context("Google Chrome", Some(url), "Zoom Meeting"),
            DetectionSample::Active(MeetingProvider::ZoomWebChrome)
        );
        assert_eq!(
            classify_browser_context(
                "Firefox",
                Some("https://app.zoom.us/"),
                "Zoom Video Communications"
            ),
            DetectionSample::Idle(MeetingProvider::ZoomWebFirefox)
        );
        assert_eq!(
            MeetingProvider::ZoomWebSafari.setting_id(),
            MeetingProvider::GoogleMeetSafari.setting_id()
        );
    }

    #[test]
    fn ignores_google_meet_after_the_call_has_ended() {
        assert_eq!(
            classify_browser_context(
                "Microsoft Edge",
                Some("https://meet.google.com/abc-defg-hij"),
                "Has salido de la reunión"
            ),
            DetectionSample::Idle(MeetingProvider::GoogleMeetEdge)
        );
    }
}
