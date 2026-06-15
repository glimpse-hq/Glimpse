//! Shared request/response protocol for the CLI ↔ app control socket:
//! newline-delimited JSON over a local socket (UDS on macOS, named pipe on
//! Windows) via an `interprocess` namespaced name. The name includes the
//! current user so it can't collide with another account on a shared machine.

use std::sync::OnceLock;

use interprocess::local_socket::{GenericNamespaced, Name, ToNsName};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

impl Request {
    pub fn new(command: impl Into<String>, args: Value) -> Self {
        Self {
            command: command.into(),
            args,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(data: Value) -> Self {
        Self {
            ok: true,
            data,
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: Value::Null,
            error: Some(message.into()),
        }
    }
}

/// Per-user socket name, e.g. `glimpse-cli-garon.sock`. Same value in the app
/// (server) and the CLI (client) since both run as the same user.
fn socket_label() -> &'static str {
    static LABEL: OnceLock<String> = OnceLock::new();
    LABEL.get_or_init(|| {
        let raw = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default();
        let user: String = raw.chars().filter(char::is_ascii_alphanumeric).collect();
        let user = if user.is_empty() { "default" } else { &user };
        format!("glimpse-cli-{user}.sock")
    })
}

pub fn socket_name() -> std::io::Result<Name<'static>> {
    socket_label().to_ns_name::<GenericNamespaced>()
}
