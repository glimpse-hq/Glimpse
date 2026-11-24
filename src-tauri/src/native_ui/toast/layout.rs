//! Toast geometry in points.

use crate::native_ui::text::{Style, Text, TextEngine};

pub const WINDOW_INSET_X: f32 = 8.0;
pub const WINDOW_INSET_TOP: f32 = 16.0;
pub const WINDOW_INSET_BOTTOM: f32 = 24.0;
const MAX_WIDTH: f32 = 420.0;
const MAX_HEIGHT: f32 = 140.0;
const BORDER: f32 = 1.0;
const PAD_X: f32 = 16.0;
const PAD_Y: f32 = 12.0;
const GAP: f32 = 12.0;
// Close and copy stack in one column in the top right corner, concentric with the corner radius.
const BUTTON: f32 = 20.0;
const BUTTON_INSET: f32 = 6.0;
const BUTTON_GAP: f32 = 4.0;
// Text stops this far before the button column.
const TEXT_TO_BUTTONS: f32 = 12.0;
const TRAILING: f32 = BUTTON_INSET + BUTTON + TEXT_TO_BUTTONS - PAD_X;
const ROW_GAP: f32 = 16.0;
const ROW_TOP: f32 = 8.0;
const ROW_HEIGHT: f32 = 18.0;
const ICON: f32 = 12.0;
const ICON_GAP: f32 = 4.0;
// The ask action row reaches under the close button, to the padding.
const ASK_ROW_OVERHANG: f32 = TRAILING;
pub(super) const SCROLLBAR: f32 = 6.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ToastKind {
    Error,
    Info,
    Success,
    Warning,
    Update,
    Celebration,
    Ask,
}

