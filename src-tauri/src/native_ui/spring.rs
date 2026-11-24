use std::sync::atomic::{AtomicBool, Ordering};

/// Reduce Motion is on: springs land at once, and only fades play.
pub static REDUCED: AtomicBool = AtomicBool::new(false);

pub fn reduced() -> bool {
    REDUCED.load(Ordering::Relaxed)
}

/// A damped spring that keeps its velocity when its target moves, so interrupted motion stays continuous.
#[derive(Clone, Copy, Debug)]
pub struct Spring {
    pub x: f32,
    v: f32,
    target: f32,
    // stiffness, damping, mass, as in framer-motion
    params: (f32, f32, f32),
}

impl Spring {
    pub fn at(x: f32) -> Self {
        Self {
            x,
            v: 0.0,
            target: x,
            params: (760.0, 32.0, 0.36),
        }
    }

    pub fn aim(&mut self, target: f32, params: (f32, f32, f32)) {
        self.target = target;
        self.params = params;
    }

    /// Adds velocity, for a nudge that springs back.
    pub fn kick(&mut self, v: f32) {
        self.v += v;
    }

    pub fn step(&mut self, dt: f32) {
        if reduced() {
            (self.x, self.v) = (self.target, 0.0);
            return;
        }
        let (k, c, m) = self.params;
        let n = (dt * 1000.0).ceil().max(1.0);
        let h = dt / n;
        for _ in 0..n as usize {
            self.v += (-k * (self.x - self.target) - c * self.v) / m * h;
            self.x += self.v * h;
        }
        // Near a large target, f32 steps this small round away and the spring would never land.
        if self.settled() {
            (self.x, self.v) = (self.target, 0.0);
        }
    }

    pub fn settled(&self) -> bool {
        let close = 1e-3 * self.target.abs().max(1.0);
        (self.x - self.target).abs() < close && self.v.abs() < close
    }
}
