//! Draws a laid out toast with wgpu: text rasterized once into a texture, everything else in toast.wgsl.

use super::layout::{Hit, Layout, Rect, Role, SCROLLBAR, ToastContent, ToastKind};
use crate::native_ui::Pace;
use crate::native_ui::text::{Image, TextEngine};

const UNIFORM_FLOATS: usize = 64;
pub const RADIUS: f32 = 16.0;
const EXPO_OUT: [f32; 4] = [0.16, 1.0, 0.3, 1.0];
const EASE_IN: [f32; 4] = [0.42, 0.0, 1.0, 1.0];
const PULSE: [f32; 4] = [0.4, 0.0, 0.6, 1.0];
const TOAST_IN: f32 = 0.25;
const TOAST_OUT: f32 = 0.15;
const ASK_IN: f32 = 0.34;
const REVEAL: f32 = 0.28;
const REVEAL_DELAY: f32 = 0.06;
const REVEAL_LATE_DELAY: f32 = 0.12;
const RING_DELAY: f32 = 0.18;
const RING: f32 = 0.7;
const PULSE_PERIOD: f32 = 2.0;

const GRAY_200: [u8; 3] = [229, 231, 235];
const GRAY_500: [u8; 3] = [107, 114, 128];
const MUTED: [u8; 3] = [133, 133, 143];
const WHITE: [u8; 3] = [255, 255, 255];
const ACCENT: [u8; 3] = [143, 111, 247];
const CLOUD: [u8; 3] = [251, 191, 36];
const INFO_STRONG: [u8; 3] = [96, 165, 250];
const ERROR: [u8; 3] = [239, 68, 68];
const ERROR_SOFT: [u8; 3] = [252, 165, 165];
const ERROR_STRONG: [u8; 3] = [248, 113, 113];

/// What changes between frames of one toast.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct ToastView {
    pub hovered: Option<Hit>,
    pub copied: bool,
    pub scroll: f32,
    pub age: f32,
    pub leaving: Option<f32>,
    /// Plays the toast-in or ask-in entrance; off when it grows out of the pill or another toast.
    pub keyframes: bool,
    /// The card as drawn, in window points.
    pub shape: Rect,
    pub radius: f32,
    /// Where layout point (0, 0) is drawn, in window points.
    pub offset: (f32, f32),
    pub bump: f32,
    pub content_alpha: f32,
    pub card_alpha: f32,
    /// The border color and alpha while it changes from another toast's.
    pub border: Option<([f32; 3], f32)>,
}

#[derive(PartialEq)]
struct TextKey {
    content: ToastContent,
    scale: f32,
    hovered: Option<Hit>,
    size: (u32, u32),
}

struct TextLayer {
    key: TextKey,
    size: (u32, u32),
    bind_group: wgpu::BindGroup,
}

pub struct ToastRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    uniforms: wgpu::Buffer,
    sampler: wgpu::Sampler,
    text: Option<TextLayer>,
    scissor: Option<[u32; 4]>,
}

impl ToastRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (UNIFORM_FLOATS * 4) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let shader = device.create_shader_module(wgpu::include_wgsl!("toast.wgsl"));
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            device,
            queue,
            pipeline,
            uniforms,
            sampler,
            text: None,
            scissor: None,
        }
    }

    /// How soon the next frame can differ from this one without new input.
    pub fn pace(content: &ToastContent, view: &ToastView) -> Pace {
        let looping = matches!(
            content.kind,
            ToastKind::Error | ToastKind::Update | ToastKind::Celebration
        );
        let entering = view.keyframes
            && match content.kind {
                ToastKind::Ask => view.age < RING_DELAY + RING,
                _ => view.age < TOAST_IN,
            };
        if view.leaving.is_some_and(|t| t < TOAST_OUT) || entering {
            Pace::Moving
        } else if looping {
            Pace::Ambient
        } else {
            Pace::Still
        }
    }

    /// Gets one frame ready to draw into a `target` of `target` pixels at `scale` pixels per point.
    pub fn prepare(
        &mut self,
        layout: &Layout,
        content: &ToastContent,
        view: &ToastView,
        scale: f32,
        target: (u32, u32),
        engine: &mut TextEngine,
    ) {
        let size = (
            (layout.window.0 * scale).round() as u32,
            ((layout.window.1 + layout.max_scroll) * scale).ceil() as u32,
        );
        let key = TextKey {
            content: content.clone(),
            scale,
            hovered: view
                .hovered
                .filter(|h| matches!(h, Hit::Action | Hit::Secondary)),
            size,
        };
        if self.text.as_ref().is_none_or(|t| t.key != key) {
            self.text = Some(self.rasterize(key, layout, content, scale, engine));
        }
        let Some(text) = &self.text else { return };

        let data = uniforms(layout, content, view, scale, text.size);
        let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_ne_bytes()).collect();
        self.queue.write_buffer(&self.uniforms, 0, &bytes);

        // Room for toast-in's lift and ask-in's blur around the card.
        let margin = 24.0;
        let r = view.shape;
        let lift = 18.0 * view.bump.max(1.0);
        let px = |v: f32| (v * scale).max(0.0);
        let x0 = px(r.x - margin).floor() as u32;
        let y0 = px(r.y - margin).floor() as u32;
        let x1 = (px(r.x + r.w + margin).ceil() as u32).min(target.0);
        let y1 = (px(r.y + r.h + margin + lift).ceil() as u32).min(target.1);
        self.scissor = (x1 > x0 && y1 > y0).then_some([x0, y0, x1 - x0, y1 - y0]);
    }

    pub fn draw(&self, pass: &mut wgpu::RenderPass) {
        let (Some(text), Some([x, y, w, h])) = (&self.text, self.scissor) else {
            return;
        };
        pass.set_scissor_rect(x, y, w, h);
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &text.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }

    fn rasterize(
        &self,
        key: TextKey,
        layout: &Layout,
        content: &ToastContent,
        scale: f32,
        engine: &mut TextEngine,
    ) -> TextLayer {
        let max = self.device.limits().max_texture_dimension_2d;
        let size = (key.size.0.clamp(1, max), key.size.1.clamp(1, max));
        let mut image = Image::new(size.0, size.1);
        for block in &layout.blocks {
            let color = text_color(content, block.role, key.hovered);
            engine.draw(&block.text, (block.x, block.y), color, scale, &mut image);
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            // The pixels are sRGB-encoded and blend as stored, like the browser's canvas.
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            texture.as_image_copy(),
            &image.pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size.0 * 4),
                rows_per_image: None,
            },
            texture.size(),
        );
        let texture_view = texture.create_view(&Default::default());
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniforms.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        TextLayer {
            key,
            size,
            bind_group,
        }
    }
}

