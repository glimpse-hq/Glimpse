pub mod audio_devices;
pub mod icons;
pub mod live;
pub mod menu;
pub mod overlay;
pub mod toast;

pub fn major_version() -> u32 {
    static MAJOR: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *MAJOR.get_or_init(|| {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|version| version.trim().split('.').next()?.parse().ok())
            .unwrap_or(0)
    })
}

// ggml-metal's static destructor asserts that every Metal buffer was freed,
// which aborts the quit when a model is still in use. atexit hooks run in
// reverse order, so one registered at quit runs before that destructor, after
// Tauri's exit work and update relaunch.
pub fn skip_static_destructors() {
    unsafe extern "C" {
        fn atexit(callback: extern "C" fn()) -> i32;
        fn _exit(status: i32) -> !;
    }
    extern "C" fn exit_now() {
        unsafe { _exit(0) }
    }
    unsafe { atexit(exit_now) };
}
