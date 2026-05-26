// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if launched_as_cli() {
        if let Err(err) = glimpse_speech::cli::run_blocking() {
            eprintln!("{err:?}");
            std::process::exit(1);
        }
        return;
    }

    glimpse_lib::run()
}

const WINDOWS_CLI_SHIM_ENV: &str = "GLIMPSE_CLI_SHIM";

fn launched_as_cli() -> bool {
    let mut args = std::env::args_os();
    let Some(first) = args.next() else {
        return false;
    };
    let exe = std::path::PathBuf::from(first);
    let Some(stem) = exe.file_stem().and_then(|name| name.to_str()) else {
        return false;
    };

    if stem == "glimpse-cli" {
        return true;
    }

    let launched_from_windows_shim = std::env::var_os(WINDOWS_CLI_SHIM_ENV).is_some();
    launched_as_cli_name(stem, launched_from_windows_shim)
}

fn launched_as_cli_name(stem: &str, launched_from_windows_shim: bool) -> bool {
    if cfg!(windows) && launched_from_windows_shim {
        return true;
    }

    if cfg!(unix) {
        // Unix installs expose a lowercase `glimpse` symlink. The app binary is
        // `Glimpse`, including in `tauri dev`, and should launch the GUI.
        return stem == "glimpse";
    }

    if cfg!(windows) {
        return false;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_lowercase_glimpse_is_cli() {
        if cfg!(unix) {
            assert!(launched_as_cli_name("glimpse", false));
        }
    }

    #[test]
    fn unix_app_binary_glimpse_is_gui() {
        if cfg!(unix) {
            assert!(!launched_as_cli_name("Glimpse", false));
        }
    }
}