#[derive(Clone, PartialEq, Debug)]
pub struct ToastContent {
    pub kind: ToastKind,
    pub title: Option<String>,
    pub message: String,
    pub detail: Option<String>,
    pub action_label: Option<String>,
    pub secondary_label: Option<String>,
    pub secondary_is_copy: bool,
    pub show_copy: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Hit {
    Close,
    Copy,
    Action,
    Secondary,
    Card,
    Outside,
}

#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    fn offset(self, dx: f32, dy: f32) -> Self {
        Rect {
            x: self.x + dx,
            y: self.y + dy,
            ..self
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Role {
    Header,
    Title,
    Message,
    Detail,
    Action,
    Secondary,
}

#[derive(Clone)]
pub(super) struct Block {
    pub text: Text,
    pub x: f32,
    pub y: f32,
    pub role: Role,
}

/// Everything in window points. Content inside the card is placed at scroll 0
/// and moves up by the scroll offset.
#[derive(Clone)]
pub struct Layout {
    pub window: (f32, f32),
    pub card: Rect,
    pub max_scroll: f32,
    pub close: Rect,
    pub copy: Option<Rect>,
    pub action: Option<Rect>,
    pub secondary: Option<Rect>,
    pub(super) marker: Rect,
    pub(super) secondary_icon: Option<(f32, f32)>,
    pub(super) reveal_split: f32,
    pub(super) blocks: Vec<Block>,
}

struct Placed {
    width: f32,
    height: f32,
    marker: Rect,
    action: Option<Rect>,
    secondary: Option<Rect>,
    secondary_icon: Option<(f32, f32)>,
    reveal_split: f32,
    blocks: Vec<Block>,
}

pub fn layout(content: &ToastContent, engine: &mut TextEngine) -> Layout {
    let ask = content.kind == ToastKind::Ask;
    let marker_w = if content.kind == ToastKind::Update {
        10.0
    } else {
        8.0
    };
    let chrome = 2.0 * (BORDER + PAD_X) + marker_w + GAP + TRAILING;

    let natural = [
        headers(content)
            .map(|(h, _)| engine.shape(h, Style::LabelMedium, None).width)
            .fold(0.0, f32::max),
        engine.shape(&content.message, Style::Body, None).width,
        row_width(content, engine) - if ask { ASK_ROW_OVERHANG } else { 0.0 },
    ]
    .into_iter()
    .fold(0.0, f32::max);

    let mut placed = place(content, engine, natural.min(MAX_WIDTH - chrome), chrome);
    let mut scrollbar = 0.0;
    if !ask && placed.height > MAX_HEIGHT {
        scrollbar = SCROLLBAR;
        let column = natural.min(MAX_WIDTH - chrome - SCROLLBAR);
        placed = place(content, engine, column, chrome + SCROLLBAR);
    }

    let buttons_h = if content.show_copy {
        2.0 * (BORDER + BUTTON_INSET + BUTTON) + BUTTON_GAP
    } else {
        0.0
    };
    let card_h = if ask {
        placed.height
    } else {
        placed.height.max(buttons_h).min(MAX_HEIGHT)
    };
    let window = (
        (placed.width + 2.0 * WINDOW_INSET_X).ceil(),
        (card_h + WINDOW_INSET_TOP + WINDOW_INSET_BOTTOM).ceil(),
    );
    let card = Rect {
        x: (window.0 - placed.width) / 2.0,
        y: window.1 - WINDOW_INSET_BOTTOM - card_h,
        w: placed.width,
        h: card_h,
    };
    // Content shorter than the button column sits centered beside it.
    let (dx, dy) = (card.x, card.y + ((card_h - placed.height) / 2.0).max(0.0));
    let close = Rect {
        x: card.x + card.w - BORDER - scrollbar - BUTTON_INSET - BUTTON,
        y: card.y + BORDER + BUTTON_INSET,
        w: BUTTON,
        h: BUTTON,
    };
    let copy = content.show_copy.then_some(Rect {
        y: close.y + BUTTON + BUTTON_GAP,
        ..close
    });
    Layout {
        window,
        card,
        max_scroll: (placed.height - card_h).max(0.0),
        close,
        copy,
        action: placed.action.map(|r| r.offset(dx, dy)),
        secondary: placed.secondary.map(|r| r.offset(dx, dy)),
        marker: placed.marker.offset(dx, dy),
        secondary_icon: placed.secondary_icon.map(|(x, y)| (x + dx, y + dy)),
        reveal_split: placed.reveal_split + dy,
        blocks: placed
            .blocks
            .into_iter()
            .map(|b| Block {
                x: b.x + dx,
                y: b.y + dy,
                ..b
            })
            .collect(),
    }
}

/// What a click at window point (`x`, `y`) lands on, with the card scrolled by `scroll` points.
pub fn hit_test(layout: &Layout, scroll: f32, x: f32, y: f32) -> Hit {
    if !layout.card.contains(x, y) {
        return Hit::Outside;
    }
    let scrolled = y + scroll;
    [
        (Some(layout.close), Hit::Close),
        (layout.copy, Hit::Copy),
        (layout.action, Hit::Action),
        (layout.secondary, Hit::Secondary),
    ]
    .into_iter()
    .find_map(|(rect, hit)| rect.filter(|r| r.contains(x, scrolled)).map(|_| hit))
    .unwrap_or(Hit::Card)
}

// The small lines above the message: GLIMPSE on update toasts, then any title.
fn headers(content: &ToastContent) -> impl Iterator<Item = (&str, Role)> {
    let glimpse = (content.kind == ToastKind::Update).then_some(("GLIMPSE", Role::Header));
    let title = content.title.as_deref().map(|t| (t, Role::Title));
    glimpse.into_iter().chain(title)
}

fn action_text(content: &ToastContent) -> Option<String> {
    let label = content.action_label.as_deref()?;
    Some(if content.kind == ToastKind::Ask {
        label.to_string()
    } else {
        format!("{label} \u{2192}")
    })
}

fn has_spacer(content: &ToastContent) -> bool {
    !content.secondary_is_copy && content.kind != ToastKind::Ask
}

struct RowItem {
    text: Text,
    width: f32,
    role: Role,
}

fn row_items(content: &ToastContent, engine: &mut TextEngine) -> Vec<RowItem> {
    let mut items = Vec::new();
    if let Some(text) = action_text(content) {
        let text = engine.shape(&text, Style::BodySmMedium, None);
        items.push(RowItem {
            width: text.width,
            text,
            role: Role::Action,
        });
    }
    if let Some(label) = &content.secondary_label {
        let text = engine.shape(label, Style::BodySmMedium, None);
        let icon = if content.secondary_is_copy {
            ICON + ICON_GAP
        } else {
            0.0
        };
        items.push(RowItem {
            width: text.width + icon,
            text,
            role: Role::Secondary,
        });
    }
    // Ask puts its second answer before the first, both at the right.
    if content.kind == ToastKind::Ask {
        items.reverse();
    }
    items
}

fn has_row(content: &ToastContent) -> bool {
    content.action_label.is_some() || content.secondary_label.is_some()
}

fn row_width(content: &ToastContent, engine: &mut TextEngine) -> f32 {
    if !has_row(content) {
        return 0.0;
    }
    let items = row_items(content, engine);
    let detail = content
        .detail
        .as_deref()
        .map(|d| engine.shape(d, Style::BodySm, None).width);
    let count = items.len() + usize::from(detail.is_some()) + usize::from(has_spacer(content));
    items.iter().map(|i| i.width).sum::<f32>()
        + detail.unwrap_or(0.0)
        + ROW_GAP * count.saturating_sub(1) as f32
}

// Lays the card out at the origin with a text column `column` points wide.
fn place(content: &ToastContent, engine: &mut TextEngine, column: f32, chrome: f32) -> Placed {
    // Shaping at the measured width must not wrap on rounding.
    let wrap = column + 0.01;
    let left = BORDER + PAD_X;
    let top = BORDER + PAD_Y;
    let marker = if content.kind == ToastKind::Update {
        Rect {
            x: left,
            y: top + 2.0,
            w: 10.0,
            h: 10.0,
        }
    } else {
        Rect {
            x: left,
            y: top + 4.0,
            w: 8.0,
            h: 8.0,
        }
    };
    let x = left + marker.w + GAP;
    let mut y = top;
    let mut blocks = Vec::new();
    for (header, role) in headers(content) {
        let text = engine.shape(header, Style::LabelMedium, Some(wrap));
        let height = text.height;
        blocks.push(Block { text, x, y, role });
        y += height + 2.0;
    }
    let message = engine.shape(&content.message, Style::Body, Some(wrap));
    let message_h = message.height;
    blocks.push(Block {
        text: message,
        x,
        y,
        role: Role::Message,
    });
    y += message_h;

    let reveal_split = y + ROW_TOP / 2.0;
    let mut action = None;
    let mut secondary = None;
    let mut secondary_icon = None;
    if has_row(content) {
        y += ROW_TOP;
        let ask = content.kind == ToastKind::Ask;
        let row_w = column + if ask { ASK_ROW_OVERHANG } else { 0.0 };
        let items = row_items(content, engine);
        let fixed: f32 = items.iter().map(|i| i.width).sum();
        let count =
            items.len() + usize::from(content.detail.is_some()) + usize::from(has_spacer(content));
        let gaps = ROW_GAP * count.saturating_sub(1) as f32;
        // A wrapped detail keeps the width it shrank to, not its widest line.
        let detail = content.detail.as_deref().map(|d| {
            let natural = engine.shape(d, Style::BodySm, None).width;
            let width = natural.min((row_w - fixed - gaps).max(0.0));
            (engine.shape(d, Style::BodySm, Some(width + 0.01)), width)
        });
        let row_h = detail
            .as_ref()
            .map_or(ROW_HEIGHT, |(d, _)| d.height.max(ROW_HEIGHT));

        let mut widths: Vec<f32> = detail.iter().map(|(_, w)| *w).collect();
        widths.extend(items.iter().map(|i| i.width));
        let mut xs = Vec::with_capacity(widths.len());
        let mut cursor = x;
        for w in &widths {
            xs.push(cursor);
            cursor += w + ROW_GAP;
        }
        let used = cursor - ROW_GAP - x;
        let free = (row_w - used - if has_spacer(content) { ROW_GAP } else { 0.0 }).max(0.0);
        if has_spacer(content) {
            // The flex-1 spacer sits before the secondary button and takes the free space.
            if content.secondary_label.is_some()
                && let Some(last) = xs.last_mut()
            {
                *last += free + ROW_GAP;
            }
        } else if ask {
            let buttons = usize::from(detail.is_some());
            for x in xs.iter_mut().skip(buttons) {
                *x += free;
            }
        }

        let mut xs = xs.into_iter();
        if let Some((text, _)) = detail {
            let dx = xs.next().unwrap_or(x);
            let dy = y + (row_h - text.height) / 2.0;
            blocks.push(Block {
                text,
                x: dx,
                y: dy,
                role: Role::Detail,
            });
        }
        for (item, ix) in items.into_iter().zip(xs) {
            let rect = Rect {
                x: ix,
                y: y + (row_h - ROW_HEIGHT) / 2.0,
                w: item.width,
                h: ROW_HEIGHT,
            };
            let mut tx = ix;
            if item.role == Role::Secondary {
                secondary = Some(rect);
                if content.secondary_is_copy {
                    secondary_icon = Some((ix, rect.y + (ROW_HEIGHT - ICON) / 2.0));
                    tx += ICON + ICON_GAP;
                }
            } else {
                action = Some(rect);
            }
            blocks.push(Block {
                y: y + (row_h - item.text.height) / 2.0,
                text: item.text,
                x: tx,
                role: item.role,
            });
        }
        y += row_h;
    }
    let bottom = y.max(marker.y + marker.h) + PAD_Y + BORDER;
    Placed {
        width: column + chrome,
        height: bottom,
        marker,
        action,
        secondary,
        secondary_icon,
        reveal_split,
        blocks,
    }
}
