//! The pill, drawn at the bottom of the overlay.

mod anim;

pub(super) use anim::{Anim, Input};

use super::a11y;
use super::overlay::{self, Overlay, PILL_ANCHOR, SIZE};
use super::spring::Spring;
use super::text::{self, Image, Style, TextEngine};
use crate::pill::PillStatus;
use accesskit::{Node, NodeId, Role};
use anim::{COLLAPSED, COLS, Frame};
use std::sync::Arc;
use std::time::Instant;

// --ui-pill-shell-rgb: Windows draws the shell darker.
#[cfg(target_os = "macos")]
const SHELL: [f32; 3] = [10.0 / 255.0, 10.0 / 255.0, 12.0 / 255.0];
#[cfg(target_os = "windows")]
const SHELL: [f32; 3] = [4.0 / 255.0, 4.0 / 255.0, 5.0 / 255.0];
// The text's bottom lines that are drawn, each with its own slide.
const LINES: usize = 6;
const UNIFORM_FLOATS: usize = 36 + 4 * LINES + COLS.next_multiple_of(4);
// Hovering this area, centered under the pill, fades the pill so what's behind shows.
const HOVER_ZONE: (f32, f32) = (300.0, 190.0);
// The expanded pill's text column and padding, in points.
const TEXT_WIDTH: f32 = 228.0;
const TEXT_BOTTOM: f32 = 14.0;
// Enough lines above the visible ones to fill the top fade.
const TEXT_KEEP: f32 = 96.0;
const FRESH_FADE: f32 = 0.2;
const FRESH_RISE: f32 = 4.0;
// framer-motion's layout spring, bounce 0 over 0.24 s.
const LINE_SHIFT: (f32, f32, f32) = (685.0, 52.0, 1.0);

/// Shows the pill controller's status. Read under the overlay's lock, so of two racing
/// calls the later one always shows the newest status.
pub fn sync_status() {
    let Some(o) = overlay::get() else { return };
    let mut status = PillStatus::Idle;
    let changed = overlay::update(|s| {
        status = tauri::Manager::state::<crate::AppState>(&o.app)
            .pill()
            .status();
        let changed = s.pill.status != status;
        s.pill.status = status;
        if matches!(status, PillStatus::Idle | PillStatus::Listening) {
            s.pill.cleanup = false;
            s.pill.bins_at = None;
        }
        if status == PillStatus::Idle {
            s.pill.expanded = false;
            s.pill.text = Arc::from("");
        }
        if changed {
            s.pill.changes += 1;
        }
        changed
    });
    if !changed {
        return;
    }
    o.refresh_a11y();
    if let Some(key) = status_key(status) {
        a11y::announce(&o.app, crate::toast::native(&o.app, key), false);
    }
}

fn status_key(status: PillStatus) -> Option<&'static str> {
    match status {
        PillStatus::Listening => Some("native.pill.listening"),
        PillStatus::Processing => Some("native.pill.processing"),
        PillStatus::Error => Some("native.pill.error"),
        PillStatus::Idle => None,
    }
}

/// The pill's polite live region: "Listening...", "Processing...", "Error occurred".
pub(super) fn nodes(o: &Overlay, input: &Input) -> Vec<(NodeId, Node)> {
    let Some(key) = status_key(input.status) else {
        return Vec::new();
    };
    let mut status = Node::new(Role::Status);
    a11y::live(&mut status, false);
    status.set_label(crate::toast::native(&o.app, key));
    // A new id per change, so it's announced. Toast ids count up from 10.
    vec![(NodeId(u64::MAX - input.changes), status)]
}

pub fn set_cleanup(cleanup: bool) {
    overlay::update(|s| s.pill.cleanup = cleanup);
}

pub fn set_spectrum(bins: &[u8]) {
    overlay::update(|s| {
        s.pill.bins.clear();
        s.pill.bins.extend_from_slice(bins);
        s.pill.bins_at = Some(Instant::now());
    });
}

pub fn set_hover(hovering: bool) {
    overlay::update(|s| s.pill.hovering = hovering);
}

/// Grows the pill to show `text` (a live transcript or an action's message), or shrinks it back to dots.
pub fn set_text(expanded: bool, text: &str) {
    overlay::update(|s| {
        if s.pill.status == PillStatus::Idle {
            return;
        }
        s.pill.expanded = expanded;
        if expanded && *s.pill.text != *text {
            s.pill.text = Arc::from(text);
        }
    });
}

