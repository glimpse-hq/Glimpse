use super::super::spring::Spring;
use crate::pill::PillStatus;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const COLS: usize = 30;
const CENTER_COL: usize = COLS / 2;
const PREROLL_DOT_LEVEL: f32 = 0.45;
const DOT_SETTLE: f32 = 0.12;
const WAVE_ONSET: f32 = 0.22;
const WAVE_ATTACK: f32 = 0.35;
const WAVE_RELEASE: f32 = 0.15;
const SENSITIVITY: f32 = 3.0;
const WAVE_HANDOFF: f32 = 0.36;
const POP_ONSET: f32 = 0.7;
const POP_TEMPO: f32 = 1.6;
const CLEANUP_FADE_IN: f32 = 0.9;
const ERROR_FLASH: Duration = Duration::from_millis(1200);
const SHAKE: f32 = 0.4;
const WARM_ENTRY: Duration = Duration::from_secs(5);
const SPECTRUM_FRESH: Duration = Duration::from_millis(250);
const AUDIO_TICK: f32 = 1.0 / 60.0;
const HOVER_SCALE: f32 = 0.86;
const HOVER_OPACITY: f32 = 0.55;
pub const COLLAPSED: [f32; 3] = [92.0, 26.0, 13.0];
const EXPANDED: [f32; 3] = [260.0, 90.0, 24.0];
// About 0.4 s to settle, and continuous when interrupted.
const RESHAPE: (f32, f32, f32) = (260.0, 32.0, 1.0);
const DOTS_FADE: f32 = 0.22 / 3.0;
const TEXT_FADE: f32 = 0.24 / 3.0;
const TEXT_DELAY: f32 = 0.1;

/// What the rest of the app last told the pill.
#[derive(Clone)]
pub struct Input {
    pub status: PillStatus,
    pub cleanup: bool,
    pub bins: Vec<u8>,
    pub bins_at: Option<Instant>,
    pub hovering: bool,
    /// Showing text instead of dots: the live transcript or an action's message.
    pub expanded: bool,
    pub text: Arc<str>,
    /// Counts status changes, so each one reaches a screen reader as new.
    pub changes: u64,
}

impl Default for Input {
    fn default() -> Self {
        Self {
            status: PillStatus::Idle,
            cleanup: false,
            bins: Vec::new(),
            bins_at: None,
            hovering: false,
            expanded: false,
            text: Arc::from(""),
            changes: 0,
        }
    }
}

/// One frame of drawing state, in the units the shader reads.
pub struct Frame {
    pub scale: [f32; 2],
    pub offset: [f32; 2],
    pub opacity: f32,
    pub base_level: f32,
    pub wave_fade: f32,
    pub pop_t: f32,
    pub pop_gain: f32,
    pub cleanup_gain: f32,
    pub seed: f32,
    /// 0 dots, 1 error flash, 2 error icon.
    pub mode: f32,
    pub flash: f32,
    pub heights: [f32; COLS],
    /// Width, height and corner radius in points, before `scale`.
    pub shell: [f32; 3],
    pub dots_alpha: f32,
    pub text_alpha: f32,
}

const COLD_ENTRY: (f32, f32, f32) = (760.0, 32.0, 0.36);
const WARM_ENTRY_SPRING: (f32, f32, f32) = (680.0, 36.0, 0.32);
const EXIT: (f32, f32, f32) = (820.0, 34.0, 0.34);
// a 0.16 s ease-out, as a critically damped spring
const HOVER_IN: (f32, f32, f32) = (600.0, 49.0, 1.0);
const HOVER_OUT: (f32, f32, f32) = (460.0, 12.0, 0.55);

fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

pub struct Anim {
    status: PillStatus,
    since: Instant,
    has_shown: bool,
    last_idle: Option<Instant>,
    hovered: bool,
    sx: Spring,
    sy: Spring,
    y: Spring,
    opacity: f32,
    opacity_target: f32,
    opacity_tau: f32,
    heights: [f32; COLS],
    reference: f32,
    audio_frames: u32,
    onset: Option<Instant>,
    audio_debt: f32,
    seed: f32,
    cleanup_since: Option<Instant>,
    error_at: Option<Instant>,
    shell: [Spring; 3],
    expanded_since: Option<Instant>,
    dots_alpha: f32,
    text_alpha: f32,
}

impl Anim {
    pub fn new() -> Self {
        let now = Instant::now();
        Self {
            status: PillStatus::Idle,
            since: now,
            has_shown: false,
            last_idle: None,
            hovered: false,
            sx: Spring::at(1.0),
            sy: Spring::at(1.0),
            y: Spring::at(0.0),
            opacity: 0.0,
            opacity_target: 0.0,
            opacity_tau: 0.04,
            heights: [0.0; COLS],
            reference: 0.0,
            audio_frames: 0,
            onset: None,
            audio_debt: 0.0,
            seed: 0.0,
            cleanup_since: None,
            error_at: None,
            shell: COLLAPSED.map(Spring::at),
            expanded_since: None,
            dots_alpha: 1.0,
            text_alpha: 0.0,
        }
    }

