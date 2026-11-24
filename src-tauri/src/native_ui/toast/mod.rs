//! Toasts, drawn in the overlay above the pill. A new toast grows out of a showing pill or
//! the toast it replaces, and the same toast shown again only nudges.

mod layout;
mod render;

use super::Pace;
use super::a11y;
use super::overlay::{self, Overlay};
use super::pill::PillShape;
use super::spring::Spring;
use super::text::TextEngine;
use super::window::WindowEvent;
use crate::toast::{Action, Payload};
use accesskit::{Node, NodeId, Role};
use layout::{Hit, Layout, Rect, ToastContent, ToastKind};
use render::{ToastRenderer, ToastView};
use std::sync::mpsc::Sender;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

// How long the exit animation gets before the toast closes.
const LEAVE: Duration = Duration::from_millis(120);
const COPIED: Duration = Duration::from_millis(1500);
/// The card's bottom edge sits this far above the pill's top, in points.
const ABOVE_PILL: f32 = 5.0;
// An expanded pill pushes the toast up a little more than it grows.
const PUSH: f32 = 1.25;
const SHAPE: (f32, f32, f32) = (420.0, 40.0, 1.0);
const BUMP: (f32, f32, f32) = (600.0, 14.0, 1.0);
const BUMP_KICK: f32 = 0.75;
const OLD_CONTENT_FADE: f32 = 0.15;
// Out of the pill, text waits until the card has mostly grown; between toasts it crossfades.
const EMERGE_CONTENT_DELAY: f32 = 0.12;
const NEW_CONTENT_FADE: f32 = 0.18;
const BORDER_FADE: f32 = 0.2;

#[derive(Default)]
pub(super) struct State {
    current: Option<Current>,
    // Bumped per shown toast, so a timer or slow action can't touch a newer one.
    generation: u64,
    hovered: Option<Hit>,
    pressed: Option<Hit>,
    copied_at: Option<Instant>,
    scroll: f32,
    /// Something to redraw that no animation would catch.
    dirty: bool,
    /// Where layout point (0, 0) of the current card sits, in window points.
    offset: (f32, f32),
}

struct Current {
    payload: Payload,
    content: Arc<ToastContent>,
    layout: Arc<Layout>,
    shown_at: Instant,
    leaving_since: Option<Instant>,
}

impl State {
    /// The card's rectangle in window points, while it takes clicks.
    pub(super) fn clickable_card(&self) -> Option<Rect> {
        let current = self
            .current
            .as_ref()
            .filter(|c| c.leaving_since.is_none())?;
        let card = current.layout.card;
        Some(Rect {
            x: card.x + self.offset.0,
            y: card.y + self.offset.1,
            ..card
        })
    }

    pub(super) fn is_showing(&self) -> bool {
        self.current.is_some()
    }

    /// Where the card was drawn, so clicks land on what's on screen.
    pub(super) fn set_offset(&mut self, offset: (f32, f32)) {
        self.offset = offset;
    }

    pub(super) fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Clicks pass through again, so no exit event will come for a hovered button.
    pub(super) fn cursor_left(&mut self) {
        if self.hovered.take().is_some() || self.pressed.take().is_some() {
            self.dirty = true;
        }
    }
}

fn kind(toast_type: &str) -> ToastKind {
    match toast_type {
        "error" => ToastKind::Error,
        "success" => ToastKind::Success,
        "warning" => ToastKind::Warning,
        "update" => ToastKind::Update,
        "celebration" => ToastKind::Celebration,
        "ask" => ToastKind::Ask,
        _ => ToastKind::Info,
    }
}

// How long each kind stays, in milliseconds; 0 stays until closed.
fn default_duration(kind: ToastKind) -> u64 {
    match kind {
        ToastKind::Error => 18_000,
        ToastKind::Info => 3_000,
        ToastKind::Success => 2_000,
        ToastKind::Warning => 5_000,
        ToastKind::Celebration => 6_000,
        ToastKind::Update | ToastKind::Ask => 0,
    }
}

fn content(payload: &Payload) -> ToastContent {
    let kind = kind(&payload.toast_type);
    let with_action =
        |label: &Option<String>, action: &Option<Action>| action.as_ref().and(label.clone());
    ToastContent {
        kind,
        title: payload.title.clone(),
        message: payload.message.clone(),
        detail: payload.detail.clone(),
        action_label: with_action(&payload.action_label, &payload.action),
        secondary_label: with_action(&payload.secondary_action_label, &payload.secondary_action),
        secondary_is_copy: payload.secondary_action == Some(Action::CopyLastTranscription),
        show_copy: kind == ToastKind::Error,
    }
}

