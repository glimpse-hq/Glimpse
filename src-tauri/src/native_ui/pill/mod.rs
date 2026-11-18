//! The pill drawn with wgpu in a window of our own.

mod anim;

use super::a11y::{self, A11y};
use super::gpu::{self, Gpu};
use super::window::{NativeWindow, Options, ScreenChoice};
use crate::AppRuntime;
use crate::pill::PillStatus;
use accesskit::{Node, NodeId, Role, TreeId, TreeInfo, TreeUpdate};
use anim::{Anim, COLS, Frame, Input};
use parking_lot::{Condvar, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, PhysicalPosition, PhysicalRect, Position};

// Same size as the webview pill window, so the two can trade places.
const SIZE: (f64, f64) = (300.0, 190.0);
const BOTTOM_MARGIN: f64 = 69.0;
// --ui-pill-shell-rgb: Windows draws the shell darker.
#[cfg(target_os = "macos")]
const SHELL: [f32; 3] = [10.0 / 255.0, 10.0 / 255.0, 12.0 / 255.0];
#[cfg(target_os = "windows")]
const SHELL: [f32; 3] = [4.0 / 255.0, 4.0 / 255.0, 5.0 / 255.0];
const UNIFORM_FLOATS: usize = 20 + COLS.next_multiple_of(4);

struct Renderer {
    app: AppHandle<AppRuntime>,
    window: NativeWindow,
    input: Mutex<Shared>,
    wake: Condvar,
    expanded: AtomicBool,
    a11y: Option<A11y>,
    // Counts status changes; the status node gets a new id each time, so it's announced.
    changes: AtomicU64,
}

struct Shared {
    input: Input,
    // Frames drawn while the window is off screen hold their drawables on macOS,
    // which stalls the next acquire after the window comes back.
    on_screen: bool,
}

static RENDERER: OnceLock<Renderer> = OnceLock::new();

fn renderer() -> Option<&'static Renderer> {
    RENDERER.get()
}

// The native pill's window while it, not the webview, is showing the pill.
pub(super) fn window() -> Option<&'static NativeWindow> {
    renderer()
        .filter(|r| !r.expanded.load(Ordering::Relaxed) && gpu::usable())
        .map(|r| &r.window)
}

// Where the pill is, even while the webview shows the live transcript in its place.
pub(super) fn placed_window() -> Option<&'static NativeWindow> {
    renderer().filter(|_| gpu::usable()).map(|r| &r.window)
}

pub fn init(app: &AppHandle<AppRuntime>) {
    if let Err(err) = start(app) {
        tracing::error!("[PillRenderer] falling back to the webview pill: {err:#}");
    }
}

fn start(app: &AppHandle<AppRuntime>) -> anyhow::Result<()> {
    let window = NativeWindow::new(
        app,
        Options {
            size: SIZE,
            interactive: false,
        },
    )?;
    let gpu = gpu::get()?;
    let surface = gpu.instance.create_surface(window.clone())?;
    let caps = surface.get_capabilities(&gpu.adapter);
    let format = caps
        .formats
        .iter()
        .copied()
        .find(|f| !f.is_srgb())
        .ok_or_else(|| anyhow::anyhow!("no surface format"))?;
    // The shader writes premultiplied color; Metal only lists PostMultiplied but composites it the same way.
    let alpha_mode = [
        wgpu::CompositeAlphaMode::PreMultiplied,
        wgpu::CompositeAlphaMode::PostMultiplied,
    ]
    .into_iter()
    .find(|m| caps.alpha_modes.contains(m))
    .ok_or_else(|| anyhow::anyhow!("surface can't be transparent"))?;
    let painter = Painter::new(gpu, surface, format, alpha_mode)?;
    let tree_app = app.clone();
    let a11y = A11y::attach(
        app,
        &window,
        Arc::new(move || status_tree(&tree_app)),
        Arc::new(|_| {}),
    )
    .inspect_err(|err| tracing::error!("[PillRenderer] no screen reader access: {err:#}"))
    .ok();

    let _ = RENDERER.set(Renderer {
        app: app.clone(),
        window,
        input: Mutex::new(Shared {
            input: Input::default(),
            on_screen: false,
        }),
        wake: Condvar::new(),
        expanded: AtomicBool::new(false),
        a11y,
        changes: AtomicU64::new(0),
    });
    std::thread::Builder::new()
        .name("pill-renderer".into())
        .spawn(move || render_loop(painter))?;
    Ok(())
}

