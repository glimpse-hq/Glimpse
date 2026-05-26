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
    std::env::args_os()
        .next()
        .and_then(|arg| {
            std::path::PathBuf::from(arg)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .is_some_and(|name| name == "glimpse" || name == "glimpse-cli")
}
