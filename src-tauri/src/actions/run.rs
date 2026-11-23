//! Starts action scripts: which program runs them, their environment, and
//! ending the whole process tree.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

pub(crate) type Env = Vec<(OsString, OsString)>;

// A script that streams without end must not fill memory.
const MAX_OUTPUT: usize = 1024 * 1024;
// Time for a script to clean up after SIGTERM before SIGKILL.
#[cfg(target_os = "macos")]
const TERM_GRACE: Duration = Duration::from_millis(500);
// A background process the script started can keep its output open after it exits.
const OUTPUT_GRACE: Duration = Duration::from_millis(500);
pub(crate) const POLL: Duration = Duration::from_millis(20);

static ENV: Mutex<Option<Arc<Env>>> = Mutex::new(None);
// Process groups of running scripts, ended when Glimpse quits.
#[cfg(target_os = "macos")]
static GROUPS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// The environment scripts start from, read on the first run and again on `refresh_env`.
pub(crate) fn env() -> Arc<Env> {
    if let Some(env) = cached_env() {
        return env;
    }
    refresh_env();
    cached_env().unwrap_or_default()
}

pub(crate) fn cached_env() -> Option<Arc<Env>> {
    ENV.lock().clone()
}

pub(crate) fn refresh_env() {
    let env = Arc::new(read_env());
    *ENV.lock() = Some(env);
}

// Apps opened from the Dock or Finder get a bare PATH, so read the one the
// person's terminal has.
#[cfg(target_os = "macos")]
fn read_env() -> Env {
    login_env().unwrap_or_else(|| std::env::vars_os().collect())
}

#[cfg(target_os = "macos")]
fn login_env() -> Option<Env> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::process::CommandExt;

    const MARKER: &[u8] = b"\nglimpse-env\n";
    let shell = std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args([
            "-l",
            "-i",
            "-c",
            "printf '\\nglimpse-env\\n'; /usr/bin/env -0",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let output = Capture::start(child.stdout.take()?);
    let deadline = Instant::now() + Duration::from_secs(5);
    let exited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => {
                kill_group(&mut child);
                break false;
            }
        }
    };
    if !exited {
        tracing::warn!("Reading the login shell environment failed");
        return None;
    }
    let (output, _) = output.finish(Instant::now() + OUTPUT_GRACE);
    let start = output
        .windows(MARKER.len())
        .rposition(|window| window == MARKER)?
        + MARKER.len();
    let env: Env = output[start..]
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            let at = entry.iter().position(|byte| *byte == b'=')?;
            Some((
                std::ffi::OsStr::from_bytes(&entry[..at]).to_os_string(),
                std::ffi::OsStr::from_bytes(&entry[at + 1..]).to_os_string(),
            ))
        })
        .collect();
    (!env.is_empty()).then_some(env)
}

// The registry has variables set since Glimpse started, like a PATH entry an
// installer just added. Only Path and variables Glimpse doesn't have yet are
// taken, so values set for this process, like USERNAME, stay.
#[cfg(target_os = "windows")]
fn read_env() -> Env {
    let mut env: Env = std::env::vars_os().collect();
    let keys = [
        windows_registry::LOCAL_MACHINE
            .open(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
            .ok(),
        windows_registry::CURRENT_USER.open("Environment").ok(),
    ];
    let mut path = Vec::new();
    for key in keys.iter().flatten() {
        let Ok(values) = key.values() else {
            continue;
        };
        for (name, value) in values {
            let expand = value.ty() == windows_registry::Type::ExpandString;
            let Ok(text) = String::try_from(value) else {
                continue;
            };
            let text = if expand { expand_env(&text) } else { text };
            if name.eq_ignore_ascii_case("path") {
                path.push(text);
            } else if get_var(&env, &name).is_none() {
                env.push((name.into(), text.into()));
            }
        }
    }
    if !path.is_empty() {
        set_var(&mut env, "Path", path.join(";").into());
    }
    env
}

#[cfg(target_os = "windows")]
fn expand_env(text: &str) -> String {
    use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
    let source = windows::core::HSTRING::from(text);
    // SAFETY: a null buffer only asks for the length.
    let len = unsafe { ExpandEnvironmentStringsW(&source, None) };
    let mut buffer = vec![0u16; len as usize];
    // SAFETY: the buffer holds `len` characters.
    let written = unsafe { ExpandEnvironmentStringsW(&source, Some(&mut buffer)) } as usize;
    if written == 0 || written > buffer.len() {
        return text.to_string();
    }
    String::from_utf16_lossy(&buffer[..written - 1])
}

/// Replaces a variable, ignoring case like Windows does.
pub(crate) fn set_var(env: &mut Env, name: &str, value: OsString) {
    env.retain(|(key, _)| !key.eq_ignore_ascii_case(name));
    env.push((name.into(), value));
}

pub(crate) fn get_var<'a>(env: &'a Env, name: &str) -> Option<&'a OsString> {
    env.iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value)
}

