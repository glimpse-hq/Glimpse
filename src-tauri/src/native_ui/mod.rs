//! The pill and toasts, drawn with wgpu in windows of our own instead of webviews. The webview
//! pill and toast take over when the GPU can't be used.

mod a11y;
mod gpu;
pub mod pill;
pub mod toast;
pub mod window;

use std::time::{Duration, Instant};

// 60 fps like the webview's requestAnimationFrame; every vsync on a 120 Hz display costs twice the CPU.
const FRAME: Duration = Duration::from_micros(16_667);

/// Waits out the rest of the frame since `last`, then marks the new frame's start.
fn pace(last: &mut Option<Instant>) {
    if let Some(wait) = last.map(|at| FRAME.saturating_sub(at.elapsed())) {
        std::thread::sleep(wait);
    }
    *last = Some(Instant::now());
}
