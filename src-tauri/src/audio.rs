use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<DeviceInfo>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let (default_id, default_name) = default_device
        .as_ref()
        .map(|device| {
            (
                device.id().ok().map(|id| id.to_string()),
                device
                    .description()
                    .ok()
                    .map(|description| description.name().to_string()),
            )
        })
        .unwrap_or((None, None));

    let devices = host
        .input_devices()
        .map_err(|e| format!("Failed to list input devices: {}", e))?;

    let mut result = Vec::new();
    for device in devices {
        let description = match device.description() {
            Ok(description) => description,
            Err(_) => continue,
        };
        let name = description.name().to_string();
        let id = device
            .id()
            .map(|id| id.to_string())
            .unwrap_or_else(|_| name.clone());

        let is_default = default_id.as_deref() == Some(id.as_str())
            || default_name.as_deref() == Some(name.as_str());
        result.push(DeviceInfo {
            id,
            name,
            is_default,
        });
    }

    // Sort: Default first, then alphabetical
    result.sort_by(|a, b| {
        if a.is_default && !b.is_default {
            std::cmp::Ordering::Less
        } else if !a.is_default && b.is_default {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(result)
}
