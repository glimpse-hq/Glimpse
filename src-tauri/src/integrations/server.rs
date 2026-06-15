//! In-app control-socket server: spawned once at startup, dispatches CLI
//! requests to [`super::handlers`].

use std::io::{BufRead, BufReader, Write};

use interprocess::local_socket::{prelude::*, ListenerOptions, Stream};
use tauri::AppHandle;

use super::handlers;
use super::ipc::{socket_name, Request, Response};
use crate::AppRuntime;

/// Start the control-socket server on a dedicated thread. Never blocks the
/// caller; logs and exits the thread on fatal errors.
pub(crate) fn start(app: AppHandle<AppRuntime>) {
    let spawned = std::thread::Builder::new()
        .name("glimpse-cli-ipc".to_string())
        .spawn(move || {
            if let Err(err) = serve(app) {
                tracing::warn!("CLI control socket unavailable: {err}");
            }
        });
    if let Err(err) = spawned {
        tracing::warn!("Failed to spawn CLI control socket thread: {err}");
    }
}

fn serve(app: AppHandle<AppRuntime>) -> std::io::Result<()> {
    let listener = match ListenerOptions::new().name(socket_name()?).create_sync() {
        Ok(listener) => listener,
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
            // If something answers, another instance owns the socket; defer to
            // it. Otherwise it's stale (rare crash case) — log and bail.
            if Stream::connect(socket_name()?).is_ok() {
                tracing::debug!("CLI control socket already served by another instance");
            } else {
                tracing::warn!("CLI control socket address in use but unreachable; skipping");
            }
            return Ok(());
        }
        Err(err) => return Err(err),
    };

    tracing::info!("CLI control socket listening");
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(err) = handle_connection(&app, stream) {
                        tracing::debug!("CLI control socket connection error: {err}");
                    }
                });
            }
            Err(err) => tracing::debug!("CLI control socket accept error: {err}"),
        }
    }
    Ok(())
}

fn handle_connection(app: &AppHandle<AppRuntime>, stream: Stream) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    if line.trim().is_empty() {
        return Ok(());
    }

    let response = match serde_json::from_str::<Request>(line.trim()) {
        Ok(request) => handlers::dispatch(app, &request),
        Err(err) => Response::error(format!("Malformed request: {err}")),
    };

    let mut payload = serde_json::to_string(&response).unwrap_or_else(|err| {
        serde_json::to_string(&Response::error(format!(
            "failed to serialize response: {err}"
        )))
        .unwrap_or_else(|_| r#"{"ok":false,"error":"internal serialization failure"}"#.to_string())
    });
    payload.push('\n');

    let mut stream = reader.into_inner();
    stream.write_all(payload.as_bytes())?;
    stream.flush()?;
    Ok(())
}