// Windows installs Python as `python` and `py`; its `python3` is often only a
// stub that opens the Microsoft Store.
const PYTHON: &[&str] = if cfg!(windows) {
    &["python", "py", "python3"]
} else {
    &["python3", "python"]
};

/// The program and its arguments, before the script's path.
pub(crate) fn program(
    script: &Path,
    shebang: Option<&str>,
    env: &Env,
) -> Result<Vec<OsString>, String> {
    let search: Vec<PathBuf> = get_var(env, "PATH")
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    let mut wanted = None;
    if let Some(line) = shebang {
        let mut parts = line.split_whitespace();
        let mut name = parts.next();
        if name.is_some_and(|name| Path::new(name).file_name() == Some("env".as_ref())) {
            name = parts.next();
            if name == Some("-S") {
                name = parts.next();
            }
        }
        if let Some(name) = name {
            let names = match name {
                "python" | "python3" if cfg!(windows) => PYTHON,
                _ => std::slice::from_ref(&name),
            };
            if let Some(found) = names.iter().find_map(|name| find_program(name, &search)) {
                return Ok(std::iter::once(found.into_os_string())
                    .chain(parts.map(OsString::from))
                    .collect());
            }
            wanted = Path::new(name)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned());
        }
    }
    let extension = script
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let (names, args): (&[&str], &[&str]) = match extension.as_str() {
        "py" => (PYTHON, &[]),
        "js" | "mjs" | "cjs" => (&["node"], &[]),
        "sh" => (&["sh"], &[]),
        "ps1" => (
            &["powershell"],
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
        ),
        "cmd" | "bat" => (&["cmd"], &["/D", "/Q"]),
        _ => {
            return Err(match wanted {
                Some(name) => format!("{name} not found"),
                None => "Add a #! line naming the program that runs this file".to_string(),
            });
        }
    };
    names
        .iter()
        .find_map(|name| find_program(name, &search))
        .map(|found| {
            std::iter::once(found.into_os_string())
                .chain(args.iter().map(OsString::from))
                .collect()
        })
        .ok_or_else(|| format!("{} not found", wanted.as_deref().unwrap_or(names[0])))
}

fn find_program(name: &str, search: &[PathBuf]) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.components().count() > 1 {
        return path.is_file().then(|| path.to_path_buf());
    }
    // `python3.12` has a dot but still needs `.exe` on Windows.
    let runnable = path.extension().is_some_and(|extension| {
        ["exe", "cmd", "bat"]
            .iter()
            .any(|known| extension.eq_ignore_ascii_case(known))
    });
    let extensions: &[&str] = if cfg!(windows) && !runnable {
        &[".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    search
        .iter()
        .flat_map(|dir| {
            extensions
                .iter()
                .map(move |extension| dir.join(format!("{name}{extension}")))
        })
        .find(|candidate| candidate.is_file() && !is_store_python(candidate))
}

/// The Microsoft Store's stand-in for Python that only offers to install it.
/// A Python installed from the Store keeps its package folder next to it.
fn is_store_python(path: &Path) -> bool {
    let Some(dir) = path.parent() else {
        return false;
    };
    cfg!(windows)
        && dir
            .to_string_lossy()
            .to_lowercase()
            .ends_with(r"microsoft\windowsapps")
        && path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().to_lowercase().starts_with("python"))
        && !std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("PythonSoftwareFoundation.Python.")
            })
}

