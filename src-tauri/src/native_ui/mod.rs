//! The pill and toasts, drawn with wgpu in a window of our own.

mod a11y;
mod gpu;
pub mod overlay;
pub mod pill;
mod spring;
mod text;
pub mod toast;
pub mod window;

use std::time::{Duration, Instant};

/// How soon a part of the overlay needs its next frame.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Pace {
    Still,
    /// Only slow loops, like the error dot's pulse.
    Ambient,
    Moving,
}

impl Pace {
    // Moving at 60 fps; every vsync on a 120 Hz display costs twice the CPU.
    fn frame(self) -> Duration {
        match self {
            Pace::Moving => Duration::from_micros(16_667),
            _ => Duration::from_micros(33_333),
        }
    }
}

/// Waits out the rest of the frame since `last`, then marks the new frame's start.
fn pace(last: &mut Option<Instant>, pace: Pace) {
    if let Some(wait) = last.map(|at| pace.frame().saturating_sub(at.elapsed())) {
        std::thread::sleep(wait);
    }
    *last = Some(Instant::now());
}