/// Puts the overlay up on the screen under the cursor if it isn't showing.
pub fn show() {
    overlay::show(true);
}

/// Whether the cursor is over the pill's hover zone; None while nothing is on screen.
pub fn contains_cursor() -> Option<bool> {
    let o = overlay::get()?;
    if !overlay::update(|s| s.on_screen) {
        return None;
    }
    let (x, y) = o.window.cursor_point()?;
    let left = f64::from(PILL_ANCHOR.0 - HOVER_ZONE.0 / 2.0);
    let top = SIZE.1 - f64::from(HOVER_ZONE.1);
    Some(x >= left && x < left + f64::from(HOVER_ZONE.0) && y >= top && y < SIZE.1)
}

/// Where the pill is drawn, for the toast that grows out of it or sits above it.
pub(super) struct PillShape {
    /// Showing enough to grow a toast out of.
    pub visible: bool,
    /// Center x, bottom, width and height in window points, as drawn.
    pub rect: [f32; 4],
    pub radius: f32,
    pub center_x: f32,
    /// The top of the collapsed pill, in window points.
    pub top_collapsed: f32,
    /// How much taller than collapsed the pill is, in points.
    pub grown: f32,
}

impl PillShape {
    pub fn of(frame: &Frame, status: PillStatus) -> Self {
        let [w, h, r] = frame.shell;
        let (sx, sy) = (frame.scale[0], frame.scale[1]);
        let center_x = PILL_ANCHOR.0;
        let bottom = PILL_ANCHOR.1 + frame.offset[1];
        Self {
            visible: status != PillStatus::Idle && frame.opacity > 0.5,
            rect: [center_x + frame.offset[0], bottom, w * sx, h * sy],
            radius: r * sx.min(sy),
            center_x,
            top_collapsed: PILL_ANCHOR.1 - COLLAPSED[1],
            grown: (h - COLLAPSED[1]).max(0.0),
        }
    }
}

/// The expanded pill's text: lines already shown, and the words that just arrived fading in.
struct Text {
    text: Arc<str>,
    scale: f32,
    height: f32,
    /// The rasterized area, in shell points from the text column's bottom left.
    size: (f32, f32),
    fresh_since: Instant,
    lines: Vec<Line>,
}

/// A laid out line and how far it still is from where it belongs, in points.
struct Line {
    top: f32,
    height: f32,
    glyphs: Vec<(usize, f32)>,
    shift: [Spring; 2],
}

pub(super) struct Painter {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    uniforms: wgpu::Buffer,
    sampler: wgpu::Sampler,
    bind_group: wgpu::BindGroup,
    text: Option<Text>,
    scissor: Option<[u32; 4]>,
}

