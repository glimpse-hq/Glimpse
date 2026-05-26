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

    if !stem.eq_ignore_ascii_case("glimpse") {
        return false;
    }

    // Unix installs expose a `glimpse` symlink. On Windows, Glimpse.exe is the
    // GUI entry point and glimpse.cmd forwards CLI args when invoking it.
    cfg!(unix) || args.next().is_some()
}
