use std::os::raw::c_void;
use std::ptr::NonNull;

use crossbeam_channel::Sender;
use objc2_core_audio::{
    AudioObjectAddPropertyListener, AudioObjectGetPropertyData, AudioObjectID,
    AudioObjectPropertyAddress, AudioObjectPropertySelector, AudioObjectRemovePropertyListener,
    kAudioDevicePropertyTransportType, kAudioDeviceTransportTypeAggregate,
    kAudioDeviceTransportTypeAutoAggregate, kAudioDeviceTransportTypeBluetooth,
    kAudioDeviceTransportTypeBluetoothLE, kAudioDeviceTransportTypeBuiltIn,
    kAudioDeviceTransportTypeContinuityCaptureWired,
    kAudioDeviceTransportTypeContinuityCaptureWireless, kAudioDeviceTransportTypeUSB,
    kAudioDeviceTransportTypeVirtual, kAudioHardwareNoError,
    kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDevices,
    kAudioHardwarePropertyTranslateUIDToDevice, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
};
use objc2_core_foundation::CFString;
use tauri::{AppHandle, Emitter, Manager};

use crate::{AppRuntime, AppState, SETTINGS_WINDOW_LABEL, tray};

pub const EVENT_INPUT_DEVICES_CHANGED: &str = "audio:input-devices-changed";

pub fn init(app: &AppHandle<AppRuntime>) -> Result<(), String> {
    let app = app.clone();
    std::thread::Builder::new()
        .name("audio-device-watcher".to_string())
        .spawn(move || {
            if let Err(err) = run_input_device_watcher(app) {
                tracing::error!("Failed to start input device watcher: {err}");
            }
        })
        .map(|_| ())
        .map_err(|err| format!("Failed to spawn input device watcher: {err}"))
}

fn run_input_device_watcher(app: AppHandle<AppRuntime>) -> Result<(), String> {
    let (sender, receiver) = crossbeam_channel::bounded(1);
    let _devices_listener =
        AudioPropertyListener::new(kAudioHardwarePropertyDevices, sender.clone())?;
    let _default_input_listener =
        AudioPropertyListener::new(kAudioHardwarePropertyDefaultInputDevice, sender)?;

    while receiver.recv().is_ok() {
        app.state::<AppState>()
            .pill()
            .stop_if_input_device_removed(&app);
        refresh_native_menus(&app);
        let _ = app.emit_to(SETTINGS_WINDOW_LABEL, EVENT_INPUT_DEVICES_CHANGED, ());
    }

    Ok(())
}

/// How the device with this Core Audio UID connects, as an analytics bucket.
#[allow(non_upper_case_globals)]
pub fn connection(uid: &str) -> Option<&'static str> {
    let uid = CFString::from_str(uid);
    let uid: *const CFString = &*uid;
    let device: AudioObjectID = read_u32(
        kAudioObjectSystemObject as AudioObjectID,
        kAudioHardwarePropertyTranslateUIDToDevice,
        &uid,
    )?;
    if device == 0 {
        return None;
    }
    Some(
        match read_u32(device, kAudioDevicePropertyTransportType, &())? {
            kAudioDeviceTransportTypeBuiltIn => "built_in",
            kAudioDeviceTransportTypeUSB => "usb",
            kAudioDeviceTransportTypeBluetooth | kAudioDeviceTransportTypeBluetoothLE => {
                "bluetooth"
            }
            kAudioDeviceTransportTypeContinuityCaptureWired
            | kAudioDeviceTransportTypeContinuityCaptureWireless => "continuity",
            kAudioDeviceTransportTypeVirtual
            | kAudioDeviceTransportTypeAggregate
            | kAudioDeviceTransportTypeAutoAggregate => "virtual",
            _ => "other",
        },
    )
}

fn read_u32<Q>(
    object: AudioObjectID,
    selector: AudioObjectPropertySelector,
    qualifier: &Q,
) -> Option<u32> {
    let address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut value: u32 = 0;
    let mut size = size_of::<u32>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            size_of::<Q>() as u32,
            qualifier as *const Q as *const c_void,
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    };
    (status == kAudioHardwareNoError).then_some(value)
}

fn refresh_native_menus(app: &AppHandle<AppRuntime>) {
    tray::refresh_menus(app, &app.state::<AppState>().current_settings());
}

struct ListenerState {
    sender: Sender<()>,
}

struct AudioPropertyListener {
    address: AudioObjectPropertyAddress,
    state: Box<ListenerState>,
}

impl AudioPropertyListener {
    fn new(selector: AudioObjectPropertySelector, sender: Sender<()>) -> Result<Self, String> {
        let address = AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let state = Box::new(ListenerState { sender });
        let status = unsafe {
            AudioObjectAddPropertyListener(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&address),
                Some(audio_property_listener),
                &*state as *const ListenerState as *mut c_void,
            )
        };

        if status != kAudioHardwareNoError {
            return Err(format!("CoreAudio listener failed with status {status}"));
        }

        Ok(Self { address, state })
    }
}

impl Drop for AudioPropertyListener {
    fn drop(&mut self) {
        let _ = unsafe {
            AudioObjectRemovePropertyListener(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&self.address),
                Some(audio_property_listener),
                &*self.state as *const ListenerState as *mut c_void,
            )
        };
    }
}

unsafe extern "C-unwind" fn audio_property_listener(
    _: AudioObjectID,
    _: u32,
    _: NonNull<AudioObjectPropertyAddress>,
    client_data: *mut c_void,
) -> i32 {
    unsafe {
        let Some(state) = (client_data as *mut ListenerState).as_ref() else {
            return 0;
        };
        let _ = state.sender.try_send(());
        0
    }
}
