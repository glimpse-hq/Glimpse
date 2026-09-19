//! System audio via Core Audio process taps (macOS 14.2+). A tap mixes the
//! output of chosen processes; reading it requires a private aggregate device.

use std::{ffi::c_void, mem, ptr::NonNull};

use anyhow::{Result, anyhow};
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSApplicationActivationPolicy, NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication,
};
use objc2_core_audio::{
    AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart,
    AudioDeviceStop, AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
    AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap,
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
    AudioObjectPropertyAddress, AudioObjectPropertySelector, CATapDescription,
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey,
    kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey,
    kAudioAggregateDeviceUIDKey, kAudioHardwarePropertyProcessObjectList,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    kAudioProcessPropertyBundleID, kAudioProcessPropertyPID, kAudioSubTapDriftCompensationKey,
    kAudioSubTapUIDKey, kAudioTapPropertyFormat,
};
use objc2_core_audio_types::{AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
use objc2_core_foundation::{CFDictionary, CFString};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSProcessInfo, NSRect, NSString};

use super::{AudioApp, SystemAudioScope};

const MIN_MACOS: (isize, isize) = (14, 2);
const APP_ICON_POINTS: f64 = 32.0;

pub(crate) fn supported() -> bool {
    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    (version.majorVersion, version.minorVersion) >= MIN_MACOS
}

pub(crate) fn app_selection_supported() -> bool {
    supported()
}

pub(crate) fn permission_settings_url() -> &'static str {
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"
}

struct AudioProcess {
    object_id: AudioObjectID,
    pid: i32,
    bundle_id: Option<String>,
}

/// Every process Core Audio knows about. Apps only appear here once they
/// have touched audio, which is exactly the "available" set the picker wants.
fn audio_processes() -> Result<Vec<AudioProcess>> {
    let object_ids: Vec<AudioObjectID> = read_property_array(
        kAudioObjectSystemObject as AudioObjectID,
        kAudioHardwarePropertyProcessObjectList,
    )?;
    Ok(object_ids
        .into_iter()
        .filter_map(|object_id| {
            let pid: i32 = read_property(object_id, kAudioProcessPropertyPID).ok()?;
            let bundle_id =
                read_property::<*const CFString>(object_id, kAudioProcessPropertyBundleID)
                    .ok()
                    .and_then(|ptr| {
                        if ptr.is_null() {
                            return None;
                        }
                        // Core Audio hands back a +1 reference.
                        let string = unsafe { Retained::from_raw(ptr as *mut CFString) }?;
                        Some(string.to_string())
                    })
                    .filter(|value| !value.is_empty());
            Some(AudioProcess {
                object_id,
                pid,
                bundle_id,
            })
        })
        .collect())
}

/// Helper processes (Chrome renderers, Electron utilities, WebKit GPU) own the
/// audio, so each process is folded into the app the user would recognise.
fn resolve_app(process: &AudioProcess) -> Option<Retained<NSRunningApplication>> {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(process.pid)
        && app.activationPolicy() == NSApplicationActivationPolicy::Regular
    {
        return Some(app);
    }
    let bundle_id = process.bundle_id.as_deref()?;
    if bundle_id.starts_with("com.apple.WebKit") {
        return regular_app_with_bundle_id("com.apple.Safari");
    }
    let mut candidate = bundle_id.to_string();
    for _ in 0..3 {
        let Some(cut) = candidate.rfind('.') else {
            break;
        };
        candidate.truncate(cut);
        if let Some(app) = regular_app_with_bundle_id(&candidate) {
            return Some(app);
        }
    }
    None
}

fn regular_app_with_bundle_id(bundle_id: &str) -> Option<Retained<NSRunningApplication>> {
    let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(
        bundle_id,
    ));
    apps.iter()
        .find(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular)
}

fn app_key(app: &NSRunningApplication) -> Option<String> {
    app.bundleIdentifier()
        .map(|id| id.to_string())
        .or_else(|| Some(format!("pid:{}", app.processIdentifier())))
}

