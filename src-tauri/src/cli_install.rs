use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

#[cfg(windows)]
const WINDOWS_SHIM_TARGET_MARKER: &str = "REM glimpse-cli-target=";
#[cfg(windows)]
const WINDOWS_CLI_SHIM_ENV: &str = "GLIMPSE_CLI_SHIM";

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
pub fn install_cli(state: tauri::State<crate::AppState>) -> Result<CliInstallStatus, String> {
    crate::license::require_active_license(&state.settings_store, "the CLI")?;
    install_cli_link()?;
    Ok(cli_install_status())
}

#[tauri::command]
pub fn remove_cli() -> Result<CliInstallStatus, String> {
    remove_cli_link()?;
    Ok(cli_install_status())
}

fn install_cli_link() -> Result<(), String> {
    let source = cli_source_binary()?;
    let destination = default_install_path()?;

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create CLI install directory: {err}"))?;
    }

    prepare_install_destination(&destination, &source)?;

    #[cfg(unix)]
    std::os::unix::fs::symlink(&source, &destination)
        .map_err(|err| format!("Failed to install CLI: {err}"))?;

    #[cfg(windows)]
    write_windows_shim(&destination, &source)?;

    Ok(())
}

fn remove_cli_link() -> Result<(), String> {
    let destination = default_install_path()?;
    let source = cli_source_binary()?;

    match fs::symlink_metadata(&destination) {
        Ok(_) if cli_link_owned_by_glimpse(&destination, Some(&source)) => {
            fs::remove_file(&destination)
                .map_err(|err| format!("Failed to remove CLI shortcut: {err}"))
        }
        Ok(_) => Err(format!(
            "{} is not a Glimpse CLI shortcut",
            destination.to_string_lossy()
        )),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
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

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find your home directory".to_string())
}

fn default_install_path() -> Result<PathBuf, String> {
    let home = home_dir()?;
    Ok(home.join(default_install_relative_path()))
}

fn default_install_relative_path() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from(".local/bin/glimpse")
    }

    #[cfg(windows)]
    {
        PathBuf::from(".local/bin/glimpse.cmd")
    }
}

fn prepare_install_destination(destination: &Path, source: &Path) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if is_cli_install_artifact(&metadata) => {
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
            "{} already exists and is not a Glimpse CLI shortcut",
            destination.to_string_lossy()
        )),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Failed to inspect CLI install path: {err}")),
    }
}

#[cfg(unix)]
fn is_cli_install_artifact(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn is_cli_install_artifact(metadata: &fs::Metadata) -> bool {
    metadata.is_file()
}

#[cfg(unix)]
fn cli_link_owned_by_glimpse(destination: &Path, source: Option<&Path>) -> bool {
    let Ok(target) = fs::read_link(destination) else {
        return false;
    };

    source
        .is_some_and(|source| paths_equivalent(&resolve_link_target(destination, &target), source))
}

#[cfg(windows)]
fn cli_link_owned_by_glimpse(destination: &Path, source: Option<&Path>) -> bool {
    let Ok(content) = fs::read_to_string(destination) else {
        return false;
    };
    source.is_some_and(|source| {
        parse_windows_shim_target(&content).is_some_and(|target| paths_equivalent(&target, source))
    })
}

#[cfg(windows)]
fn write_windows_shim(destination: &Path, source: &Path) -> Result<(), String> {
    let source_display = source.to_string_lossy();
    let content = format!(
        "@echo off\r\n{WINDOWS_SHIM_TARGET_MARKER}{source_display}\r\nset \"{WINDOWS_CLI_SHIM_ENV}=1\"\r\n\"{source_display}\" %*\r\n"
    );
    fs::write(destination, content).map_err(|err| format!("Failed to install CLI: {err}"))
}

#[cfg(windows)]
fn parse_windows_shim_target(content: &str) -> Option<PathBuf> {
    content.lines().find_map(|line| {
        let line = line.trim();
        line.strip_prefix(WINDOWS_SHIM_TARGET_MARKER)
            .map(|path| PathBuf::from(path.trim()))
    })
}

#[cfg(unix)]
fn resolve_link_target(destination: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        return target.to_path_buf();
    }

    destination
        .parent()
        .map(|parent| parent.join(target))
        .unwrap_or_else(|| target.to_path_buf())
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => equivalent_canonical_paths(&left, &right),
        _ => left == right,
    }
}

fn equivalent_canonical_paths(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        false
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

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::*;

    #[cfg(windows)]
    #[test]
    fn parse_windows_shim_target_reads_marker_line() {
        let content = concat!(
            "@echo off\r\n",
            "REM glimpse-cli-target=C:\\Glimpse\\Glimpse.exe\r\n",
            "\"C:\\Glimpse\\Glimpse.exe\" %*\r\n"
        );

        assert_eq!(
            parse_windows_shim_target(content),
            Some(PathBuf::from(r"C:\Glimpse\Glimpse.exe"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_shim_is_owned_when_marker_matches_source() {
        let temp =
            std::env::temp_dir().join(format!("glimpse-cli-shim-test-{}", std::process::id()));
        let _ = fs::remove_file(&temp);
        let shim_target = r"C:\Apps\Glimpse\Glimpse.exe";
        let source = PathBuf::from(shim_target);
        fs::write(
            &temp,
            format!(
                "@echo off\r\n{WINDOWS_SHIM_TARGET_MARKER}{shim_target}\r\n\"{shim_target}\" %*\r\n"
            ),
        )
        .expect("write temp shim");

        assert!(cli_link_owned_by_glimpse(&temp, Some(&source)));
        assert!(!cli_link_owned_by_glimpse(
            &temp,
            Some(Path::new(r"C:\Other\Glimpse\Glimpse.exe"))
        ));

        let _ = fs::remove_file(temp);
    }
}
