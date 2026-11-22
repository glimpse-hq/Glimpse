//! Library folders are directories in the library root that hold item
//! directories. An item's folder is wherever its files are.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};

use super::repo::resolve_audio_path;

const ACTIVE: &str = "('pending', 'importing', 'transcribing', 'cancelling')";

// Speaker detection reads a finished item's files, so its status doesn't show it.
static DETECTING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Blocks moves of an item until dropped. Take it before reading the item's paths.
pub(super) struct KeepInPlace(String);

impl KeepInPlace {
    pub(super) fn new(id: &str) -> Self {
        DETECTING.lock().push(id.to_string());
        Self(id.to_string())
    }
}

impl Drop for KeepInPlace {
    fn drop(&mut self) {
        let mut detecting = DETECTING.lock();
        if let Some(index) = detecting.iter().position(|id| *id == self.0) {
            detecting.swap_remove(index);
        }
    }
}

/// The folder an item's audio sits in: `root/<folder>/<item>/<file>`.
pub(crate) fn folder_of(root: &Path, audio_path: &str) -> Option<String> {
    let parts: Vec<_> = Path::new(audio_path)
        .strip_prefix(root)
        .ok()?
        .components()
        .collect();
    (parts.len() == 3).then(|| parts[0].as_os_str().to_string_lossy().into_owned())
}

// Item directories end in "-" and the first 8 characters of their id.
fn looks_like_item_dir(name: &str) -> bool {
    name.rsplit_once('-').is_some_and(|(_, suffix)| {
        suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_hexdigit())
    })
}

fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

/// Directories in the root that hold no item files of their own.
pub(crate) fn list_folders(root: &Path) -> Result<Vec<String>> {
    let Ok(entries) = fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        if is_hidden(&name) || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = name.to_string_lossy().into_owned();
        if looks_like_item_dir(&name) {
            continue;
        }
        // Item files are named by the item's id; other files (desktop.ini,
        // a custom icon) don't make a folder an item.
        let holds_item_files = fs::read_dir(entry.path())?.flatten().any(|child| {
            let name = child.file_name().to_string_lossy().into_owned();
            name.get(..36)
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                && child.file_type().is_ok_and(|kind| kind.is_file())
        });
        if !holds_item_files {
            names.push(name);
        }
    }
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

fn folder_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > 80
        || name.starts_with('.')
        || name.ends_with('.')
        || looks_like_item_dir(name)
        || name
            .chars()
            .any(|c| c.is_control() || r#"/\:<>"|?*"#.contains(c))
    {
        bail!("That name can't be used for a folder.");
    }
    Ok(name.to_string())
}

// An existing folder in the root, by name.
fn existing_folder(root: &Path, name: &str) -> Result<PathBuf> {
    let name = folder_name(name)?;
    if !list_folders(root)?.contains(&name) {
        bail!("Folder not found.");
    }
    Ok(root.join(name))
}

type ItemPaths = (String, String, Option<String>, String);

// Stored paths can predate a move of the app's data or differ in case from
// the disk, so compare where the files are now, spelled as they are on disk.
fn current_path(root: &Path, stored: String) -> String {
    let path = resolve_audio_path(root, stored);
    let on_disk = || {
        let file = fs::canonicalize(&path).ok()?;
        let inside = file.strip_prefix(fs::canonicalize(root).ok()?).ok()?;
        Some(root.join(inside).display().to_string())
    };
    on_disk().unwrap_or(path)
}

fn item_paths(conn: &Connection, root: &Path, filter: &str) -> Result<Vec<ItemPaths>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, audio_path, secondary_audio_path, source_path FROM library_items {filter}"
    ))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                current_path(root, row.get(1)?),
                row.get::<_, Option<String>>(2)?
                    .map(|path| current_path(root, path)),
                row.get(3)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn ensure_idle(conn: &Connection, root: &Path, under: &Path) -> Result<()> {
    let filter = format!("WHERE deleted = 0 AND status IN {ACTIVE}");
    let busy = item_paths(conn, root, &filter)?
        .iter()
        .any(|(_, audio, _, _)| Path::new(audio).starts_with(under));
    if busy {
        bail!("Wait for the transcription to finish first.");
    }
    let detecting = DETECTING.lock().clone();
    if detecting.is_empty() {
        return Ok(());
    }
    let busy = item_paths(conn, root, "WHERE deleted = 0")?
        .iter()
        .any(|(id, audio, _, _)| detecting.contains(id) && Path::new(audio).starts_with(under));
    if busy {
        bail!("Wait for speaker detection to finish first.");
    }
    Ok(())
}