    /// True while anything still moves. A faded idle pill and a settled error pill need no frames.
    pub fn animating(&self, input: &Input) -> bool {
        let hover_changes = input.hovering != self.hovered && self.status != PillStatus::Idle;
        if input.status != self.status || hover_changes {
            return true;
        }
        // The fades aim at 0 or 1.
        let at_rest = (self.opacity - self.opacity_target).abs() < 1e-3
            && [self.sx, self.sy, self.y].iter().all(Spring::settled)
            && self.shell.iter().all(Spring::settled)
            && [self.dots_alpha, self.text_alpha]
                .iter()
                .all(|a| (a - a.round()).abs() < 1e-3);
        match self.status {
            PillStatus::Idle => !at_rest,
            PillStatus::Error => {
                !at_rest || self.error_at.is_some_and(|at| at.elapsed() < ERROR_FLASH)
            }
            PillStatus::Listening | PillStatus::Processing => true,
        }
    }

    /// Takes in state changes; also called while the window is hidden, so none are missed.
    pub fn observe(&mut self, input: &Input, now: Instant) {
        self.apply_status(input.status, now);
        match (input.cleanup, self.cleanup_since) {
            (true, None) => self.cleanup_since = Some(now),
            (false, Some(_)) => self.cleanup_since = None,
            _ => {}
        }
        if input.expanded != self.expanded_since.is_some() {
            self.expanded_since = input.expanded.then_some(now);
            let target = if input.expanded { EXPANDED } else { COLLAPSED };
            for (s, t) in self.shell.iter_mut().zip(target) {
                s.aim(t, RESHAPE);
            }
        }
    }

    pub fn step(&mut self, input: &Input, now: Instant, dt: f32) -> Frame {
        self.observe(input, now);
        self.apply_hover(input.hovering && self.status != PillStatus::Idle);

        for s in [&mut self.sx, &mut self.sy, &mut self.y]
            .into_iter()
            .chain(self.shell.iter_mut())
        {
            s.step(dt);
        }
        self.opacity +=
            (self.opacity_target - self.opacity) * (1.0 - (-dt / self.opacity_tau).exp());
        let (dots, text) = match self.expanded_since {
            Some(at) if now.duration_since(at).as_secs_f32() >= TEXT_DELAY => (0.0, 1.0),
            Some(_) => (0.0, 0.0),
            None => (1.0, 0.0),
        };
        self.dots_alpha += (dots - self.dots_alpha) * (1.0 - (-dt / DOTS_FADE).exp());
        self.text_alpha += (text - self.text_alpha) * (1.0 - (-dt / TEXT_FADE).exp());

        let t = now.duration_since(self.since).as_secs_f32();
        let fresh = input
            .bins_at
            .is_some_and(|at| now.duration_since(at) <= SPECTRUM_FRESH);
        let mut frame = Frame {
            scale: [self.sx.x, self.sy.x],
            offset: [self.shake(now), self.y.x],
            opacity: self.opacity,
            base_level: 1.0,
            wave_fade: 0.0,
            pop_t: 0.0,
            pop_gain: 0.0,
            cleanup_gain: 0.0,
            seed: self.seed,
            mode: 0.0,
            flash: 0.0,
            heights: self.heights,
            shell: self.shell.map(|s| s.x),
            dots_alpha: self.dots_alpha,
            text_alpha: self.text_alpha,
        };
        match self.status {
            PillStatus::Listening if fresh => {
                self.audio_debt += dt;
                while self.audio_debt >= AUDIO_TICK {
                    self.audio_tick(&input.bins, now);
                    self.audio_debt -= AUDIO_TICK;
                }
                let onset = self.onset_gain(now);
                frame.base_level = PREROLL_DOT_LEVEL + (1.0 - PREROLL_DOT_LEVEL) * onset;
                frame.wave_fade = 1.0;
                frame.heights = self.heights;
            }
            PillStatus::Listening => {
                // Pre-roll: acknowledged, but not armed until the device delivers samples.
                frame.base_level = PREROLL_DOT_LEVEL * smoothstep(t / DOT_SETTLE);
            }
            PillStatus::Processing => {
                frame.wave_fade = 1.0 - smoothstep(t / WAVE_HANDOFF);
                frame.pop_gain = smoothstep(t / POP_ONSET);
                frame.pop_t = t * POP_TEMPO;
                frame.cleanup_gain = self.cleanup_since.map_or(0.0, |at| {
                    smoothstep(now.duration_since(at).as_secs_f32() / CLEANUP_FADE_IN)
                });
            }
            PillStatus::Error => {
                let flashing = self
                    .error_at
                    .is_some_and(|at| now.duration_since(at) < ERROR_FLASH);
                frame.mode = if flashing { 1.0 } else { 2.0 };
                frame.flash =
                    0.5 + 0.5 * (t * 1000.0 * 0.02 * std::f32::consts::TAU).sin().max(0.0);
            }
            PillStatus::Idle => {}
        }
        frame
    }

