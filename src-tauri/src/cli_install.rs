use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    pub installed: bool,
    pub source_available: bool,
    pub install_path: Option<String>,
    pub source_path: Option<String>,
    pub command: String,
    pub path_in_shell: bool,
}

#[tauri::command]
pub fn get_cli_install_status() -> Result<CliInstallStatus, String> {
    Ok(cli_install_status())
}

#[tauri::command]
pub fn install_cli() -> Result<CliInstallStatus, String> {
    #[cfg(unix)]
    {
        let source = cli_source_binary()?;
        let destination = default_install_path()?;

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create CLI install directory: {err}"))?;
        }

        prepare_install_destination(&destination, &source)?;
        std::os::unix::fs::symlink(&source, &destination)
            .map_err(|err| format!("Failed to install CLI: {err}"))?;

        Ok(cli_install_status())
    }

    #[cfg(not(unix))]
    {
        Err("CLI install is not supported on this platform yet".to_string())
    }
}

#[tauri::command]
pub fn remove_cli() -> Result<CliInstallStatus, String> {
    let destination = default_install_path()?;
    let source = cli_source_binary()?;

    match fs::read_link(&destination) {
        Ok(_) if cli_link_owned_by_glimpse(&destination, Some(&source)) => {
            fs::remove_file(&destination)
                .map_err(|err| format!("Failed to remove CLI shortcut: {err}"))?;
            Ok(cli_install_status())
        }
        Ok(_) => Err(format!(
            "{} is not a Glimpse CLI shortcut",
            destination.to_string_lossy()
        )),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(cli_install_status()),
        Err(_) => Err(format!(
            "{} is not a Glimpse CLI shortcut",
            destination.to_string_lossy()
        )),
    }
}

fn cli_install_status() -> CliInstallStatus {
    let source = cli_source_binary().ok();
    let install_path = default_install_path().ok();
    let installed = install_path
        .as_ref()
        .is_some_and(|destination| cli_link_owned_by_glimpse(destination, source.as_deref()));
    let path_in_shell = install_path
        .as_ref()
        .and_then(|path| path.parent())
        .is_some_and(path_contains_dir);

    CliInstallStatus {
        installed,
        source_available: source.is_some(),
        install_path: install_path.map(display_path),
        source_path: source.map(display_path),
        command: "glimpse".to_string(),
        path_in_shell,
    }
}

fn cli_source_binary() -> Result<PathBuf, String> {
    let current_exe =
        env::current_exe().map_err(|err| format!("Failed to resolve Glimpse binary: {err}"))?;
    if is_executable_file(&current_exe) {
        Ok(current_exe)
    } else {
        Err("Glimpse binary is not executable".to_string())
    }
}

fn default_install_path() -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find your home directory".to_string())?;
    Ok(home.join(".local/bin/glimpse"))
}

fn prepare_install_destination(destination: &Path, source: &Path) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            if !cli_link_owned_by_glimpse(destination, Some(source)) {
                return Err(format!(
                    "{} already exists and is not a Glimpse CLI shortcut",
                    destination.to_string_lossy()
                ));
            }
            fs::remove_file(destination)
                .map_err(|err| format!("Failed to replace existing CLI shortcut: {err}"))
        }
        Ok(_) => Err(format!(
            "{} already exists and is not a symlink",
            destination.to_string_lossy()
        )),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Failed to inspect CLI install path: {err}")),
    }
}

fn cli_link_owned_by_glimpse(destination: &Path, source: Option<&Path>) -> bool {
    let Ok(target) = fs::read_link(destination) else {
        return false;
    };

    if source.is_some_and(|source| paths_equivalent(&target, source)) {
        return true;
    }

    target
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("glimpse-cli"))
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn path_contains_dir(dir: &Path) -> bool {
    env::var_os("PATH")
        .map(|path| env::split_paths(&path).any(|entry| paths_equivalent(&entry, dir)))
        .unwrap_or(false)
}

fn display_path(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}