pub(crate) fn list_apps() -> Result<Vec<AudioApp>> {
    let own_pid = std::process::id() as i32;
    let mut apps: Vec<AudioApp> = Vec::new();
    for process in audio_processes()? {
        if process.pid == own_pid {
            continue;
        }
        let Some(app) = resolve_app(&process) else {
            continue;
        };
        if app.processIdentifier() == own_pid {
            continue;
        }
        let Some(id) = app_key(&app) else {
            continue;
        };
        if apps.iter().any(|entry| entry.id == id) {
            continue;
        }
        let Some(name) = app.localizedName().map(|name| name.to_string()) else {
            continue;
        };
        apps.push(AudioApp {
            id,
            name,
            icon: app.icon().and_then(|icon| icon_data_url(&icon)),
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

fn icon_data_url(icon: &objc2_app_kit::NSImage) -> Option<String> {
    let mut rect = NSRect::new(
        objc2_foundation::NSPoint::new(0.0, 0.0),
        objc2_foundation::NSSize::new(APP_ICON_POINTS, APP_ICON_POINTS),
    );
    let cg_image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.to_vec());
    Some(format!("data:image/png;base64,{encoded}"))
}

fn process_object_ids_for_scope(scope: &SystemAudioScope) -> Result<Vec<AudioObjectID>> {
    let own_pid = std::process::id() as i32;
    let processes = audio_processes()?;
    Ok(match scope {
        SystemAudioScope::All => processes
            .iter()
            .filter(|process| process.pid == own_pid)
            .map(|process| process.object_id)
            .collect(),
        SystemAudioScope::Apps(selected) => processes
            .iter()
            .filter(|process| process.pid != own_pid)
            .filter(|process| {
                resolve_app(process)
                    .and_then(|app| app_key(&app))
                    .is_some_and(|key| selected.contains(&key))
            })
            .map(|process| process.object_id)
            .collect(),
    })
}

struct IoContext {
    sink: Box<dyn FnMut(&[f32]) + Send>,
    mono: Vec<f32>,
}

unsafe extern "C-unwind" fn io_proc(
    _device: AudioObjectID,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    _output: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    client_data: *mut c_void,
) -> i32 {
    if client_data.is_null() {
        return 0;
    }
    let ctx = unsafe { &mut *(client_data as *mut IoContext) };
    let list = unsafe { input.as_ref() };
    let buffers =
        unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), list.mNumberBuffers as usize) };
    for buffer in buffers {
        let data = buffer.mData as *const f32;
        let total = buffer.mDataByteSize as usize / mem::size_of::<f32>();
        if data.is_null() || total == 0 {
            continue;
        }
        let samples = unsafe { std::slice::from_raw_parts(data, total) };
        let channels = buffer.mNumberChannels.max(1) as usize;
        if channels == 1 {
            (ctx.sink)(samples);
            continue;
        }
        ctx.mono.clear();
        for frame in samples.chunks_exact(channels) {
            ctx.mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
        let mono = mem::take(&mut ctx.mono);
        (ctx.sink)(&mono);
        ctx.mono = mono;
    }
    0
}

pub(crate) struct SystemAudioCapture {
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
    proc_id: AudioDeviceIOProcID,
    ctx: *mut IoContext,
}

// Object ids are plain handles; `ctx` is only touched by the HAL IO thread
// until teardown stops the device.
unsafe impl Send for SystemAudioCapture {}

impl SystemAudioCapture {
    /// `make_sink` receives the tap sample rate and returns the audio callback.
    pub(crate) fn start(
        scope: &SystemAudioScope,
        make_sink: impl FnOnce(u32) -> Box<dyn FnMut(&[f32]) + Send>,
    ) -> Result<Self> {
        if !supported() {
            return Err(anyhow!(
                "System audio needs macOS {}.{} or later",
                MIN_MACOS.0,
                MIN_MACOS.1
            ));
        }
        let process_ids = process_object_ids_for_scope(scope)?;
        if matches!(scope, SystemAudioScope::Apps(_)) && process_ids.is_empty() {
            return Err(anyhow!("None of the selected apps are producing audio"));
        }
        let numbers: Vec<Retained<NSNumber>> = process_ids
            .iter()
            .map(|id| NSNumber::new_u32(*id))
            .collect();
        let numbers = NSArray::from_retained_slice(&numbers);
        let description = unsafe {
            let description = match scope {
                SystemAudioScope::All => CATapDescription::initMonoGlobalTapButExcludeProcesses(
                    CATapDescription::alloc(),
                    &numbers,
                ),
                SystemAudioScope::Apps(_) => CATapDescription::initMonoMixdownOfProcesses(
                    CATapDescription::alloc(),
                    &numbers,
                ),
            };
            description.setName(&NSString::from_str("Glimpse Recording"));
            description.setPrivate(true);
            description
        };

        let mut tap_id: AudioObjectID = 0;
        let status = unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap_id) };
        if status != 0 {
            return Err(anyhow!("permission"));
        }

        let built = (|| -> Result<Self> {
            let format: AudioStreamBasicDescription =
                read_property(tap_id, kAudioTapPropertyFormat)?;
            let sample_rate = format.mSampleRate.round() as u32;
            if sample_rate == 0 {
                return Err(anyhow!("System audio tap reported no sample rate"));
            }

            let tap_uid = unsafe { description.UUID().UUIDString() };
            let yes = NSNumber::new_bool(true);
            let sub_tap = string_keyed_dictionary(&[
                (kAudioSubTapUIDKey, tap_uid.as_ref()),
                (kAudioSubTapDriftCompensationKey, yes.as_ref()),
            ]);
            let tap_list = NSArray::from_retained_slice(&[sub_tap]);
            let aggregate_uid = NSString::from_str(&uuid::Uuid::new_v4().to_string());
            let aggregate_name = NSString::from_str("Glimpse Recording Capture");
            let aggregate = string_keyed_dictionary(&[
                (kAudioAggregateDeviceNameKey, aggregate_name.as_ref()),
                (kAudioAggregateDeviceUIDKey, aggregate_uid.as_ref()),
                (kAudioAggregateDeviceIsPrivateKey, yes.as_ref()),
                (kAudioAggregateDeviceTapAutoStartKey, yes.as_ref()),
                (kAudioAggregateDeviceTapListKey, tap_list.as_ref()),
            ]);

            let mut aggregate_id: AudioObjectID = 0;
            // NSDictionary is toll-free bridged to CFDictionary.
            let cf_dictionary: &CFDictionary = unsafe {
                &*(Retained::as_ptr(&aggregate) as *const NSDictionary<NSString, AnyObject>
                    as *const CFDictionary)
            };
            check(
                unsafe {
                    AudioHardwareCreateAggregateDevice(
                        cf_dictionary,
                        NonNull::from(&mut aggregate_id),
                    )
                },
                "create aggregate device",
            )?;

            let started = (|| -> Result<Self> {
                let ctx = Box::into_raw(Box::new(IoContext {
                    sink: make_sink(sample_rate),
                    mono: Vec::new(),
                }));
                let mut proc_id: AudioDeviceIOProcID = None;
                let status = unsafe {
                    AudioDeviceCreateIOProcID(
                        aggregate_id,
                        Some(io_proc),
                        ctx as *mut c_void,
                        NonNull::from(&mut proc_id),
                    )
                };
                if status != 0 {
                    drop(unsafe { Box::from_raw(ctx) });
                    return Err(anyhow!("create IO proc failed (OSStatus {status})"));
                }
                let status = unsafe { AudioDeviceStart(aggregate_id, proc_id) };
                if status != 0 {
                    unsafe { AudioDeviceDestroyIOProcID(aggregate_id, proc_id) };
                    drop(unsafe { Box::from_raw(ctx) });
                    return Err(anyhow!("start system audio failed (OSStatus {status})"));
                }
                Ok(Self {
                    tap_id,
                    aggregate_id,
                    proc_id,
                    ctx,
                })
            })();
            if started.is_err() {
                unsafe { AudioHardwareDestroyAggregateDevice(aggregate_id) };
            }
            started
        })();

        if built.is_err() {
            unsafe { AudioHardwareDestroyProcessTap(tap_id) };
        }
        built
    }

    pub(crate) fn stop(mut self) {
        self.teardown();
    }

    fn teardown(&mut self) {
        unsafe {
            if self.proc_id.is_some() {
                AudioDeviceStop(self.aggregate_id, self.proc_id);
                AudioDeviceDestroyIOProcID(self.aggregate_id, self.proc_id);
                self.proc_id = None;
            }
            if self.aggregate_id != 0 {
                AudioHardwareDestroyAggregateDevice(self.aggregate_id);
                self.aggregate_id = 0;
            }
            if self.tap_id != 0 {
                AudioHardwareDestroyProcessTap(self.tap_id);
                self.tap_id = 0;
            }
            if !self.ctx.is_null() {
                drop(Box::from_raw(self.ctx));
                self.ctx = std::ptr::null_mut();
            }
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.teardown();
    }
}