/// What callers ask of toasts, handled in order on one thread so laying out text never
/// holds up the caller, which can be on the way to a paste.
enum Request {
    Show(Payload),
    Hide,
    RecordingStarted,
}

static REQUESTS: OnceLock<Sender<Request>> = OnceLock::new();

pub(super) fn start() -> std::io::Result<()> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let _ = REQUESTS.set(sender);
    std::thread::Builder::new()
        .name("overlay-toasts".into())
        .spawn(move || {
            for request in receiver {
                match request {
                    Request::Show(payload) => show_now(payload),
                    Request::Hide => dismiss(None),
                    Request::RecordingStarted => close_for_recording(),
                }
            }
        })?;
    Ok(())
}

fn request(request: Request) {
    if let Some(sender) = REQUESTS.get() {
        let _ = sender.send(request);
    }
}

pub fn show(payload: Payload) {
    request(Request::Show(payload));
}

fn show_now(payload: Payload) {
    let Some(o) = overlay::get() else { return };
    let content = content(&payload);
    let layout = layout::layout(&content, &mut o.engine.lock());
    let duration = payload
        .duration
        .unwrap_or_else(|| default_duration(content.kind));
    let auto_dismiss = payload.auto_dismiss != Some(false) && duration > 0;
    let spoken = spoken(&payload);
    let urgent = content.kind == ToastKind::Error;
    let generation = overlay::update(|s| {
        let t = &mut s.toast;
        t.generation += 1;
        t.current = Some(Current {
            payload,
            content: Arc::new(content),
            layout: Arc::new(layout),
            shown_at: Instant::now(),
            leaving_since: None,
        });
        t.hovered = None;
        t.pressed = None;
        t.copied_at = None;
        t.scroll = 0.0;
        t.dirty = true;
        t.generation
    });
    if auto_dismiss {
        dismiss_after(generation, Duration::from_millis(duration));
    }
    overlay::show(false);
    o.refresh_a11y();
    a11y::announce(&o.app, spoken, urgent);
}

// The card's text as a screen reader hears it.
fn spoken(payload: &Payload) -> String {
    [
        &payload.title,
        &Some(payload.message.clone()),
        &payload.detail,
    ]
    .into_iter()
    .flatten()
    .cloned()
    .collect::<Vec<_>>()
    .join("\n")
}

fn dismiss_after(generation: u64, delay: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        dismiss(Some(generation));
    });
}

/// Plays the exit animation, then closes the toast.
pub fn hide() {
    request(Request::Hide);
}

fn dismiss(generation: Option<u64>) {
    let leaving = overlay::update(|s| {
        let t = &mut s.toast;
        if generation.is_some_and(|g| g != t.generation) {
            return None;
        }
        let current = t.current.as_mut()?;
        current.leaving_since.get_or_insert_with(Instant::now);
        t.dirty = true;
        Some(t.generation)
    });
    if let Some(generation) = leaving {
        std::thread::spawn(move || {
            std::thread::sleep(LEAVE);
            hide_now(generation);
        });
    }
}

/// Starting a recording closes the toast unless it asked to stay.
pub fn recording_started() {
    request(Request::RecordingStarted);
}

fn close_for_recording() {
    let generation = overlay::update(|s| match &s.toast.current {
        Some(current) if current.payload.keep_while_recording != Some(true) => {
            Some(s.toast.generation)
        }
        _ => None,
    });
    if let Some(generation) = generation {
        hide_now(generation);
    }
}

fn hide_now(generation: u64) {
    let Some(o) = overlay::get() else { return };
    let closed = overlay::update(|s| {
        let t = &mut s.toast;
        if t.generation != generation || t.current.is_none() {
            return false;
        }
        t.current = None;
        t.hovered = None;
        t.pressed = None;
        t.dirty = true;
        true
    });
    if closed {
        o.refresh_a11y();
        // It can show the next question.
        crate::toast::toast_dismissed(&o.app);
    }
}