// Points every path under `from` at the same place under `to`.
fn rebase_paths(conn: &mut Connection, rows: Vec<ItemPaths>, from: &Path, to: &Path) -> Result<()> {
    let rebase = |path: &str| -> Option<String> {
        let rest = Path::new(path).strip_prefix(from).ok()?;
        Some(to.join(rest).display().to_string())
    };
    let tx = conn.transaction()?;
    for (id, audio, secondary, source) in rows {
        let new_audio = rebase(&audio);
        let new_secondary = secondary.as_deref().and_then(rebase);
        let new_source = rebase(&source);
        if new_audio.is_none() && new_secondary.is_none() && new_source.is_none() {
            continue;
        }
        tx.execute(
            "UPDATE library_items SET audio_path = ?1, secondary_audio_path = ?2, source_path = ?3 WHERE id = ?4",
            params![
                new_audio.unwrap_or(audio),
                new_secondary.or(secondary),
                new_source.unwrap_or(source),
                id
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// Moves a directory and the stored paths with it, putting it back if the
// paths can't be saved.
fn move_dir(conn: &mut Connection, root: &Path, from: &Path, to: &Path) -> Result<()> {
    // Paths resolve by what exists on disk, so read them before the rename.
    let rows = item_paths(conn, root, "")?;
    fs::rename(from, to)
        .with_context(|| format!("Failed to move {} to {}", from.display(), to.display()))?;
    if let Err(err) = rebase_paths(conn, rows, from, to) {
        if let Err(undo) = fs::rename(to, from) {
            tracing::error!(
                "Couldn't move {} back after a failed path update: {undo}",
                to.display()
            );
        }
        return Err(err);
    }
    Ok(())
}

pub(crate) fn create_folder(root: &Path, name: &str) -> Result<String> {
    let name = folder_name(name)?;
    let dir = root.join(&name);
    if dir.exists() {
        bail!("A folder with that name already exists.");
    }
    fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create folder at {}", dir.display()))?;
    Ok(name)
}

/// Moves an item's directory into `folder`, or back to the root with None.
pub(crate) fn move_item(
    conn: &mut Connection,
    root: &Path,
    id: &str,
    folder: Option<&str>,
) -> Result<()> {
    let audio_path = conn
        .query_row(
            "SELECT audio_path FROM library_items WHERE id = ?1 AND deleted = 0",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|stored| current_path(root, stored))
        .context("Library item not found")?;
    let item_dir = Path::new(&audio_path)
        .parent()
        .filter(|dir| dir.starts_with(root) && *dir != root)
        .context("This item isn't stored in the Library folder.")?
        .to_path_buf();
    ensure_idle(conn, root, &item_dir)?;
    let parent = match folder {
        Some(name) => {
            let dir = root.join(folder_name(name)?);
            fs::create_dir_all(&dir)?;
            dir
        }
        None => root.to_path_buf(),
    };
    let target = parent.join(item_dir.file_name().context("Item folder has no name")?);
    if target == item_dir {
        return Ok(());
    }
    if target.exists() {
        bail!("Something with the same name is already there.");
    }
    move_dir(conn, root, &item_dir, &target)
}

pub(crate) fn rename_folder(
    conn: &mut Connection,
    root: &Path,
    from: &str,
    to: &str,
) -> Result<String> {
    let source = existing_folder(root, from)?;
    let to = folder_name(to)?;
    let target = root.join(&to);
    if source == target {
        return Ok(to);
    }
    // On a case-insensitive disk "work" and "Work" are the same folder.
    if target.exists() && from.trim().to_lowercase() != to.to_lowercase() {
        bail!("A folder with that name already exists.");
    }
    ensure_idle(conn, root, &source)?;
    move_dir(conn, root, &source, &target)?;
    Ok(to)
}

/// Moves a folder's items back to the root and removes the folder.
pub(crate) fn delete_folder(conn: &mut Connection, root: &Path, name: &str) -> Result<()> {
    let dir = existing_folder(root, name)?;
    ensure_idle(conn, root, &dir)?;
    for entry in fs::read_dir(&dir)?.flatten() {
        if is_hidden(&entry.file_name()) {
            continue;
        }
        let target = root.join(entry.file_name());
        if target.exists() {
            bail!("Something with the same name is already in the Library.");
        }
        move_dir(conn, root, &entry.path(), &target)?;
    }
    crate::platform::remove_dir_all_compat(&dir)
        .with_context(|| format!("Failed to remove {}", dir.display()))
}
