pub mod audio_devices;
pub mod icons;
pub mod live;
pub mod meeting_capture;
pub mod meeting_detection;
pub mod menu;
pub mod overlay;
pub mod toast;

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
