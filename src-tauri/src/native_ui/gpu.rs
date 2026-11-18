use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};

/// The one wgpu device every native window draws with.
pub struct Gpu {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

static LOST: AtomicBool = AtomicBool::new(false);

/// False once the device or a surface is lost. Recovering would mean new devices and
/// surfaces mid-dictation, so the webview pill and toast take over for the session.
pub fn usable() -> bool {
    !LOST.load(Ordering::Relaxed)
}

pub fn mark_lost(why: &str) {
    if !LOST.swap(true, Ordering::Relaxed) {
        tracing::error!("[NativeUI] {why}; the webview pill and toast take over");
    }
}

static GPU: LazyLock<Result<Gpu, String>> =
    LazyLock::new(|| create().map_err(|err| format!("{err:#}")));

pub fn get() -> anyhow::Result<&'static Gpu> {
    GPU.as_ref().map_err(|err| anyhow::anyhow!("{err}"))
}

fn create() -> anyhow::Result<Gpu> {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::METAL | wgpu::Backends::DX12;
    // DirectComposition is the DX12 path that keeps a transparent window transparent.
    desc.backend_options.dx12.presentation_system = wgpu::Dx12SwapchainKind::DxgiFromVisual;
    let instance = wgpu::Instance::new(desc);
    let adapter =
        tauri::async_runtime::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            ..Default::default()
        }))?;
    let (device, queue) =
        tauri::async_runtime::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))?;
    device.on_uncaptured_error(Arc::new(|err| {
        tracing::error!("[NativeUI] {err}");
    }));
    device.set_device_lost_callback(|reason, message| {
        mark_lost(&format!("GPU device lost ({reason:?}): {message}"));
    });
    Ok(Gpu {
        instance,
        adapter,
        device,
        queue,
    })
}