    fn apply_status(&mut self, status: PillStatus, now: Instant) {
        if status == self.status {
            return;
        }
        let was_idle = self.status == PillStatus::Idle;
        self.status = status;
        self.since = now;
        match status {
            PillStatus::Listening => {
                self.reference = 0.0;
                self.audio_frames = 0;
                self.onset = None;
                self.audio_debt = 0.0;
                self.heights = [0.0; COLS];
            }
            PillStatus::Processing => self.seed = random_seed(),
            PillStatus::Error => self.error_at = Some(now),
            PillStatus::Idle => {
                self.last_idle = Some(now);
                self.error_at = None;
                // The exit animation owns scale and opacity from here.
                self.hovered = false;
            }
        }

        if was_idle && status != PillStatus::Idle {
            let warm = self.has_shown
                && self
                    .last_idle
                    .is_some_and(|at| now.duration_since(at) <= WARM_ENTRY);
            let (sx, sy, y, spring, tau) = if warm {
                (0.95, 0.98, 2.0, WARM_ENTRY_SPRING, 0.08 / 3.0)
            } else {
                (0.78, 0.94, 5.0, COLD_ENTRY, 0.12 / 3.0)
            };
            self.sx = Spring::at(sx);
            self.sy = Spring::at(sy);
            self.y = Spring::at(y);
            self.opacity = 0.0;
            for (s, target) in [(&mut self.sx, 1.0), (&mut self.sy, 1.0), (&mut self.y, 0.0)] {
                s.aim(target, spring);
            }
            self.opacity_target = 1.0;
            self.opacity_tau = tau;
            self.has_shown = true;
            self.hovered = false;
        } else if status == PillStatus::Idle {
            for (s, target) in [
                (&mut self.sx, 0.74),
                (&mut self.sy, 0.92),
                (&mut self.y, 5.0),
            ] {
                s.aim(target, EXIT);
            }
            self.opacity_target = 0.0;
            self.opacity_tau = 0.12 / 3.0;
        }
    }

    fn apply_hover(&mut self, hovering: bool) {
        if hovering == self.hovered {
            return;
        }
        self.hovered = hovering;
        let (scale, spring, opacity, tau) = if hovering {
            (HOVER_SCALE, HOVER_IN, HOVER_OPACITY, 0.14 / 3.0)
        } else {
            (1.0, HOVER_OUT, 1.0, 0.24 / 3.0)
        };
        self.sx.aim(scale, spring);
        self.sy.aim(scale, spring);
        self.opacity_target = opacity;
        self.opacity_tau = tau;
    }

    fn shake(&self, now: Instant) -> f32 {
        let Some(at) = self.error_at.filter(|_| !super::super::spring::reduced()) else {
            return 0.0;
        };
        let t = now.duration_since(at).as_secs_f32();
        if t >= SHAKE {
            return 0.0;
        }
        -4.0 * (t * std::f32::consts::PI / 0.04).sin()
    }

    fn onset_gain(&self, now: Instant) -> f32 {
        self.onset.map_or(0.0, |at| {
            smoothstep(now.duration_since(at).as_secs_f32() / WAVE_ONSET)
        })
    }

    // Same normalization and wave as the shipped canvas pill, one step per 60 Hz frame.
    fn audio_tick(&mut self, bins: &[u8], now: Instant) {
        if bins.is_empty() {
            return;
        }
        let peak = bins.iter().step_by(4).copied().max().unwrap_or(0) as f32;
        self.audio_frames += 1;
        if peak > 15.0 {
            if self.reference == 0.0 {
                self.reference = peak;
            } else {
                let (up, down) = if self.audio_frames < 30 {
                    (0.3, 0.05)
                } else {
                    (0.1, 0.005)
                };
                let rate = if peak > self.reference { up } else { down };
                self.reference += (peak - self.reference) * rate;
            }
        }
        let normalization = 200.0 / self.reference.max(40.0);
        self.onset.get_or_insert(now);
        let gain = self.onset_gain(now);

        for i in 0..=CENTER_COL {
            let dist = i as f32 / CENTER_COL as f32;
            let at = (bins.len() as f32 * 0.4 * dist * dist) as usize;
            let mut sample = bins.get(at).copied().unwrap_or(0) as f32;
            if let Some(&next) = bins.get(at + 1)
                && next != 0
            {
                sample = (sample + next as f32) / 2.0;
            }
            let mut value = sample * normalization / 255.0 * SENSITIVITY;
            if dist < 0.2 {
                value *= 1.25;
            }
            let value = value.min(1.0) * gain;

            let left = CENTER_COL - i;
            let h = &mut self.heights[left];
            *h += (value - *h)
                * if value > *h {
                    WAVE_ATTACK
                } else {
                    WAVE_RELEASE
                };
            let right = CENTER_COL + i;
            if right < COLS && right != left {
                self.heights[right] = self.heights[left];
            }
        }
    }
}

// 0..1000, like Math.random() * 1000; RandomState is seeded randomly per instance.
fn random_seed() -> f32 {
    use std::hash::BuildHasher;
    (std::collections::hash_map::RandomState::new().hash_one(0u8) % 1_000_000) as f32 / 1000.0
}
