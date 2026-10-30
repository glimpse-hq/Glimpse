pub mod crash;
pub mod elevation;
pub mod icons;
pub mod live;
pub mod overlay;
pub mod quit_prompt;
pub mod store;
pub mod toast;

use std::ffi::c_void;
use std::path::Path;
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::core::PCWSTR;

/// Process creation flag that keeps a console window from opening.
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The name an exe gives itself, like "Google Chrome" for chrome.exe.
pub(crate) fn file_description(path: &Path) -> Option<String> {
    let wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let path = PCWSTR(wide.as_ptr());
    unsafe {
        let size = GetFileVersionInfoSizeW(path, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(path, None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        let mut translation: *mut c_void = std::ptr::null_mut();
        let mut translation_len = 0u32;
        let found = VerQueryValueW(
            data.as_ptr() as *const c_void,
            windows::core::w!("\\VarFileInfo\\Translation"),
            &mut translation,
            &mut translation_len,
        );
        if !found.as_bool() || translation.is_null() || translation_len < 4 {
            return None;
        }
        // Version info sits in a byte buffer, so reads can't assume u16 alignment.
        let language = (translation as *const u16).read_unaligned();
        let code_page = (translation as *const u16).add(1).read_unaligned();
        let key: Vec<u16> =
            format!("\\StringFileInfo\\{language:04x}{code_page:04x}\\FileDescription")
                .encode_utf16()
                .chain(Some(0))
                .collect();
        let mut value: *mut c_void = std::ptr::null_mut();
        let mut value_len = 0u32;
        let found = VerQueryValueW(
            data.as_ptr() as *const c_void,
            PCWSTR(key.as_ptr()),
            &mut value,
            &mut value_len,
        );
        if !found.as_bool() || value.is_null() || value_len == 0 {
            return None;
        }
        let text: Vec<u16> = (0..value_len as usize)
            .map(|index| (value as *const u16).add(index).read_unaligned())
            .collect();
        let end = text.iter().position(|ch| *ch == 0).unwrap_or(text.len());
        let name = String::from_utf16_lossy(&text[..end]).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}