/// Mouse input in window points, on the main thread; anything that waits runs on its own thread.
pub(super) fn on_window_event(event: WindowEvent) {
    let mut activated = None;
    overlay::update(|s| {
        let t = &mut s.toast;
        let Some(current) = t.current.as_ref().filter(|c| c.leaving_since.is_none()) else {
            return;
        };
        let (ox, oy) = t.offset;
        let hit_at = |x: f64, y: f64, scroll: f32| {
            layout::hit_test(&current.layout, scroll, x as f32 - ox, y as f32 - oy)
        };
        match event {
            WindowEvent::MouseMoved { x, y } => {
                let hit = hit_at(x, y, t.scroll);
                t.hovered = matches!(hit, Hit::Close | Hit::Copy | Hit::Action | Hit::Secondary)
                    .then_some(hit);
            }
            WindowEvent::MouseExited => {
                t.hovered = None;
                t.pressed = None;
            }
            WindowEvent::MouseDown { x, y } => t.pressed = Some(hit_at(x, y, t.scroll)),
            WindowEvent::MouseUp { x, y } => {
                let hit = hit_at(x, y, t.scroll);
                if t.pressed.take() == Some(hit) {
                    activated = Some((hit, t.generation));
                }
            }
            WindowEvent::Scroll { dy } => {
                let max = current.layout.max_scroll;
                t.scroll = (t.scroll - dy as f32).clamp(0.0, max);
            }
        }
        t.dirty = true;
    });
    if let Some((hit, generation)) = activated {
        activate(hit, generation);
    }
}

fn activate(hit: Hit, generation: u64) {
    match hit {
        Hit::Close => {
            std::thread::spawn(move || close_by_user(generation));
        }
        Hit::Copy => copy_message(generation),
        Hit::Action | Hit::Secondary => {
            std::thread::spawn(move || run_action(hit, generation));
        }
        Hit::Card | Hit::Outside => {}
    }
}

fn payload_of(generation: u64) -> Option<Payload> {
    overlay::update(|s| {
        let t = &s.toast;
        (t.generation == generation)
            .then(|| t.current.as_ref().map(|c| c.payload.clone()))
            .flatten()
    })
}

fn close_by_user(generation: u64) {
    let (Some(o), Some(payload)) = (overlay::get(), payload_of(generation)) else {
        return;
    };
    if let Some(action) = payload.close_action
        && let Err(err) = action.run(&o.app)
    {
        tracing::error!("[NativeToast] close action failed: {err}");
    }
    hide_now(generation);
}

fn copy_message(generation: u64) {
    let (Some(o), Some(payload)) = (overlay::get(), payload_of(generation)) else {
        return;
    };
    let text = [payload.title, Some(payload.message)]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n");
    match arboard::Clipboard::new().and_then(|mut c| c.set_text(text)) {
        Ok(()) => {
            overlay::update(|s| {
                s.toast.copied_at = Some(Instant::now());
                s.toast.dirty = true;
            });
            o.refresh_a11y();
            // Redraws once the check mark goes back to the copy icon.
            std::thread::spawn(|| {
                std::thread::sleep(COPIED);
                overlay::update(|s| s.toast.dirty = true);
                if let Some(o) = overlay::get() {
                    o.refresh_a11y();
                }
            });
        }
        Err(err) => tracing::error!("[NativeToast] copy failed: {err}"),
    }
}

fn run_action(hit: Hit, generation: u64) {
    let (Some(o), Some(payload)) = (overlay::get(), payload_of(generation)) else {
        return;
    };
    let action = if hit == Hit::Action {
        payload.action.clone()
    } else {
        payload.secondary_action.clone()
    };
    let Some(action) = action else { return };
    // Copying shows its own "Copied" toast, which closing here would hide.
    let replaces_itself = action == Action::CopyLastTranscription;
    match action.run(&o.app) {
        Ok(()) if replaces_itself => {}
        Ok(()) => hide_now(generation),
        Err(err) => {
            tracing::error!("[NativeToast] action failed: {err}");
            if payload_of(generation).is_none() {
                return;
            }
            // The error gets its own full display time, not the old toast's deadline.
            show_now(Payload {
                toast_type: "error".to_string(),
                message: crate::toast::native(&o.app, "native.toast.action_failed"),
                duration: None,
                auto_dismiss: None,
                keep_while_recording: None,
                ..payload
            });
        }
    }
}

// Ids change with each toast, so a screen reader announces every new one.
const IDS_PER_TOAST: u64 = 10;
const BUTTONS: [Hit; 4] = [Hit::Close, Hit::Copy, Hit::Action, Hit::Secondary];

fn node_id(generation: u64, slot: u64) -> NodeId {
    NodeId(IDS_PER_TOAST * (generation + 1) + slot)
}