fn string_keyed_dictionary(
    entries: &[(&std::ffi::CStr, &AnyObject)],
) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<Retained<NSString>> = entries
        .iter()
        .map(|(key, _)| NSString::from_str(key.to_str().unwrap_or_default()))
        .collect();
    let key_refs: Vec<&NSString> = keys.iter().map(|key| key.as_ref()).collect();
    let values: Vec<&AnyObject> = entries.iter().map(|(_, value)| *value).collect();
    NSDictionary::from_slices::<NSString>(&key_refs, &values)
}

fn check(status: i32, what: &str) -> Result<()> {
    if status == 0 {
        Ok(())
    } else {
        Err(anyhow!("{what} failed (OSStatus {status})"))
    }
}

fn global_address(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn read_property<T: Copy>(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
) -> Result<T> {
    let address = global_address(selector);
    let mut value = mem::MaybeUninit::<T>::uninit();
    let mut size = mem::size_of::<T>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            std::ptr::null(),
            NonNull::from(&mut size),
            NonNull::new(value.as_mut_ptr() as *mut c_void).unwrap(),
        )
    };
    check(status, "read audio property")?;
    Ok(unsafe { value.assume_init() })
}

fn read_property_array<T: Copy>(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
) -> Result<Vec<T>> {
    let address = global_address(selector);
    let mut size: u32 = 0;
    check(
        unsafe {
            AudioObjectGetPropertyDataSize(
                object,
                NonNull::from(&address),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
            )
        },
        "size audio property",
    )?;
    let count = size as usize / mem::size_of::<T>();
    let mut values: Vec<T> = Vec::with_capacity(count);
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            std::ptr::null(),
            NonNull::from(&mut size),
            NonNull::new(values.as_mut_ptr() as *mut c_void).unwrap(),
        )
    };
    check(status, "read audio property list")?;
    unsafe { values.set_len(size as usize / mem::size_of::<T>()) };
    Ok(values)
}
