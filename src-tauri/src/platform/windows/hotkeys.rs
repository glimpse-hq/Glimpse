use anyhow::Result;
use tauri::AppHandle;

use crate::AppRuntime;

pub fn init(_app: &AppHandle<AppRuntime>) -> Result<()> {
    Ok(())
}