/// The card is a live alert or status, with its buttons beside it
/// so only the message is announced. Bounds are in window pixels at `scale`.
pub(super) fn nodes(o: &Overlay, s: &State, scale: f64) -> Vec<(NodeId, Node)> {
    let mut nodes = Vec::new();
    let Some(current) = &s.current else {
        return nodes;
    };
    let (ox, oy) = s.offset;
    let px = |r: Rect| accesskit::Rect {
        x0: f64::from(r.x + ox) * scale,
        y0: f64::from(r.y + oy) * scale,
        x1: f64::from(r.x + ox + r.w) * scale,
        y1: f64::from(r.y + oy + r.h) * scale,
    };
    let content = &current.content;
    let error = content.kind == ToastKind::Error;
    let mut card = Node::new(if error { Role::Alert } else { Role::Status });
    a11y::live(&mut card, error);
    card.set_label(spoken(&current.payload));
    card.set_bounds(px(current.layout.card));
    nodes.push((node_id(s.generation, 0), card));
    let copied = s.copied_at.is_some_and(|at| at.elapsed() < COPIED);
    let native = |key| crate::toast::native(&o.app, key);
    for (slot, hit) in (1..).zip(BUTTONS) {
        let layout = &current.layout;
        let (rect, label) = match hit {
            Hit::Close => (Some(layout.close), Some(native("native.toast.close"))),
            Hit::Copy => (
                layout.copy,
                Some(native(if copied {
                    "native.toast.copy_done"
                } else {
                    "native.toast.copy_message"
                })),
            ),
            Hit::Action => (layout.action, content.action_label.clone()),
            _ => (layout.secondary, content.secondary_label.clone()),
        };
        let (Some(rect), Some(label)) = (rect, label) else {
            continue;
        };
        let mut button = Node::new(Role::Button);
        button.set_label(label);
        button.set_bounds(px(rect));
        button.add_action(accesskit::Action::Click);
        nodes.push((node_id(s.generation, slot), button));
    }
    nodes
}

/// A screen reader pressed a toast button; false when the node isn't one.
pub(super) fn on_a11y_action(request: &accesskit::ActionRequest) -> bool {
    let id = request.target_node.0;
    let (generation, slot) = (id / IDS_PER_TOAST, id % IDS_PER_TOAST);
    match (
        generation.checked_sub(1),
        slot.checked_sub(1).and_then(|i| BUTTONS.get(i as usize)),
    ) {
        (Some(generation), Some(&hit)) => {
            activate(hit, generation);
            true
        }
        _ => false,
    }
}

/// The showing toast's buttons in window points, so scripted tests can aim at them.
#[cfg(debug_assertions)]
pub fn buttons() -> serde_json::Value {
    use serde_json::json;
    overlay::update(|s| {
        let t = &s.toast;
        let Some(current) = &t.current else {
            return serde_json::Value::Null;
        };
        let (ox, oy) = t.offset;
        let rect = |r: Option<Rect>| r.map(|r| json!([r.x + ox, r.y + oy, r.w, r.h]));
        let layout = &current.layout;
        json!({
            "close": rect(Some(layout.close)),
            "copy": rect(layout.copy),
            "action": rect(layout.action),
            "secondary": rect(layout.secondary),
            "card": rect(Some(layout.card)),
        })
    })
}

/// What the render thread read from `State` for one frame.
pub(super) struct Snapshot {
    generation: u64,
    current: Option<Shown>,
    hovered: Option<Hit>,
    copied: bool,
    scroll: f32,
}

#[derive(Clone)]
struct Shown {
    content: Arc<ToastContent>,
    layout: Arc<Layout>,
    shown_at: Instant,
    leaving_since: Option<Instant>,
}

pub(super) fn snapshot(s: &mut State) -> Snapshot {
    s.dirty = false;
    Snapshot {
        generation: s.generation,
        current: s.current.as_ref().map(|c| Shown {
            content: c.content.clone(),
            layout: c.layout.clone(),
            shown_at: c.shown_at,
            leaving_since: c.leaving_since,
        }),
        hovered: s.hovered,
        copied: s.copied_at.is_some_and(|at| at.elapsed() < COPIED),
        scroll: s.scroll,
    }
}

/// A toast on screen, as the render thread moves it.
struct Card {
    generation: u64,
    shown: Shown,
    slot: usize,
    /// When it started to morph in from the pill or another toast instead of playing
    /// toast-in, and how long its text waits.
    morph_from: Option<(Instant, f32)>,
}

/// A replaced toast whose content fades out inside the new card.
struct Fading {
    shown: Shown,
    slot: usize,
    since: Instant,
    offset_from_center: (f32, f32),
}