pub(crate) enum Ended {
    Exited {
        success: bool,
        code: Option<i32>,
        /// None when it was over the 1 MB that is kept.
        stdout: Option<String>,
        stderr: String,
    },
    TimedOut,
    Stopped,
    Failed(String),
}

/// Runs `script` and waits for it. `stop` is checked while it runs; stop and
/// timeout end every process it started.
pub(crate) fn execute(
    program: &[OsString],
    script: &Path,
    env: &Env,
    stdin: String,
    timeout: Option<Duration>,
    stop: &dyn Fn() -> bool,
) -> Ended {
    let Some((executable, args)) = program.split_first() else {
        return Ended::Failed("No program for this file".to_string());
    };
    let mut command = Command::new(executable);
    command.args(args);
    #[cfg(target_os = "windows")]
    script_arg(&mut command, executable, script);
    #[cfg(target_os = "macos")]
    command.arg(script);
    command
        .current_dir(script.parent().unwrap_or(Path::new(".")))
        .env_clear()
        .envs(env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "macos")]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    #[cfg(target_os = "windows")]
    std::os::windows::process::CommandExt::creation_flags(
        &mut command,
        crate::platform::windows::CREATE_NO_WINDOW,
    );
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => return Ended::Failed(format!("Couldn't start the script: {err}")),
    };
    #[cfg(target_os = "macos")]
    let _group = Group::track(&child);
    #[cfg(target_os = "windows")]
    let job = Job::assign(&child);

    if let Some(mut input) = child.stdin.take() {
        std::thread::spawn(move || {
            let _ = input.write_all(stdin.as_bytes());
        });
    }
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Ended::Failed("Couldn't read the script's output".to_string());
    };
    let (stdout, stderr) = (Capture::start(stdout), Capture::start(stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(err) => return Ended::Failed(err.to_string()),
        }
        let timed_out = timeout.is_some_and(|limit| started.elapsed() >= limit);
        if timed_out || stop() {
            #[cfg(target_os = "macos")]
            kill_group(&mut child);
            #[cfg(target_os = "windows")]
            match &job {
                Some(job) => job.terminate(&mut child),
                None => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            return if timed_out {
                Ended::TimedOut
            } else {
                Ended::Stopped
            };
        }
        std::thread::sleep(POLL);
    };
    let deadline = Instant::now() + OUTPUT_GRACE;
    Ended::Exited {
        success: status.success(),
        code: status.code(),
        stdout: match stdout.finish(deadline) {
            (stdout, false) => Some(String::from_utf8_lossy(&stdout).into_owned()),
            (_, true) => None,
        },
        stderr: String::from_utf8_lossy(&stderr.finish(deadline).0).into_owned(),
    }
}

#[cfg(target_os = "macos")]
struct Group(u32);

#[cfg(target_os = "macos")]
impl Group {
    fn track(child: &Child) -> Self {
        GROUPS.lock().push(child.id());
        Self(child.id())
    }
}

#[cfg(target_os = "macos")]
impl Drop for Group {
    fn drop(&mut self) {
        GROUPS.lock().retain(|group| *group != self.0);
    }
}

/// Ends every running script. On Windows closing the job handles does this
/// when Glimpse exits.
#[cfg(target_os = "macos")]
pub(crate) fn kill_all() {
    let groups = GROUPS.lock().clone();
    if groups.is_empty() {
        return;
    }
    signal(&groups, libc::SIGTERM);
    std::thread::sleep(TERM_GRACE);
    signal(&groups, libc::SIGKILL);
}