fn update(apply: impl FnOnce(&mut Shared)) {
    if let Some(r) = renderer() {
        apply(&mut r.input.lock());
        r.wake.notify_one();
    }
}

pub fn set_status(status: PillStatus) {
    if status == PillStatus::Idle {
        set_expanded(false);
    }
    let mut changed = false;
    update(|s| {
        changed = s.input.status != status;
        s.input.status = status;
        if matches!(status, PillStatus::Idle | PillStatus::Listening) {
            s.input.cleanup = false;
            s.input.bins_at = None;
        }
    });
    if changed && let Some(r) = renderer() {
        r.changes.fetch_add(1, Ordering::Relaxed);
        if let Some(a11y) = &r.a11y {
            a11y.refresh();
        }
        if let Some(key) = status_key(status) {
            a11y::announce(&r.app, crate::toast::native(&r.app, key), false);
        }
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

// The webview pill's polite live region: "Listening...", "Processing...", "Error occurred".
fn status_tree(app: &AppHandle<AppRuntime>) -> TreeUpdate {
    const ROOT: NodeId = NodeId(1);
    let mut root = Node::new(Role::Group);
    let mut nodes = Vec::new();
    if let Some(r) = renderer()
        && let Some(key) = status_key(r.input.lock().input.status)
    {
        let mut status = Node::new(Role::Status);
        a11y::live(&mut status, false);
        status.set_label(crate::toast::native(app, key));
        let id = NodeId(2 + r.changes.load(Ordering::Relaxed));
        root.push_child(id);
        nodes.push((id, status));
    }
    nodes.push((ROOT, root));
    TreeUpdate {
        nodes,
        tree: Some(TreeInfo::new(ROOT)),
        tree_id: TreeId::ROOT,
        focus: ROOT,
    }
}

pub fn set_cleanup(cleanup: bool) {
    update(|s| s.input.cleanup = cleanup);
}

pub fn set_spectrum(bins: &[u8]) {
    update(|s| {
        s.input.bins.clear();
        s.input.bins.extend_from_slice(bins);
        s.input.bins_at = Some(Instant::now());
    });
}

pub fn set_hover(hovering: bool) {
    update(|s| s.input.hovering = hovering);
}

/// Streaming's live transcript needs text, which only the webview pill draws for now.
/// Returns true when the hand-off between the two windows changed.
pub fn set_expanded(expanded: bool) -> bool {
    renderer().is_some_and(|r| r.expanded.swap(expanded, Ordering::Relaxed) != expanded)
}

/// Shows the native pill on the screen under the cursor; false when the webview pill is in charge.
pub fn show() -> bool {
    let Some(window) = window() else {
        return false;
    };
    window.place_bottom_center(ScreenChoice::UnderCursor, BOTTOM_MARGIN);
    present(window);
    true
}

/// Takes over from the webview pill at its top-left corner, as Tauri reports it at `scale`.
pub fn show_at(position: PhysicalPosition<i32>, scale: f64) {
    if let Some(window) = window() {
        window.set_position_physical(position, scale);
        present(window);
    }
}

// Runs after the move on the main thread, so drawing starts at the new size and scale.
fn present(window: &'static NativeWindow) {
    window.show(|| update(|s| s.on_screen = true));
}

pub fn hide() {
    let Some(r) = renderer() else { return };
    update(|s| s.on_screen = false);
    // Again right before it goes, in case a show queued before it turned drawing back on.
    r.window.hide(|| {
        update(|s| s.on_screen = false);
        true
    });
}

/// Where a webview pill takes over from the native one.
pub fn position() -> Option<Position> {
    window().map(NativeWindow::position)
}

/// The native pill's frame in physical pixels and its scale, while it is showing the pill.
pub fn frame() -> Option<(PhysicalRect<i32, u32>, f64)> {
    window().map(|w| (w.frame_physical(), w.metrics().2))
}

pub fn contains_cursor() -> Option<bool> {
    window().map(NativeWindow::contains_cursor)
}

/// The window id, whether it is on screen, its frame and its scale, for `glimpse dev window pill info`.
#[cfg(debug_assertions)]
pub fn info() -> Option<(i64, bool, PhysicalRect<i32, u32>, f64)> {
    let window = window()?;
    let on_screen = renderer()?.input.lock().on_screen;
    Some((
        window.native_id(),
        on_screen,
        window.frame_physical(),
        window.metrics().2,
    ))
}

struct Painter {
    device: &'static wgpu::Device,
    queue: &'static wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    uniforms: wgpu::Buffer,
}

impl Painter {
    fn new(
        gpu: &'static Gpu,
        surface: wgpu::Surface<'static>,
        format: wgpu::TextureFormat,
        alpha_mode: wgpu::CompositeAlphaMode,
    ) -> anyhow::Result<Self> {
        let Gpu { device, queue, .. } = gpu;
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
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniforms.as_entire_binding(),
            }],
        });
        if let Some(err) = tauri::async_runtime::block_on(scope.pop()) {
            anyhow::bail!("pipeline: {err}");
        }
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: 1,
            height: 1,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode,
            color_space: wgpu::SurfaceColorSpace::Auto,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        Ok(Self {
            device,
            queue,
            surface,
            config,
            pipeline,
            bind_group,
            uniforms,
        })
    }

    fn draw(&mut self, frame: &Frame, (width, height, scale): (u32, u32, f32)) {
        if width == 0 || height == 0 {
            return;
        }
        if (self.config.width, self.config.height) != (width, height) {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(self.device, &self.config);
        }
        let mut data = [0.0f32; UNIFORM_FLOATS];
        data[..20].copy_from_slice(&[
            width as f32 / scale,
            height as f32 / scale,
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
        ]);
        data[20..20 + COLS].copy_from_slice(&frame.heights);
        let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_ne_bytes()).collect();
        self.queue.write_buffer(&self.uniforms, 0, &bytes);

        let texture = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(self.device, &self.config);
                return;
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                gpu::mark_lost("the pill's surface was lost");
                hide();
                return;
            }
            // Covered or not on screen yet: try again next frame instead of spinning.
            _ => {
                std::thread::sleep(std::time::Duration::from_millis(8));
                return;
            }
        };
        let view = texture.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        self.queue.present(texture);
    }
}

// Fifo presentation paces this loop to the display; it sleeps once the pill is idle and faded.
fn render_loop(mut painter: Painter) {
    let Some(r) = renderer() else { return };
    let mut anim = Anim::new();
    let mut last = Instant::now();
    let mut frame_start = None;
    loop {
        let input = {
            let mut shared = r.input.lock();
            loop {
                anim.observe(&shared.input, Instant::now());
                if shared.on_screen && gpu::usable() && anim.animating(&shared.input) {
                    break;
                }
                r.wake.wait(&mut shared);
                last = Instant::now();
                frame_start = None;
            }
            shared.input.clone()
        };
        super::pace(&mut frame_start);
        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f32().min(0.05);
        last = now;
        let frame = anim.step(&input, now, dt);
        // Read every frame, so a display scale change mid-dictation is followed.
        let (width, height, scale) = r.window.metrics();
        painter.draw(&frame, (width, height, scale as f32));
    }
}