/// How the toasts move, on the render thread.
pub(super) struct Motion {
    card: Option<Card>,
    fading: Option<Fading>,
    // Center x, bottom, width and height of the drawn card, in window points.
    shape: [Spring; 4],
    radius: Spring,
    bump: Spring,
    border_from: Option<(([f32; 3], f32), Instant)>,
}

impl Default for Motion {
    fn default() -> Self {
        Self {
            card: None,
            fading: None,
            shape: [Spring::at(0.0); 4],
            radius: Spring::at(render::RADIUS),
            bump: Spring::at(1.0),
            border_from: None,
        }
    }
}

/// One toast to draw this frame.
pub(super) struct Frame {
    slot: usize,
    content: Arc<ToastContent>,
    layout: Arc<Layout>,
    view: ToastView,
}

fn place(layout: &Layout, pill: &PillShape) -> [f32; 4] {
    let bottom = pill.top_collapsed - ABOVE_PILL - (pill.grown * PUSH);
    [pill.center_x, bottom, layout.card.w, layout.card.h]
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t) * (1.0 - t)
}

impl Motion {
    /// How soon a frame could differ from the last one drawn.
    pub(super) fn pace(&self, s: &State) -> Pace {
        if s.dirty || s.current.is_some() != self.card.is_some() || self.fading.is_some() {
            return Pace::Moving;
        }
        let Some(card) = &self.card else {
            return Pace::Still;
        };
        let fading_in = card
            .morph_from
            .is_some_and(|(at, delay)| at.elapsed().as_secs_f32() < delay + NEW_CONTENT_FADE);
        let moving = self.shape.iter().any(|s| !s.settled())
            || !self.radius.settled()
            || !self.bump.settled()
            || self.border_from.is_some()
            || fading_in;
        if moving {
            Pace::Moving
        } else {
            ToastRenderer::pace(&card.shown.content, &self.view_bits(card, Instant::now()))
        }
    }

    fn view_bits(&self, card: &Card, now: Instant) -> ToastView {
        ToastView {
            age: now.duration_since(card.shown.shown_at).as_secs_f32(),
            leaving: card
                .shown
                .leaving_since
                .map(|at| now.duration_since(at).as_secs_f32()),
            keyframes: card.morph_from.is_none(),
            ..Default::default()
        }
    }

    /// Takes in the toast state and the pill's shape, and returns what to draw, oldest first.
    pub(super) fn step(
        &mut self,
        snap: &Snapshot,
        pill: &PillShape,
        now: Instant,
        dt: f32,
    ) -> Vec<Frame> {
        self.observe(snap, pill, now);
        let Some(card) = &self.card else {
            self.fading = None;
            return Vec::new();
        };
        let target = place(&card.shown.layout, pill);
        for (s, t) in self.shape.iter_mut().zip(target) {
            s.aim(t, SHAPE);
        }
        for s in self
            .shape
            .iter_mut()
            .chain([&mut self.radius, &mut self.bump])
        {
            s.step(dt);
        }
        let [cx, bottom, w, h] = self.shape.map(|s| s.x);
        let shape = Rect {
            x: cx - w / 2.0,
            y: bottom - h,
            w,
            h,
        };
        let center = (cx, bottom - h / 2.0);
        let offset_for = |layout: &Layout| {
            let card = layout.card;
            (
                center.0 - card.x - card.w / 2.0,
                center.1 - card.y - card.h / 2.0,
            )
        };

        let border = self.border_from.and_then(|((from, from_a), since)| {
            let p = ease_out(now.duration_since(since).as_secs_f32() / BORDER_FADE);
            let (to, to_a) = render::border_of(card.shown.content.kind);
            (p < 1.0).then(|| {
                let mix = |a: f32, b: f32| a + (b - a) * p;
                (
                    [
                        mix(from[0], to[0]),
                        mix(from[1], to[1]),
                        mix(from[2], to[2]),
                    ],
                    mix(from_a, to_a),
                )
            })
        });
        if border.is_none() {
            self.border_from = None;
        }

        let base = ToastView {
            hovered: snap.hovered,
            copied: snap.copied,
            scroll: snap.scroll,
            shape,
            radius: self.radius.x,
            bump: self.bump.x,
            card_alpha: 1.0,
            border,
            ..self.view_bits(card, now)
        };
        let content_alpha = card.morph_from.map_or(1.0, |(at, delay)| {
            let t = now.duration_since(at).as_secs_f32() - delay;
            ease_out(t / NEW_CONTENT_FADE)
        });
        let mut frames = Vec::new();
        if let Some(fading) = &self.fading {
            let t = now.duration_since(fading.since).as_secs_f32() / OLD_CONTENT_FADE;
            if t >= 1.0 {
                self.fading = None;
            } else {
                frames.push(Frame {
                    slot: fading.slot,
                    content: fading.shown.content.clone(),
                    layout: fading.shown.layout.clone(),
                    view: ToastView {
                        hovered: None,
                        keyframes: false,
                        leaving: None,
                        content_alpha: 1.0 - ease_out(t),
                        card_alpha: 0.0,
                        offset: (
                            fading.offset_from_center.0 + center.0,
                            fading.offset_from_center.1 + center.1,
                        ),
                        ..base
                    },
                });
            }
        }
        frames.push(Frame {
            slot: card.slot,
            content: card.shown.content.clone(),
            layout: card.shown.layout.clone(),
            view: ToastView {
                offset: offset_for(&card.shown.layout),
                content_alpha,
                ..base
            },
        });
        frames
    }

