#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PauseSession(u64);

pub(crate) fn pause_if_playing() -> Option<PauseSession> {
    imp::pause_if_playing()
}

pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
    imp::resume_if_paused_by_us(session);
}

#[cfg(target_os = "macos")]
mod imp {
    use super::PauseSession;
    use parking_lot::Mutex;
    use serde::Deserialize;
    use std::process::Command;
    use std::sync::OnceLock;
    use tauri::async_runtime;

    const MEDIA_REMOTE_SCRIPT: &str = r#"
ObjC.import('Foundation');

function unwrapString(value) {
    if (value === null || value === undefined) return "";
    try {
        const unwrapped = ObjC.unwrap(value);
        if (unwrapped === null || unwrapped === undefined) return "";
        return String(unwrapped);
    } catch (error) {
        return "";
    }
}

function playbackRate(infoDict) {
    if (!infoDict) return 0;
    const rateObj = infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoPlaybackRate');
    if (!rateObj) return 0;
    try {
        const rate = Number(ObjC.unwrap(rateObj));
        return Number.isFinite(rate) ? rate : 0;
    } catch (error) {
        return 0;
    }
}

function loadMediaRemote() {
    const mediaRemote = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/');
    if (!mediaRemote) return false;
    const loader = mediaRemote.load;
    if (typeof loader === 'function') {
        if (!loader.call(mediaRemote)) return false;
    } else if (!loader) {
        return false;
    }
    ObjC.bindFunction('MRMediaRemoteSendCommand', ['bool', ['int', 'id']]);
    return true;
}

function nowPlayingIdentity() {
    try {
        const MRNowPlayingRequest = $.NSClassFromString('MRNowPlayingRequest');
        if (!MRNowPlayingRequest) return null;

        const playerPath = MRNowPlayingRequest.localNowPlayingPlayerPath;
        if (!playerPath) return null;
        const client = playerPath.client;
        if (!client) return null;

        const nowPlayingItem = MRNowPlayingRequest.localNowPlayingItem;
        const info = nowPlayingItem ? nowPlayingItem.nowPlayingInfo : null;
        const rate = playbackRate(info);

        return {
            bundleId: unwrapString(client.bundleIdentifier),
            displayName: unwrapString(client.displayName),
            rate: rate
        };
    } catch (error) {
        return null;
    }
}

function targetMatches(expectedBundleId, expectedName, currentBundleId, currentName) {
    if (expectedBundleId && currentBundleId) return expectedBundleId === currentBundleId;
    if (expectedName && currentName) return expectedName === currentName;
    return false;
}

function run(argv) {
    const action = argv.length > 0 ? String(argv[0]) : "";
    if (action !== "pause" && action !== "resume") return "";

    try {
        if (!loadMediaRemote()) return "";

        if (action === "pause") {
            const identity = nowPlayingIdentity();
            if (identity && identity.rate <= 0) return "";

            // MRMediaRemoteCommand: 1 = Pause
            const sent = $.MRMediaRemoteSendCommand(1, $.NSDictionary.alloc.init);
            if (!sent && !identity) return "";

            return JSON.stringify({
                bundleId: identity ? identity.bundleId : "",
                displayName: identity ? identity.displayName : ""
            });
        }

        // Resume: check if the same app is still the now-playing target
        const expectedBundleId = argv.length > 1 ? String(argv[1]) : "";
        const expectedName = argv.length > 2 ? String(argv[2]) : "";
        const identity = nowPlayingIdentity();

        if (expectedBundleId || expectedName) {
            if (identity && !targetMatches(expectedBundleId, expectedName, identity.bundleId, identity.displayName)) {
                return "skip";
            }
            if (identity && identity.rate > 0) return "skip";
        }

        // MRMediaRemoteCommand: 0 = Play
        $.MRMediaRemoteSendCommand(0, $.NSDictionary.alloc.init);
        return "played";
    } catch (error) {
        return "";
    }
}
"#;

    #[derive(Default, Clone, Deserialize)]
    struct PausePayload {
        #[serde(default, rename = "bundleId")]
        bundle_id: String,
        #[serde(default, rename = "displayName")]
        display_name: String,
    }

