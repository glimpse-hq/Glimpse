use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// The wgpu device the overlay draws with. A lost device is replaced by a new one.
pub struct Gpu {
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    lost: Arc<AtomicBool>,
}

impl Gpu {
    pub fn lost(&self) -> bool {
        self.lost.load(Ordering::Relaxed)
    }

    pub fn mark_lost(&self, why: &str) {
        if !self.lost.swap(true, Ordering::Relaxed) {
            tracing::error!("[NativeUI] {why}; starting over with a new device");
        }
    }
}

pub fn instance() -> wgpu::Instance {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::METAL | wgpu::Backends::DX12;
    // DirectComposition is the DX12 path that keeps a transparent window transparent.
    desc.backend_options.dx12.presentation_system = wgpu::Dx12SwapchainKind::DxgiFromVisual;
    wgpu::Instance::new(desc)
}

pub fn create(instance: &wgpu::Instance, surface: &wgpu::Surface) -> anyhow::Result<Gpu> {
    let request = |force_fallback_adapter| {
        tauri::async_runtime::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            force_fallback_adapter,
            compatible_surface: Some(surface),
            ..Default::default()
        }))
    };
    // Windows without a usable GPU (some VMs and remote sessions) still has the WARP software adapter.
    let adapter = request(false).or_else(|err| {
        tracing::warn!("[NativeUI] no GPU adapter ({err}), trying the software one");
        request(true)
    })?;
    let (device, queue) =
        tauri::async_runtime::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))?;
    device.on_uncaptured_error(Arc::new(|err| {
        tracing::error!("[NativeUI] {err}");
    }));
    let lost = Arc::new(AtomicBool::new(false));
    let flag = lost.clone();
    device.set_device_lost_callback(move |reason, message| {
        if !flag.swap(true, Ordering::Relaxed) {
            tracing::error!("[NativeUI] GPU device lost ({reason:?}): {message}");
        }
    });
    Ok(Gpu {
        adapter,
        device,
        queue,
        lost,
    })
}