impl Painter {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        format: wgpu::TextureFormat,
    ) -> anyhow::Result<Self> {
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (UNIFORM_FLOATS * 4) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device.create_shader_module(wgpu::include_wgsl!("pill.wgsl"));
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        if let Some(err) = tauri::async_runtime::block_on(scope.pop()) {
            anyhow::bail!("pipeline: {err}");
        }
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let empty = blank(device);
        let bind_group = bind(device, &pipeline, &uniforms, &empty, &empty, &sampler);
        Ok(Self {
            device: device.clone(),
            queue: queue.clone(),
            pipeline,
            uniforms,
            sampler,
            bind_group,
            text: None,
            scissor: None,
        })
    }

    /// Whether the text still moves on its own.
    pub fn animating(&self, now: Instant) -> bool {
        self.text.as_ref().is_some_and(|t| {
            t.lines.iter().flat_map(|l| &l.shift).any(|s| !s.settled())
                || now.duration_since(t.fresh_since).as_secs_f32() < FRESH_FADE
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        frame: &Frame,
        input: &Input,
        scale: f32,
        target: (u32, u32),
        engine: &mut TextEngine,
        now: Instant,
        dt: f32,
    ) {
        self.update_text(&input.text, scale, engine, now);
        let [w, h, r] = frame.shell;
        let mut lines = [0.0f32; 4 * LINES];
        let (fresh_y, text_rect, fresh_alpha) = match &mut self.text {
            Some(t) => {
                let image_top = t.height - t.size.1;
                let shown = t.lines.len().saturating_sub(LINES);
                for (line, slot) in t.lines[shown..].iter_mut().zip(lines.chunks_mut(4)) {
                    line.shift.iter_mut().for_each(|s| s.step(dt));
                    slot.copy_from_slice(&[
                        line.top - image_top,
                        line.top + line.height - image_top,
                        line.shift[0].x,
                        line.shift[1].x,
                    ]);
                }
                let p = (now.duration_since(t.fresh_since).as_secs_f32() / FRESH_FADE).min(1.0);
                let rise = if super::spring::reduced() {
                    0.0
                } else {
                    FRESH_RISE * (1.0 - p) * (1.0 - p)
                };
                // On whole pixels, so the text stays sharp at 1x and 1.5x; lines are 19.5 pt.
                let shell_left = PILL_ANCHOR.0 - w / 2.0;
                let shell_top = PILL_ANCHOR.1 - h;
                let snap = |v: f32| (v * scale).round() / scale;
                let rect = [
                    snap(shell_left + (w - TEXT_WIDTH) / 2.0) - shell_left,
                    snap(shell_top + h - TEXT_BOTTOM - t.size.1) - shell_top,
                    t.size.0,
                    t.size.1,
                ];
                (rise, rect, p)
            }
            None => (0.0, [0.0, 0.0, 1.0, 1.0], 0.0),
        };
        let mut data = [0.0f32; UNIFORM_FLOATS];
        data[..36].copy_from_slice(&[
            SIZE.0 as f32,
            SIZE.1 as f32,
            scale,
            0.0,
            frame.scale[0],
            frame.scale[1],
            frame.offset[0],
            frame.offset[1],
            frame.opacity,
            frame.base_level,
            frame.wave_fade,
            frame.mode,
            frame.pop_t,
            frame.pop_gain,
            frame.cleanup_gain,
            frame.seed,
            frame.flash,
            SHELL[0],
            SHELL[1],
            SHELL[2],
            w,
            h,
            r,
            frame.dots_alpha,
            PILL_ANCHOR.0,
            PILL_ANCHOR.1,
            frame.text_alpha,
            fresh_alpha,
            text_rect[0],
            text_rect[1],
            text_rect[2],
            text_rect[3],
            fresh_y,
            0.0,
            0.0,
            0.0,
        ]);
        data[36..36 + 4 * LINES].copy_from_slice(&lines);
        data[36 + 4 * LINES..36 + 4 * LINES + COLS].copy_from_slice(&frame.heights);
        let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_ne_bytes()).collect();
        self.queue.write_buffer(&self.uniforms, 0, &bytes);

        // The shell, its shadow and the error shake.
        let margin = 24.0;
        let half_w = w * frame.scale[0] / 2.0 + margin;
        let cx = PILL_ANCHOR.0 + frame.offset[0];
        let bottom = PILL_ANCHOR.1 + frame.offset[1];
        let top = bottom - h * frame.scale[1] - margin;
        let px = |v: f32| (v * scale).max(0.0);
        let x0 = px(cx - half_w).floor() as u32;
        let y0 = px(top).floor() as u32;
        let x1 = (px(cx + half_w).ceil() as u32).min(target.0);
        let y1 = (px(bottom + margin).ceil() as u32).min(target.1);
        self.scissor =
            (x1 > x0 && y1 > y0 && frame.opacity > 1e-3).then_some([x0, y0, x1 - x0, y1 - y0]);
    }

    pub fn draw(&self, pass: &mut wgpu::RenderPass) {
        let Some([x, y, w, h]) = self.scissor else {
            return;
        };
        pass.set_scissor_rect(x, y, w, h);
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    // Rasterizes the bottom lines of `text`: the part shown before in one image, the words
    // added since in another, so only those fade in. Each line starts where its first word
    // was and slides to its new place, up as lines are added and sideways as it re-centers.
    fn update_text(&mut self, text: &Arc<str>, scale: f32, engine: &mut TextEngine, now: Instant) {
        if text.is_empty() {
            if self.text.take().is_some() {
                let empty = blank(&self.device);
                self.bind_group = bind(
                    &self.device,
                    &self.pipeline,
                    &self.uniforms,
                    &empty,
                    &empty,
                    &self.sampler,
                );
            }
            return;
        }
        if self
            .text
            .as_ref()
            .is_some_and(|t| Arc::ptr_eq(&t.text, text) && t.scale == scale)
        {
            return;
        }
        let previous = self.text.take();
        let kept = previous.as_ref().map_or(0, |p| {
            p.text
                .char_indices()
                .zip(text.chars())
                .find(|((_, a), b)| a != b)
                .map_or(p.text.len().min(text.len()), |((i, _), _)| i)
        });
        let shaped = engine.shape_centered(text, Style::Pill, TEXT_WIDTH);
        let height = shaped.height;
        let pixels = (
            (TEXT_WIDTH * scale).ceil().max(1.0) as u32,
            (height.min(TEXT_KEEP) * scale).ceil().max(1.0) as u32,
        );
        // Whole pixels, so the image is sampled one texel per pixel and stays sharp.
        let size = (pixels.0 as f32 / scale, pixels.1 as f32 / scale);
        let top = height - size.1;
        let mut settled = Image::new(pixels.0, pixels.1);
        let mut fresh = Image::new(pixels.0, pixels.1);
        engine.draw_split(
            &shaped,
            (0.0, -top),
            [255, 255, 255],
            scale,
            kept,
            (&mut settled, &mut fresh),
        );
        let lines = text::lines(&shaped)
            .into_iter()
            .map(|line| {
                let mut shift = [Spring::at(0.0); 2];
                let was = previous.as_ref().and_then(|p| {
                    let &(byte, x) = line.glyphs.iter().find(|(b, _)| *b < kept)?;
                    p.where_was(byte)
                        .map(|(old_x, old_bottom)| (x, old_x, old_bottom))
                });
                // Bottom-anchored: a line's distance from the text's bottom is what stays put.
                if let Some((x, old_x, old_bottom)) = was {
                    shift[0] = Spring::at(old_x - x);
                    shift[1] = Spring::at((height - line.top) - old_bottom);
                }
                shift.iter_mut().for_each(|s| s.aim(0.0, LINE_SHIFT));
                Line {
                    top: line.top,
                    height: line.height,
                    glyphs: line.glyphs,
                    shift,
                }
            })
            .collect();
        let settled = upload(&self.device, &self.queue, &settled);
        let fresh = upload(&self.device, &self.queue, &fresh);
        self.bind_group = bind(
            &self.device,
            &self.pipeline,
            &self.uniforms,
            &settled,
            &fresh,
            &self.sampler,
        );
        self.text = Some(Text {
            text: text.clone(),
            scale,
            height,
            size,
            fresh_since: if kept < text.len() {
                now
            } else {
                previous.map_or(now, |p| p.fresh_since)
            },
            lines,
        });
    }
}

impl Text {
    // Where the glyph for `byte` is drawn now: its x, and its line top's distance from the
    // text's bottom, both with the line's slide so far.
    fn where_was(&self, byte: usize) -> Option<(f32, f32)> {
        self.lines.iter().find_map(|line| {
            let &(_, x) = line.glyphs.iter().find(|(b, _)| *b == byte)?;
            Some((
                x + line.shift[0].x,
                self.height - line.top - line.shift[1].x,
            ))
        })
    }
}

fn blank(device: &wgpu::Device) -> wgpu::TextureView {
    texture(device, 1, 1).create_view(&Default::default())
}

fn texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        // The pixels are sRGB-encoded and blend as stored, like the browser's canvas.
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn upload(device: &wgpu::Device, queue: &wgpu::Queue, image: &Image) -> wgpu::TextureView {
    let max = device.limits().max_texture_dimension_2d;
    let tex = texture(device, image.width.min(max), image.height.min(max));
    queue.write_texture(
        tex.as_image_copy(),
        &image.pixels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(image.width * 4),
            rows_per_image: None,
        },
        tex.size(),
    );
    tex.create_view(&Default::default())
}

fn bind(
    device: &wgpu::Device,
    pipeline: &wgpu::RenderPipeline,
    uniforms: &wgpu::Buffer,
    settled: &wgpu::TextureView,
    fresh: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniforms.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(settled),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(fresh),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}