fn text_color(content: &ToastContent, role: Role, hovered: Option<Hit>) -> [u8; 3] {
    match role {
        Role::Header => ACCENT,
        Role::Title | Role::Detail => GRAY_500,
        Role::Message => GRAY_200,
        Role::Action if hovered == Some(Hit::Action) => WHITE,
        Role::Action => match content.kind {
            ToastKind::Update => ACCENT,
            ToastKind::Ask => CLOUD,
            _ => INFO_STRONG,
        },
        Role::Secondary if content.kind == ToastKind::Ask => {
            if hovered == Some(Hit::Secondary) {
                WHITE
            } else {
                MUTED
            }
        }
        Role::Secondary => match (content.secondary_is_copy, hovered == Some(Hit::Secondary)) {
            (true, true) => WHITE,
            (true, false) => INFO_STRONG,
            (false, true) => ERROR_STRONG,
            (false, false) => ERROR_SOFT,
        },
    }
}

// The border color and alpha over the black card, and the dot, as App.css overrides those Tailwind classes.
fn kind_colors(kind: ToastKind) -> ([u8; 3], f32, [u8; 3]) {
    match kind {
        ToastKind::Error => (ERROR, 0.4, ERROR),
        ToastKind::Info => ([59, 130, 246], 0.3, INFO_STRONG),
        ToastKind::Success => ([16, 185, 129], 0.3, [52, 211, 153]),
        ToastKind::Warning | ToastKind::Ask => (CLOUD, 0.5, CLOUD),
        ToastKind::Update => ([139, 92, 246], 0.4, ACCENT),
        ToastKind::Celebration => (CLOUD, 0.3, CLOUD),
    }
}