    fn observe(&mut self, snap: &Snapshot, pill: &PillShape, now: Instant) {
        let Some(shown) = &snap.current else {
            self.card = None;
            return;
        };
        if self
            .card
            .as_ref()
            .is_some_and(|c| c.generation == snap.generation)
        {
            if let Some(card) = &mut self.card {
                card.shown.leaving_since = shown.leaving_since;
            }
            return;
        }
        let target = place(&shown.layout, pill);
        let previous = self.card.take().filter(|c| c.shown.leaving_since.is_none());
        let slot = previous.as_ref().map_or(0, |c| 1 - c.slot);
        let mut morph_from = None;
        match previous {
            // The same toast again: a nudge instead of a new entrance.
            Some(old) if *old.shown.content == *shown.content => {
                let mut bump = Spring::at(1.0);
                bump.aim(1.0, BUMP);
                bump.kick(BUMP_KICK);
                self.bump = bump;
                self.card = Some(Card {
                    generation: snap.generation,
                    shown: Shown {
                        shown_at: old.shown.shown_at,
                        ..shown.clone()
                    },
                    slot: old.slot,
                    morph_from: old.morph_from,
                });
                return;
            }
            // Another toast: the card reshapes around the new content as the old fades out.
            Some(old) => {
                let card = old.shown.layout.card;
                self.border_from = Some((render::border_of(old.shown.content.kind), now));
                self.fading = Some(Fading {
                    offset_from_center: (-(card.x + card.w / 2.0), -(card.y + card.h / 2.0)),
                    shown: old.shown,
                    slot: old.slot,
                    since: now,
                });
                morph_from = Some((now, 0.0));
            }
            // Out of a showing pill: the card starts as the pill and grows into place.
            None if pill.visible => {
                self.shape = pill.rect.map(Spring::at);
                self.radius = Spring::at(pill.radius);
                self.border_from = Some((([0.0; 3], 0.0), now));
                morph_from = Some((now, EMERGE_CONTENT_DELAY));
            }
            None => {
                self.shape = target.map(Spring::at);
                self.radius = Spring::at(render::RADIUS);
            }
        }
        self.radius.aim(render::RADIUS, SHAPE);
        self.bump = Spring::at(1.0);
        self.card = Some(Card {
            generation: snap.generation,
            shown: shown.clone(),
            slot,
            morph_from,
        });
    }
}

/// Draws up to two toasts: the current one and a replaced one fading out.
pub(super) struct Painter {
    renderers: [ToastRenderer; 2],
}

impl Painter {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        Self {
            renderers: [0, 1].map(|_| ToastRenderer::new(device.clone(), queue.clone(), format)),
        }
    }

    pub fn prepare(
        &mut self,
        frames: &[Frame],
        scale: f32,
        target: (u32, u32),
        engine: &mut TextEngine,
    ) {
        for frame in frames {
            self.renderers[frame.slot].prepare(
                &frame.layout,
                &frame.content,
                &frame.view,
                scale,
                target,
                engine,
            );
        }
    }

    pub fn draw(&self, frames: &[Frame], pass: &mut wgpu::RenderPass) {
        for frame in frames {
            self.renderers[frame.slot].draw(pass);
        }
    }
}

/// Where the current card's layout origin was drawn this frame, in window points.
pub(super) fn offset(frames: &[Frame]) -> Option<(f32, f32)> {
    frames.last().map(|f| f.view.offset)
}