#[cfg(target_os = "macos")]
fn signal(groups: &[u32], signal: libc::c_int) {
    for group in groups {
        // SAFETY: killpg takes no pointers.
        unsafe { libc::killpg(*group as libc::pid_t, signal) };
    }
}

#[cfg(target_os = "macos")]
fn kill_group(child: &mut Child) {
    signal(&[child.id()], libc::SIGTERM);
    let deadline = Instant::now() + TERM_GRACE;
    while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
        std::thread::sleep(POLL);
    }
    // Also the rest of the group, which can outlive the script.
    signal(&[child.id()], libc::SIGKILL);
    let _ = child.wait();
}

// A script gets a new hidden console, which reads and writes the OEM code
// page, so cmd and PowerShell switch it to UTF-8 first.
#[cfg(target_os = "windows")]
fn script_arg(command: &mut Command, executable: &std::ffi::OsStr, script: &Path) {
    use std::os::windows::process::CommandExt;
    let stem = Path::new(executable)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_lowercase());
    match stem.as_deref() {
        // The inner cmd starts on the new code page, which a batch file run
        // directly only switches to after its first real command. With `/s`
        // each cmd drops only the outer quotes, so the path stays quoted for
        // the inner one; the outer one sees it unquoted, so its special
        // characters are escaped once.
        Some("cmd") => {
            let path: String = script
                .display()
                .to_string()
                .chars()
                .flat_map(|c| "^&|<>()".contains(c).then_some('^').into_iter().chain([c]))
                .collect();
            command.raw_arg(format!(
                "/s /c \"chcp 65001 >nul & cmd /d /q /s /c \"\"{path}\"\"\""
            ));
        }
        Some("powershell") => {
            command.arg(format!(
                "[Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $LASTEXITCODE = 0; & '{}'; exit $LASTEXITCODE",
                script.display().to_string().replace('\'', "''")
            ));
        }
        _ => {
            command.arg(script);
        }
    }
}

#[cfg(target_os = "windows")]
struct Job(windows::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
impl Job {
    fn assign(child: &Child) -> Option<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        // SAFETY: no attributes or name are passed; the handle is closed on drop.
        let job = Job(unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }.ok()?);
        // Closing the handle, also when Glimpse exits, ends what is still running.
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the pointer and size describe `limits`, which outlives the call.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        }
        .ok()?;
        // SAFETY: both handles stay open for the call.
        unsafe { AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())) }.ok()?;
        Some(job)
    }

    fn terminate(&self, child: &mut Child) {
        // SAFETY: the job handle is open until drop.
        let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(self.0, 1) };
        let _ = child.wait();
    }
}

#[cfg(target_os = "windows")]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateJobObjectW and is closed once.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// The last 1 MB a stream wrote, and whether it wrote more.
struct Capture {
    buffer: Arc<Mutex<(Vec<u8>, bool)>>,
    done: mpsc::Receiver<()>,
}

impl Capture {
    fn start(mut source: impl Read + Send + 'static) -> Self {
        let buffer = Arc::new(Mutex::new((Vec::new(), false)));
        let (done_tx, done) = mpsc::channel();
        let sink = Arc::clone(&buffer);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            while let Ok(read @ 1..) = source.read(&mut chunk) {
                let (kept, over) = &mut *sink.lock();
                kept.extend_from_slice(&chunk[..read]);
                if kept.len() > MAX_OUTPUT {
                    kept.drain(..kept.len() - MAX_OUTPUT);
                    *over = true;
                }
            }
            let _ = done_tx.send(());
        });
        Self { buffer, done }
    }

    fn finish(self, deadline: Instant) -> (Vec<u8>, bool) {
        let _ = self
            .done
            .recv_timeout(deadline.saturating_duration_since(Instant::now()));
        std::mem::take(&mut *self.buffer.lock())
    }
}