fn uniforms(
    layout: &Layout,
    content: &ToastContent,
    view: &ToastView,
    scale: f32,
    text_size: (u32, u32),
) -> [f32; UNIFORM_FLOATS] {
    let card = layout.card;
    let shape = view.shape;
    let ask = content.kind == ToastKind::Ask;
    let progress = |t: f32, delay: f32, duration: f32, ease: [f32; 4]| {
        cubic_bezier(ease, ((t - delay) / duration).clamp(0.0, 1.0))
    };

    // toast-in and toast-out scale around the card's center, ask-in around its bottom.
    let (mut lift, mut zoom, mut opacity, mut blur) = if !view.keyframes {
        (0.0, 1.0, 1.0, 0.0)
    } else if crate::native_ui::spring::reduced() {
        let p = progress(view.age, 0.0, TOAST_IN, EXPO_OUT);
        (0.0, 1.0, p, 0.0)
    } else if ask {
        let p = progress(view.age, 0.0, ASK_IN, EXPO_OUT);
        (18.0 * (1.0 - p), 0.96 + 0.04 * p, p, 6.0 * (1.0 - p))
    } else {
        let p = progress(view.age, 0.0, TOAST_IN, EXPO_OUT);
        (12.0 * (1.0 - p), 0.92 + 0.08 * p, p, 0.0)
    };
    let mut origin = if ask && view.keyframes {
        shape.y + shape.h
    } else {
        shape.y + shape.h * 0.5
    };
    if let Some(t) = view.leaving {
        let p = progress(t, 0.0, TOAST_OUT, EASE_IN);
        let motion = if crate::native_ui::spring::reduced() {
            0.0
        } else {
            1.0
        };
        (lift, zoom, opacity, blur) = (12.0 * p * motion, 1.0 - 0.08 * p * motion, 1.0 - p, 0.0);
        origin = shape.y + shape.h * 0.5;
    }

    let still = crate::native_ui::spring::reduced();
    let rise = if still { 0.0 } else { 5.0 };
    let (reveal, reveal_late) = if ask && view.keyframes {
        (
            progress(view.age, REVEAL_DELAY, REVEAL, EXPO_OUT),
            progress(view.age, REVEAL_LATE_DELAY, REVEAL, EXPO_OUT),
        )
    } else {
        (1.0, 1.0)
    };
    let (ring_spread, ring_alpha) =
        if ask && !still && (RING_DELAY..RING_DELAY + RING).contains(&view.age) {
            let p = progress(view.age, RING_DELAY, RING, EXPO_OUT);
            (9.0 * p, 0.6 * (1.0 - p))
        } else {
            (0.0, 0.0)
        };
    let marker_opacity = if content.kind == ToastKind::Error {
        let phase = (view.age / PULSE_PERIOD).fract() * 2.0;
        if phase < 1.0 {
            1.0 - 0.5 * cubic_bezier(PULSE, phase)
        } else {
            0.5 + 0.5 * cubic_bezier(PULSE, phase - 1.0)
        }
    } else {
        1.0
    };
    let twinkle = match content.kind {
        ToastKind::Celebration => 1.0,
        ToastKind::Update => 2.0,
        _ => 0.0,
    };

    // The text is one texel per pixel, so it stays sharp only on whole pixels: at 1x or 1.5x
    // a card centered at a fractional width would otherwise sit between them.
    let snap = |v: f32| (v * scale).round() / scale;
    let scroll = snap(view.scroll.clamp(0.0, layout.max_scroll));
    let (thumb_y, thumb_h, track_x) = if layout.max_scroll > 0.0 {
        let track = card.h - 2.0;
        let thumb = track * track / (track + layout.max_scroll);
        let y = card.y + 1.0 + (track - thumb) * scroll / layout.max_scroll;
        (y, thumb, card.x + card.w - 1.0 - SCROLLBAR)
    } else {
        (0.0, 0.0, 0.0)
    };

    let (border, border_alpha, dot) = kind_colors(content.kind);
    let unit = |c: u8| f32::from(c) / 255.0;
    let (border, border_alpha) = view
        .border
        .unwrap_or_else(|| (border.map(unit), border_alpha));
    let hovered = |hit| f32::from(u8::from(view.hovered == Some(hit)));
    let copy_icon = match (layout.copy.is_some(), view.copied) {
        (false, _) => 0.0,
        (true, false) => 1.0,
        (true, true) => 2.0,
    };
    let copy = layout.copy.unwrap_or_default();
    let (sx, sy) = layout.secondary_icon.unwrap_or_default();
    let m = layout.marker;
    [
        layout.window.0,
        layout.window.1,
        scale,
        scroll,
        card.x,
        card.y,
        card.w,
        card.h,
        lift,
        zoom,
        origin,
        opacity,
        blur,
        view.age,
        twinkle,
        marker_opacity,
        border[0],
        border[1],
        border[2],
        border_alpha,
        m.x,
        m.y,
        m.w,
        m.h,
        unit(dot[0]),
        unit(dot[1]),
        unit(dot[2]),
        f32::from(u8::from(content.kind == ToastKind::Update)),
        ring_spread,
        ring_alpha,
        thumb_y,
        thumb_h,
        reveal,
        rise * (1.0 - reveal),
        reveal_late,
        rise * (1.0 - reveal_late),
        layout.reveal_split,
        track_x,
        text_size.0 as f32,
        text_size.1 as f32,
        layout.close.x,
        layout.close.y,
        0.0,
        hovered(Hit::Close),
        copy.x,
        copy.y,
        copy_icon,
        hovered(Hit::Copy),
        sx,
        sy,
        f32::from(u8::from(layout.secondary_icon.is_some())),
        hovered(Hit::Secondary),
        shape.x,
        shape.y,
        shape.w,
        shape.h,
        snap(view.offset.0),
        snap(view.offset.1),
        view.content_alpha,
        view.card_alpha,
        view.radius,
        view.bump,
        0.0,
        0.0,
    ]
}

/// A kind's border color, in 0-1 RGB, and alpha.
pub fn border_of(kind: ToastKind) -> ([f32; 3], f32) {
    let (rgb, alpha, _) = kind_colors(kind);
    (rgb.map(|c| f32::from(c) / 255.0), alpha)
}

// CSS cubic-bezier(x1, y1, x2, y2) at progress `x`.
fn cubic_bezier([x1, y1, x2, y2]: [f32; 4], x: f32) -> f32 {
    let curve = |a: f32, b: f32, t: f32| {
        let u = 1.0 - t;
        3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
    };
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..24 {
        let mid = (lo + hi) * 0.5;
        if curve(x1, x2, mid) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    curve(y1, y2, (lo + hi) * 0.5)
}