    #[derive(Default, Clone)]
    struct PausedTarget {
        bundle_id: Option<String>,
        display_name: Option<String>,
    }

    impl PausedTarget {
        fn from_json(stdout: &str) -> Option<Self> {
            let payload: PausePayload = serde_json::from_str(stdout).ok()?;
            let bundle_id = (!payload.bundle_id.trim().is_empty()).then_some(payload.bundle_id);
            let display_name =
                (!payload.display_name.trim().is_empty()).then_some(payload.display_name);

            Some(Self {
                bundle_id,
                display_name,
            })
        }
    }

    #[derive(Default)]
    struct MediaState {
        next_session: u64,
        active_session: Option<PauseSession>,
        paused_target: Option<PausedTarget>,
    }

    impl MediaState {
        fn alloc_session(&mut self) -> PauseSession {
            self.next_session = self.next_session.wrapping_add(1);
            if self.next_session == 0 {
                self.next_session = 1;
            }
            PauseSession(self.next_session)
        }
    }

    fn state() -> &'static Mutex<MediaState> {
        static STATE: OnceLock<Mutex<MediaState>> = OnceLock::new();
        STATE.get_or_init(|| Mutex::new(MediaState::default()))
    }

    pub(crate) fn pause_if_playing() -> Option<PauseSession> {
        let session = {
            let mut shared = state().lock();
            let session = shared.alloc_session();
            shared.active_session = Some(session);
            shared.paused_target = None;
            session
        };

        let _ = async_runtime::spawn_blocking(move || {
            let target = pause_active_now_playing();
            finish_pause_attempt(session, target);
        });

        Some(session)
    }

    pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
        let Some(session) = session else {
            return;
        };

        let target = {
            let mut shared = state().lock();
            if shared.active_session != Some(session) {
                return;
            }
            shared.active_session = None;
            shared.paused_target.take()
        };

        if let Some(target) = target {
            let _ = async_runtime::spawn_blocking(move || {
                let _ = resume_if_matching_target(&target);
            });
        }
    }

    fn finish_pause_attempt(session: PauseSession, target: Option<PausedTarget>) {
        let target_to_resume = {
            let mut shared = state().lock();

            if shared.active_session != Some(session) {
                target
            } else {
                match target {
                    Some(target) => {
                        shared.paused_target = Some(target);
                        None
                    }
                    None => {
                        shared.active_session = None;
                        None
                    }
                }
            }
        };

        if let Some(target) = target_to_resume {
            let _ = resume_if_matching_target(&target);
        }
    }

    fn pause_active_now_playing() -> Option<PausedTarget> {
        let stdout = run_script(&["pause"])?;
        PausedTarget::from_json(&stdout)
    }

    fn resume_if_matching_target(target: &PausedTarget) -> bool {
        let bundle_id = target.bundle_id.as_deref().unwrap_or("");
        let display_name = target.display_name.as_deref().unwrap_or("");

        run_script(&["resume", bundle_id, display_name])
            .as_deref()
            .is_some_and(|result| result == "played")
    }

    /// Blocks until the `osascript` child process exits.
    /// Keep `run_script` on a blocking worker thread and out of latency-sensitive paths.
    fn run_script(args: &[&str]) -> Option<String> {
        use std::io::Read;
        use std::time::{Duration, Instant};

        let mut command = Command::new("osascript");
        command
            .args(["-l", "JavaScript", "-e", MEDIA_REMOTE_SCRIPT])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        for arg in args {
            command.arg(arg);
        }

        let mut child = command.spawn().ok()?;
        let deadline = Instant::now() + Duration::from_secs(3);

        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return None;
                    }
                    let mut stdout = String::new();
                    child.stdout.take()?.read_to_string(&mut stdout).ok()?;
                    let stdout = stdout.trim().to_string();
                    if stdout.is_empty() {
                        return None;
                    }
                    return Some(stdout);
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => {
                    let _ = child.kill();
                    return None;
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::PauseSession;
    use parking_lot::Mutex;
    use std::sync::OnceLock;
    use tauri::async_runtime;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Win32::System::Com::{
        CoDecrementMTAUsage, CoIncrementMTAUsage, CO_MTA_USAGE_COOKIE,
    };

    #[derive(Default)]
    struct MediaState {
        next_session: u64,
        active_session: Option<PauseSession>,
        paused_target: Option<String>,
    }

    impl MediaState {
        fn alloc_session(&mut self) -> PauseSession {
            self.next_session = self.next_session.wrapping_add(1);
            if self.next_session == 0 {
                self.next_session = 1;
            }
            PauseSession(self.next_session)
        }
    }

    fn state() -> &'static Mutex<MediaState> {
        static STATE: OnceLock<Mutex<MediaState>> = OnceLock::new();
        STATE.get_or_init(|| Mutex::new(MediaState::default()))
    }

    pub(crate) fn pause_if_playing() -> Option<PauseSession> {
        let session = {
            let mut shared = state().lock();
            let session = shared.alloc_session();
            shared.active_session = Some(session);
            shared.paused_target = None;
            session
        };

        let _ = async_runtime::spawn_blocking(move || {
            let target = pause_active_now_playing();
            finish_pause_attempt(session, target);
        });

        Some(session)
    }

    pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
        let Some(session) = session else {
            return;
        };

        let target = {
            let mut shared = state().lock();
            if shared.active_session != Some(session) {
                return;
            }
            shared.active_session = None;
            shared.paused_target.take()
        };

        if let Some(target) = target {
            let _ = async_runtime::spawn_blocking(move || {
                let _ = resume_if_matching_target(&target);
            });
        }
    }

    fn finish_pause_attempt(session: PauseSession, target: Option<String>) {
        let target_to_resume = {
            let mut shared = state().lock();

            if shared.active_session != Some(session) {
                target
            } else {
                match target {
                    Some(target) => {
                        shared.paused_target = Some(target);
                        None
                    }
                    None => {
                        shared.active_session = None;
                        None
                    }
                }
            }
        };

        if let Some(target) = target_to_resume {
            let _ = resume_if_matching_target(&target);
        }
    }

    fn with_current_session<T>(
        action: impl FnOnce(&GlobalSystemMediaTransportControlsSession) -> Option<T>,
    ) -> Option<T> {
        let _mta_usage = MtaUsage::new()?;
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .ok()?
            .join()
            .ok()?;
        let session = manager.GetCurrentSession().ok()?;
        action(&session)
    }

    struct MtaUsage(CO_MTA_USAGE_COOKIE);

    impl MtaUsage {
        fn new() -> Option<Self> {
            unsafe { CoIncrementMTAUsage().ok().map(Self) }
        }
    }

    impl Drop for MtaUsage {
        fn drop(&mut self) {
            let _ = unsafe { CoDecrementMTAUsage(self.0) };
        }
    }

    fn pause_active_now_playing() -> Option<String> {
        with_current_session(|session| {
            let playback = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
            if playback != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                return None;
            }

            let app_id = session.SourceAppUserModelId().ok()?.to_string_lossy();
            if session.TryPauseAsync().ok()?.join().ok()? {
                Some(app_id)
            } else {
                None
            }
        })
    }

    fn resume_if_matching_target(expected_app_id: &str) -> bool {
        with_current_session(|session| {
            let app_id = match session.SourceAppUserModelId() {
                Ok(value) => value.to_string_lossy(),
                Err(_) => return Some(false),
            };
            if app_id != expected_app_id {
                return Some(false);
            }

            let playback = match session
                .GetPlaybackInfo()
                .and_then(|info| info.PlaybackStatus())
            {
                Ok(status) => status,
                Err(_) => return Some(false),
            };
            if playback == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                return Some(false);
            }

            Some(
                session
                    .TryPlayAsync()
                    .and_then(|operation| operation.join())
                    .unwrap_or(false),
            )
        })
        .unwrap_or(false)
    }
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
mod imp {
    use super::PauseSession;

    pub(crate) fn pause_if_playing() -> Option<PauseSession> {
        None
    }

    pub(crate) fn resume_if_paused_by_us(_session: Option<PauseSession>) {}
}
