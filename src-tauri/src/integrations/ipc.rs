//! Shared request/response protocol for the CLI ↔ app control socket:
//! newline-delimited JSON over a local socket: a UDS in the per-user temp dir
//! on macOS, a namespaced named pipe on Windows. The name includes the current
//! user so it can't collide with another account on a shared machine.

use std::sync::OnceLock;

use interprocess::local_socket::Name;
#[cfg(not(target_os = "macos"))]
use interprocess::local_socket::{GenericNamespaced, ToNsName};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub command: String,
    #[serde(default)]
    pub args: Value,
    /// The tool driving the CLI, from `GLIMPSE_CLIENT` (e.g. "raycast").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
}

impl Request {
    pub fn new(command: impl Into<String>, args: Value) -> Self {
        Self {
            command: command.into(),
            args,
            client: std::env::var("GLIMPSE_CLIENT").ok(),
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

static SOCKET_LABEL: OnceLock<String> = OnceLock::new();

pub(crate) fn init_socket_label(identifier: &str) {
    SOCKET_LABEL.get_or_init(|| {
        let raw = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default();
        let user: String = raw.chars().filter(char::is_ascii_alphanumeric).collect();
        let user = if user.is_empty() { "default" } else { &user };
        let id: String = identifier
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        format!("glimpse-cli-{user}-{id}.sock")
    });
}

fn socket_label() -> &'static str {
    SOCKET_LABEL
        .get()
        .map(String::as_str)
        .unwrap_or("glimpse-cli-default.sock")
}

/// macOS has no socket namespace, so a namespaced name would land in the
/// shared `/tmp`, where another account could bind it first and answer the
/// CLI. The per-user temp dir is mode 0700, so only this user can bind or
/// connect there.
#[cfg(target_os = "macos")]
pub fn socket_name() -> std::io::Result<Name<'static>> {
    use interprocess::local_socket::{GenericFilePath, ToFsName};
    socket_path_in(&user_temp_dir()?).to_fs_name::<GenericFilePath>()
}

#[cfg(not(target_os = "macos"))]
pub fn socket_name() -> std::io::Result<Name<'static>> {
    socket_label().to_ns_name::<GenericNamespaced>()
}

#[cfg(any(target_os = "macos", test))]
fn socket_path_in(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join(socket_label())
}

/// `confstr(_CS_DARWIN_USER_TEMP_DIR)`, the private dir `$TMPDIR` normally
/// points at. Read directly so a missing or changed `$TMPDIR` can't move the
/// socket back to a shared directory or split the app and CLI apart.
#[cfg(target_os = "macos")]
fn user_temp_dir() -> std::io::Result<std::path::PathBuf> {
    use std::os::unix::ffi::OsStrExt;

    let mut buffer = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: the buffer is writable for its full length, which is passed in.
    let len = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        )
    };
    if len == 0 || len > buffer.len() {
        return Err(std::io::Error::other(
            "could not resolve the per-user temp directory",
        ));
    }
    // `len` counts the trailing nul.
    buffer.truncate(len - 1);
    Ok(std::path::PathBuf::from(std::ffi::OsStr::from_bytes(
        &buffer,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_stays_inside_the_given_dir() {
        let dir = std::path::Path::new("/private/var/folders/ab/cd/T");
        let path = socket_path_in(dir);
        assert_eq!(path.parent(), Some(dir));
        assert!(path.to_string_lossy().ends_with(".sock"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_socket_lives_in_a_private_per_user_dir() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let dir = user_temp_dir().unwrap();
        assert!(!dir.starts_with("/tmp") && !dir.starts_with("/private/tmp"));
        let metadata = std::fs::metadata(&dir).unwrap();
        // SAFETY: getuid has no preconditions.
        assert_eq!(metadata.uid(), unsafe { libc::getuid() });
        assert_eq!(metadata.permissions().mode() & 0o077, 0);
        // Fits in sun_path (104 bytes on macOS) with room to spare.
        assert!(socket_path_in(&dir).as_os_str().len() < 104);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_socket_path_accepts_connections() {
        use interprocess::local_socket::{
            GenericFilePath, ListenerOptions, Stream, ToFsName, prelude::*,
        };
        use std::io::{Read, Write};

        let path = user_temp_dir()
            .unwrap()
            .join(format!("glimpse-ipc-test-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let listener = ListenerOptions::new()
            .name(path.clone().to_fs_name::<GenericFilePath>().unwrap())
            .create_sync()
            .unwrap();
        let server = std::thread::spawn(move || {
            let mut stream = listener.incoming().next().unwrap().unwrap();
            stream.write_all(b"pong").unwrap();
        });
        let mut client =
            Stream::connect(path.clone().to_fs_name::<GenericFilePath>().unwrap()).unwrap();
        let mut reply = String::new();
        client.read_to_string(&mut reply).unwrap();
        server.join().unwrap();
        assert_eq!(reply, "pong");
        let _ = std::fs::remove_file(&path);
    }
}
