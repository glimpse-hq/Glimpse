#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PauseSession(u64);

pub(crate) fn pause_if_playing() -> Option<PauseSession> {
    imp::pause_if_playing()
}

pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
    imp::resume_if_paused_by_us(session);
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod coord {
    use super::PauseSession;
    use parking_lot::Mutex;
    use tauri::async_runtime;

    struct MediaState<T> {
        next_session: u64,
        active_session: Option<PauseSession>,
        paused_target: Option<T>,
    }

    pub(super) type CancelFn<'a> = &'a dyn Fn() -> bool;

    pub(super) struct Coordinator<T: Send + 'static> {
        state: Mutex<MediaState<T>>,
        pause_fn: fn() -> Option<T>,
        resume_fn: fn(&T, CancelFn<'_>) -> bool,
    }

    impl<T: Send + 'static> Coordinator<T> {
        pub(super) const fn new(
            pause_fn: fn() -> Option<T>,
            resume_fn: fn(&T, CancelFn<'_>) -> bool,
        ) -> Self {
            Self {
                state: Mutex::new(MediaState {
                    next_session: 0,
                    active_session: None,
                    paused_target: None,
                }),
                pause_fn,
                resume_fn,
            }
        }

        pub(super) fn pause_if_playing(&'static self) -> PauseSession {
            let session = {
                let mut shared = self.state.lock();
                shared.next_session = shared.next_session.wrapping_add(1);
                if shared.next_session == 0 {
                    shared.next_session = 1;
                }
                let session = PauseSession(shared.next_session);
                shared.active_session = Some(session);
                session
            };

            std::mem::drop(async_runtime::spawn_blocking(move || {
                let pause_fn = self.pause_fn;
                let target = pause_fn();
                self.finish_pause(session, target);
            }));

            session
        }

        pub(super) fn resume_if_paused_by_us(&'static self, session: PauseSession) {
            let target = {
                let mut shared = self.state.lock();
                if shared.active_session != Some(session) {
                    return;
                }
                shared.active_session = None;
                shared.paused_target.take()
            };

            if let Some(target) = target {
                std::mem::drop(async_runtime::spawn_blocking(move || {
                    self.resume_or_keep(target)
                }));
            }
        }

        fn finish_pause(&'static self, session: PauseSession, target: Option<T>) {
            let target_to_resume = {
                let mut shared = self.state.lock();
                match (shared.active_session, target) {
                    // Original session still active: store our pause result.
                    (Some(active), Some(t)) if active == session => {
                        shared.paused_target = Some(t);
                        None
                    }
                    // Newer session preempted us: carry late pause forward without overwriting.
                    (Some(_), Some(t)) => {
                        shared.paused_target.get_or_insert(t);
                        None
                    }
                    (Some(_), None) => None,
                    // No active session: resume immediately if we have a target.
                    (None, target) => target,
                }
            };

            if let Some(target) = target_to_resume {
                self.resume_or_keep(target);
            }
        }

        fn resume_or_keep(&'static self, target: T) {
            {
                let mut shared = self.state.lock();
                if shared.active_session.is_some() {
                    shared.paused_target.get_or_insert(target);
                    return;
                }
            }

            let played = (self.resume_fn)(&target, &|| self.state.lock().active_session.is_some());

            if !played {
                let mut shared = self.state.lock();
                if shared.active_session.is_some() {
                    shared.paused_target.get_or_insert(target);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::coord::{CancelFn, Coordinator};
    use super::PauseSession;
    use serde::Deserialize;
    use std::process::Command;

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

        return {
            bundleId: unwrapString(client.bundleIdentifier),
            displayName: unwrapString(client.displayName),
            rate: playbackRate(info)
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
            if (!identity || (!identity.bundleId && !identity.displayName) || identity.rate <= 0) {
                return "";
            }

            if (!$.MRMediaRemoteSendCommand(1, $.NSDictionary.alloc.init)) {
                return "";
            }

            return JSON.stringify({
                bundleId: identity.bundleId,
                displayName: identity.displayName
            });
        }

        const expectedBundleId = argv.length > 1 ? String(argv[1]) : "";
        const expectedName = argv.length > 2 ? String(argv[2]) : "";
        const identity = nowPlayingIdentity();

        if (!identity || !targetMatches(expectedBundleId, expectedName, identity.bundleId, identity.displayName)) {
            return "skip";
        }

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
    pub(super) struct PausedTarget {
        bundle_id: String,
        display_name: String,
    }

    impl PausedTarget {
        fn from_json(stdout: &str) -> Option<Self> {
            let payload: PausePayload = serde_json::from_str(stdout).ok()?;
            let bundle_id = payload.bundle_id.trim().to_string();
            let display_name = payload.display_name.trim().to_string();
            if bundle_id.is_empty() && display_name.is_empty() {
                return None;
            }

            Some(Self {
                bundle_id,
                display_name,
            })
        }
    }

    static COORD: Coordinator<PausedTarget> = Coordinator::new(pause_now_playing, resume_target);

    pub(crate) fn pause_if_playing() -> Option<PauseSession> {
        Some(COORD.pause_if_playing())
    }

    pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
        if let Some(session) = session {
            COORD.resume_if_paused_by_us(session);
        }
    }

    fn pause_now_playing() -> Option<PausedTarget> {
        let stdout = run_script(&["pause"], &|| false)?;
        PausedTarget::from_json(&stdout)
    }

    fn resume_target(target: &PausedTarget, should_cancel: CancelFn<'_>) -> bool {
        run_script(
            &["resume", &target.bundle_id, &target.display_name],
            should_cancel,
        )
        .as_deref()
        .is_some_and(|result| result == "played")
    }

    fn run_script(args: &[&str], should_cancel: CancelFn<'_>) -> Option<String> {
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
            if should_cancel() {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }

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
                    std::thread::sleep(Duration::from_millis(10));
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
    use super::coord::{CancelFn, Coordinator};
    use super::PauseSession;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Win32::System::Com::{
        CoDecrementMTAUsage, CoIncrementMTAUsage, CO_MTA_USAGE_COOKIE,
    };

    static COORD: Coordinator<String> = Coordinator::new(pause_now_playing, resume_target);

    pub(crate) fn pause_if_playing() -> Option<PauseSession> {
        Some(COORD.pause_if_playing())
    }

    pub(crate) fn resume_if_paused_by_us(session: Option<PauseSession>) {
        if let Some(session) = session {
            COORD.resume_if_paused_by_us(session);
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

    fn pause_now_playing() -> Option<String> {
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

    fn resume_target(expected_app_id: &String, _should_cancel: CancelFn<'_>) -> bool {
        with_current_session(|session| {
            let app_id = match session.SourceAppUserModelId() {
                Ok(value) => value.to_string_lossy(),
                Err(_) => return Some(false),
            };
            if app_id != *expected_app_id {
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
