// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if launched_as_cli() {
        if let Err(err) = glimpse_lib::run_cli() {
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

    if cfg!(target_os = "windows") {
        return std::env::var_os(WINDOWS_CLI_SHIM_ENV).is_some();
    }

    // macOS installs expose a lowercase `glimpse` symlink. The app binary is
    // `Glimpse`, including in `tauri dev`, and should launch the GUI.
    stem == "glimpse"
}
