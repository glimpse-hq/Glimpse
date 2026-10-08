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
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default();
        socket_label_for(&user, identifier)
    });
}

/// Pipe names are machine-wide, so they carry the account. macOS sockets sit in
/// the account's private temp dir instead, and `sun_path` holds only 104 bytes,
/// so the name there leaves the account out and stays short.
fn socket_label_for(user: &str, identifier: &str) -> String {
    let alnum = |s: &str| -> String { s.chars().filter(char::is_ascii_alphanumeric).collect() };
    let id = alnum(identifier);
    if cfg!(target_os = "macos") {
        return format!("glimpse-{}.sock", &id[..id.len().min(MAX_MACOS_ID)]);
    }
    let user = alnum(user);
    let user = if user.is_empty() { "default" } else { &user };
    format!("glimpse-cli-{user}-{id}.sock")
}

const MAX_MACOS_ID: usize = 24;

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

/// Pipe names are machine-wide, so another account could create this one
/// first and answer the CLI. True only when the pipe's server process runs as
/// the current user; any failure to tell counts as false.
#[cfg(target_os = "windows")]
pub(crate) fn served_by_current_user(stream: &interprocess::local_socket::Stream) -> bool {
    use interprocess::local_socket::traits::StreamCommon as _;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Security::EqualSid;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let Some(pid) = stream.peer_creds().ok().and_then(|creds| creds.pid()) else {
        return false;
    };
    // SAFETY: OpenProcess takes no pointers; the handle is closed below.
    let Ok(server) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return false;
    };
    let server_user = process_user(server);
    // SAFETY: `server` is a handle this function opened and no longer uses.
    let _ = unsafe { CloseHandle(server) };
    // SAFETY: GetCurrentProcess returns a pseudo-handle that needs no closing.
    let current_user = process_user(unsafe { GetCurrentProcess() });
    let (Ok(server_user), Ok(current_user)) = (server_user, current_user) else {
        return false;
    };
    // SAFETY: both SIDs point into buffers that live until the end of this function.
    unsafe { EqualSid(token_user_sid(&server_user), token_user_sid(&current_user)) }.is_ok()
}

/// The process token's `TOKEN_USER`, in a buffer aligned for it.
#[cfg(target_os = "windows")]
fn process_user(process: windows::Win32::Foundation::HANDLE) -> windows::core::Result<Vec<u64>> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TokenUser};
    use windows::Win32::System::Threading::OpenProcessToken;

    let mut token = HANDLE::default();
    // SAFETY: `token` is a valid out pointer; the handle is closed below.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }?;
    let mut len = 0u32;
    // The first call only reports the size it needs, and fails doing so.
    // SAFETY: no buffer is passed, and `len` is a valid out pointer.
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut len) };
    let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
    // SAFETY: the buffer holds at least `len` writable bytes.
    let filled = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            len,
            &mut len,
        )
    };
    // SAFETY: `token` was opened above and is no longer used.
    let _ = unsafe { CloseHandle(token) };
    filled?;
    Ok(buffer)
}

#[cfg(target_os = "windows")]
fn token_user_sid(buffer: &[u64]) -> windows::Win32::Security::PSID {
    // SAFETY: `process_user` filled the buffer with a TOKEN_USER, and u64 is
    // aligned enough for it.
    unsafe {
        (*buffer
            .as_ptr()
            .cast::<windows::Win32::Security::TOKEN_USER>())
        .User
        .Sid
    }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_socket_name_ignores_long_account_names() {
        let label = socket_label_for(&"a".repeat(64), "com.glimpse.data");
        assert_eq!(label, "glimpse-comglimpsedata.sock");
        let long = socket_label_for("me", &"x".repeat(80));
        assert!(long.len() <= "glimpse-.sock".len() + MAX_MACOS_ID);
    }

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
