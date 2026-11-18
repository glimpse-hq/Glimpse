use std::path::Path;

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};

use crate::library::{
    LibraryFilter, LibraryItem, LibraryItemPatch, LibraryItemStatus, LibraryItemsPage,
    PreviousTranscript,
};

const ACTIVE_STATUSES: &str = "('pending', 'importing', 'transcribing')";

const LIBRARY_COLUMNS: &str = "id, name, audio_path, source_path, store_original, status, progress, \
    error_message, transcript, segments, words, duration_seconds, file_size_bytes, original_format, \
    created_at, transcribed_at, tags, llm_cleanup_enabled, speech_model, show_timestamps, \
    detect_speakers, kind, speakers, secondary_audio_path, sources, bookmarks, transcript_edited";

/// LIBRARY_COLUMNS without the transcript, segments and word timings, which
/// the app's list never shows and which run to megabytes for long recordings.
const LIBRARY_LIST_COLUMNS: &str = "id, name, audio_path, source_path, store_original, status, progress, \
    error_message, NULL AS transcript, NULL AS segments, NULL AS words, duration_seconds, file_size_bytes, \
    original_format, created_at, transcribed_at, tags, llm_cleanup_enabled, speech_model, show_timestamps, \
    detect_speakers, kind, speakers, secondary_audio_path, sources, bookmarks, transcript_edited";

pub(crate) fn insert_library_item(conn: &Connection, item: LibraryItem) -> Result<LibraryItem> {
    let (status, progress, error_message) = item.status.as_fields();
    let segments = serialize_json_column(&item.segments)?;
    let words = serialize_json_column(&item.words)?;
    let tags = serialize_tags(&item.tags)?;
    let speakers = serialize_json_column(&item.speakers)?;
    let sources = serialize_json_value(&item.sources)?;
    let bookmarks = serialize_json_column(&item.bookmarks)?;

    conn.execute(
        "INSERT INTO library_items (
            id,
            name,
            audio_path,
            source_path,
            store_original,
            status,
            progress,
            error_message,
            transcript,
            segments,
            words,
            duration_seconds,
            file_size_bytes,
            original_format,
            created_at,
            transcribed_at,
            tags,
            llm_cleanup_enabled,
            speech_model,
            show_timestamps,
            detect_speakers,
            kind,
            speakers,
            secondary_audio_path,
            sources,
            bookmarks,
            transcript_edited
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
        params![
            item.id,
            item.name,
            item.audio_path,
            item.source_path,
            if item.store_original { 1 } else { 0 },
            status,
            progress,
            error_message,
            item.transcript,
            segments,
            words,
            item.duration_seconds,
            item.file_size_bytes as i64,
            item.original_format,
            item.created_at,
            item.transcribed_at,
            tags,
            if item.llm_cleanup_enabled { 1 } else { 0 },
            item.speech_model,
            if item.show_timestamps { 1 } else { 0 },
            if item.detect_speakers { 1 } else { 0 },
            item.kind,
            speakers,
            item.secondary_audio_path,
            sources,
            bookmarks,
            if item.transcript_edited { 1 } else { 0 },
        ],
    )?;

    Ok(item)
}

pub(crate) fn get_library_items_page(
    conn: &Connection,
    root: &Path,
    filter: LibraryFilter,
    limit: usize,
    offset: usize,
) -> Result<(Vec<LibraryItem>, bool)> {
    query_library_page(conn, root, LIBRARY_COLUMNS, filter, limit, offset)
}

pub(crate) fn get_library_list_page(
    conn: &Connection,
    root: &Path,
    filter: LibraryFilter,
    limit: usize,
    offset: usize,
) -> Result<LibraryItemsPage> {
    let search = filter.search.clone().unwrap_or_default();
    let (items, has_more) =
        query_library_page(conn, root, LIBRARY_LIST_COLUMNS, filter, limit, offset)?;
    let snippets = get_library_snippets(conn, &items, &search)?;
    Ok(LibraryItemsPage {
        items,
        has_more,
        snippets,
    })
}

/// A short passage of each transcript: around the search's first word, or its
/// opening without one.
fn get_library_snippets(
    conn: &Connection,
    items: &[LibraryItem],
    search: &str,
) -> Result<std::collections::HashMap<String, String>> {
    const SPAN: i64 = 200;
    if items.is_empty() {
        return Ok(Default::default());
    }
    // An empty term matches at the start of every transcript.
    let term = extract_search_terms(search.trim())
        .0
        .into_iter()
        .next()
        .unwrap_or_default();
    let ids = vec!["?"; items.len()].join(", ");
    let sql = format!(
        "SELECT id, max(instr(lower(transcript), lower(?1)) - 60, 1) AS start,
                substr(transcript, max(instr(lower(transcript), lower(?1)) - 60, 1), {SPAN}),
                length(transcript)
         FROM library_items
         WHERE transcript <> '' AND instr(lower(transcript), lower(?1)) > 0 AND id IN ({ids})"
    );
    let mut params: Vec<&dyn ToSql> = vec![&term];
    params.extend(items.iter().map(|item| &item.id as &dyn ToSql));
    let mut stmt = conn.prepare(&sql)?;
    let snippets = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            let start: i64 = row.get(1)?;
            let text: String = row.get(2)?;
            let total: i64 = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                trim_snippet(&text, start > 1, start + SPAN <= total),
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(snippets)
}

// Cut passages lose their partial first and last words and get ellipses.
// Text with no nearby space (Japanese, Chinese) is cut where it is.
fn trim_snippet(text: &str, cut_start: bool, cut_end: bool) -> String {
    const NEAR: usize = 24;
    let mut text = text.trim();
    if cut_start
        && let Some((head, rest)) = text.split_once(char::is_whitespace)
        && head.chars().count() <= NEAR
    {
        text = rest;
    }
    if cut_end
        && let Some((rest, tail)) = text.rsplit_once(char::is_whitespace)
        && tail.chars().count() <= NEAR
    {
        text = rest;
    }
    format!(
        "{}{}{}",
        if cut_start { "…" } else { "" },
        text.trim(),
        if cut_end { "…" } else { "" }
    )
}

fn query_library_page(
    conn: &Connection,
    root: &Path,
    columns: &str,
    filter: LibraryFilter,
    limit: usize,
    offset: usize,
) -> Result<(Vec<LibraryItem>, bool)> {
    let (where_clause, mut params) = build_library_filter(&filter, root);
    let sql = format!(
        "SELECT {columns}
         FROM library_items
         {}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        where_clause
    );

    let fetch_limit = limit.saturating_add(1) as i64;
    params.push(Box::new(fetch_limit));
    params.push(Box::new(offset as i64));

    let mut stmt = conn.prepare(&sql)?;
    let mut items = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            library_item_from_row(root, row)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let has_more = items.len() > limit;
    if has_more {
        items.truncate(limit);
    }

    Ok((items, has_more))
}

/// Marks an active item as cancelling; false when it already has another status.
pub(crate) fn mark_library_item_cancelling(conn: &Connection, id: &str) -> Result<bool> {
    let changed = conn.execute(
        &format!(
            "UPDATE library_items SET status = 'cancelling', progress = 0
         WHERE id = ?1 AND status IN {ACTIVE_STATUSES}"
        ),
        params![id],
    )?;
    Ok(changed > 0)
}

pub(crate) fn get_recoverable_library_items(
    conn: &Connection,
    root: &Path,
) -> Result<Vec<LibraryItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIBRARY_COLUMNS}
         FROM library_items
         WHERE status IN ('pending', 'importing', 'transcribing', 'cancelling') AND deleted = 0
         ORDER BY created_at ASC"
    ))?;

    let items = stmt
        .query_map([], |row| library_item_from_row(root, row))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

pub(crate) fn update_library_item(
    conn: &mut Connection,
    root: &Path,
    id: &str,
    patch: LibraryItemPatch,
) -> Result<Option<LibraryItem>> {
    let tx = conn.transaction()?;
    let mut item = match get_library_item(&tx, root, id)? {
        Some(item) => item,
        None => return Ok(None),
    };

    if let Some(name) = patch.name {
        item.name = name;
    }
    if let Some(transcript) = patch.transcript {
        item.transcript = Some(transcript);
    }
    if let Some(edited) = patch.transcript_edited {
        item.transcript_edited = edited;
    }
    if let Some(segments) = patch.segments {
        item.segments = Some(segments);
    }
    if let Some(words) = patch.words {
        item.words = Some(words);
    }
    if let Some(tags) = patch.tags {
        item.tags = tags;
    }
    if let Some(status) = patch.status {
        item.status = status;
    }
    if let Some(enabled) = patch.llm_cleanup_enabled {
        item.llm_cleanup_enabled = enabled;
    }
    if let Some(model) = patch.speech_model {
        item.speech_model = model;
    }
    if let Some(transcribed_at) = patch.transcribed_at {
        item.transcribed_at = Some(transcribed_at);
    }
    if let Some(show_timestamps) = patch.show_timestamps {
        item.show_timestamps = show_timestamps;
    }
    if let Some(detect_speakers) = patch.detect_speakers {
        item.detect_speakers = detect_speakers;
    }
    if let Some(duration_seconds) = patch.duration_seconds {
        item.duration_seconds = duration_seconds;
    }
    if let Some(kind) = patch.kind {
        item.kind = kind;
    }
    if let Some(speakers) = patch.speakers {
        item.speakers = speakers;
    }
    if let Some(bookmarks) = patch.bookmarks {
        item.bookmarks = Some(bookmarks);
    }

    update_library_item_full(&tx, &item)?;
    if let Some(previous) = patch.previous_transcript {
        let previous = serialize_json_value(&previous)?;
        tx.execute(
            "UPDATE library_items SET previous_transcript = ?1 WHERE id = ?2",
            params![previous, id],
        )?;
    }
    tx.commit()?;
    Ok(Some(item))
}

pub(crate) fn get_previous_transcript(
    conn: &Connection,
    id: &str,
) -> Result<Option<PreviousTranscript>> {
    let stored: Option<Option<String>> = conn
        .query_row(
            "SELECT previous_transcript FROM library_items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.flatten().and_then(|raw| {
        serde_json::from_str(&raw)
            .inspect_err(|err| {
                tracing::warn!(
                    "Previous transcript of library item {id} is unreadable ({:?})",
                    err.classify()
                );
            })
            .ok()
    }))
}

/// Hides an item until it is restored or purged; false when it was not listed.
pub(crate) fn delete_library_item(conn: &Connection, id: &str) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE library_items SET deleted = 1 WHERE id = ?1 AND deleted = 0",
        params![id],
    )?;
    Ok(changed > 0)
}

pub(crate) fn restore_library_item(conn: &Connection, id: &str) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE library_items SET deleted = 0 WHERE id = ?1 AND deleted = 1",
        params![id],
    )?;
    Ok(changed > 0)
}

pub(crate) fn get_deleted_library_items(
    conn: &Connection,
    root: &Path,
) -> Result<Vec<LibraryItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LIBRARY_COLUMNS} FROM library_items WHERE deleted = 1"
    ))?;
    let items = stmt
        .query_map([], |row| library_item_from_row(root, row))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

pub(crate) fn purge_library_item(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM library_items WHERE id = ?1 AND deleted = 1",
        params![id],
    )?;
    Ok(())
}

pub(crate) fn get_library_tags(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tags FROM library_items WHERE deleted = 0")?;
    let mut rows = stmt.query([])?;
    let mut set = std::collections::BTreeSet::new();
    while let Some(row) = rows.next()? {
        let tags_json: String = row.get(0)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        for tag in tags {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                set.insert(trimmed.to_string());
            }
        }
    }
    Ok(set.into_iter().collect())
}

pub(crate) fn get_library_item(
    conn: &Connection,
    root: &Path,
    id: &str,
) -> Result<Option<LibraryItem>> {
    conn.query_row(
        &format!("SELECT {LIBRARY_COLUMNS} FROM library_items WHERE id = ?1 AND deleted = 0"),
        params![id],
        |row| library_item_from_row(root, row),
    )
    .optional()
    .map_err(Into::into)
}

fn update_library_item_full(conn: &Connection, item: &LibraryItem) -> Result<()> {
    let (status, progress, error_message) = item.status.as_fields();
    let segments = serialize_json_column(&item.segments)?;
    let words = serialize_json_column(&item.words)?;
    let tags = serialize_tags(&item.tags)?;
    let speakers = serialize_json_column(&item.speakers)?;
    let sources = serialize_json_value(&item.sources)?;
    let bookmarks = serialize_json_column(&item.bookmarks)?;

    conn.execute(
        "UPDATE library_items SET
            name = ?1,
            audio_path = ?2,
            source_path = ?3,
            store_original = ?4,
            status = ?5,
            progress = ?6,
            error_message = ?7,
            transcript = ?8,
            segments = ?9,
            words = ?10,
            duration_seconds = ?11,
            file_size_bytes = ?12,
            original_format = ?13,
            created_at = ?14,
            transcribed_at = ?15,
            tags = ?16,
            llm_cleanup_enabled = ?17,
            speech_model = ?18,
            show_timestamps = ?19,
            kind = ?20,
            speakers = ?21,
            detect_speakers = ?22,
            secondary_audio_path = ?23,
            sources = ?24,
            bookmarks = ?25,
            transcript_edited = ?26
         WHERE id = ?27",
        params![
            item.name,
            item.audio_path,
            item.source_path,
            if item.store_original { 1 } else { 0 },
            status,
            progress,
            error_message,
            item.transcript,
            segments,
            words,
            item.duration_seconds,
            item.file_size_bytes as i64,
            item.original_format,
            item.created_at,
            item.transcribed_at,
            tags,
            if item.llm_cleanup_enabled { 1 } else { 0 },
            item.speech_model,
            if item.show_timestamps { 1 } else { 0 },
            item.kind,
            speakers,
            if item.detect_speakers { 1 } else { 0 },
            item.secondary_audio_path,
            sources,
            bookmarks,
            if item.transcript_edited { 1 } else { 0 },
            item.id,
        ],
    )?;
    Ok(())
}

// Re-root a stored audio path onto the current library location when the
// original no longer exists (e.g. the app data directory moved).
pub(crate) fn resolve_audio_path(root: &Path, stored: String) -> String {
    let path = Path::new(&stored);
    if path.exists() {
        return stored;
    }
    // The last parts are `<folder>/<item>/<file>` or `<item>/<file>`.
    let parts: Vec<_> = path.components().rev().take(3).collect();
    for count in [3, 2] {
        if parts.len() < count {
            continue;
        }
        let rebased = parts[..count]
            .iter()
            .rev()
            .fold(root.to_path_buf(), |dir, part| dir.join(part));
        if rebased.exists() {
            return rebased.display().to_string();
        }
    }
    stored
}

fn library_item_from_row(root: &Path, row: &Row<'_>) -> rusqlite::Result<LibraryItem> {
    let status_value: String = row.get("status")?;
    let progress: f32 = row.get::<_, f64>("progress").unwrap_or(0.0) as f32;
    let error_message: Option<String> = row.get("error_message")?;
    let segments_json: Option<String> = row.get("segments")?;
    let words_json: Option<String> = row.get("words").ok();
    let tags_json: String = row.get("tags")?;
    let speakers_json: Option<String> = row.get("speakers").ok().flatten();
    let sources_json: Option<String> = row.get("sources").ok().flatten();
    let bookmarks_json: Option<String> = row.get("bookmarks").ok().flatten();

    let segments = parse_json_column(segments_json);
    let words = parse_json_column(words_json);
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let speakers = parse_json_column(speakers_json);
    let bookmarks = parse_json_column(bookmarks_json);
    let sources = sources_json
        .filter(|raw| !raw.trim().is_empty())
        .and_then(|raw| serde_json::from_str(&raw).ok());

    let audio_path = resolve_audio_path(root, row.get("audio_path")?);
    Ok(LibraryItem {
        id: row.get("id")?,
        name: row.get("name")?,
        folder: crate::library::folders::folder_of(root, &audio_path),
        audio_path,
        source_path: row.get("source_path")?,
        store_original: row.get::<_, i64>("store_original")? == 1,
        status: LibraryItemStatus::from_fields(&status_value, progress, error_message),
        transcript: row.get("transcript")?,
        transcript_edited: row
            .get::<_, i64>("transcript_edited")
            .map(|value| value == 1)
            .unwrap_or(false),
        segments,
        words,
        duration_seconds: row.get::<_, f64>("duration_seconds")? as f32,
        file_size_bytes: row.get::<_, i64>("file_size_bytes")? as u64,
        original_format: row.get("original_format")?,
        created_at: row.get("created_at")?,
        transcribed_at: row.get("transcribed_at")?,
        tags,
        llm_cleanup_enabled: row.get::<_, i64>("llm_cleanup_enabled")? == 1,
        speech_model: row.get("speech_model")?,
        show_timestamps: row.get::<_, i64>("show_timestamps")? == 1,
        detect_speakers: row
            .get::<_, i64>("detect_speakers")
            .map(|value| value == 1)
            .unwrap_or(false),
        kind: row
            .get::<_, Option<String>>("kind")
            .ok()
            .flatten()
            .unwrap_or_else(crate::library::default_item_kind),
        speakers,
        secondary_audio_path: row
            .get::<_, Option<String>>("secondary_audio_path")
            .ok()
            .flatten()
            .map(|stored| resolve_audio_path(root, stored)),
        sources,
        bookmarks,
    })
}

fn serialize_json_column<T: serde::Serialize>(value: &Option<Vec<T>>) -> Result<Option<String>> {
    match value {
        Some(value) => Ok(Some(serde_json::to_string(value)?)),
        None => Ok(None),
    }
}

fn serialize_json_value<T: serde::Serialize>(value: &Option<T>) -> Result<Option<String>> {
    match value {
        Some(value) => Ok(Some(serde_json::to_string(value)?)),
        None => Ok(None),
    }
}

fn parse_json_column<T: serde::de::DeserializeOwned>(value: Option<String>) -> Option<Vec<T>> {
    value
        .filter(|raw| !raw.trim().is_empty())
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn serialize_tags(tags: &[String]) -> Result<String> {
    Ok(serde_json::to_string(tags)?)
}

pub(crate) fn extract_search_terms(search: &str) -> (Vec<String>, Vec<String>) {
    let mut tag_terms = Vec::new();
    let mut text_terms = Vec::new();

    for token in search.split_whitespace() {
        if let Some(tag) = token.strip_prefix('#') {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                tag_terms.push(trimmed.to_string());
            }
            continue;
        }

        text_terms.push(token.to_string());
    }

    (text_terms, tag_terms)
}

const TAG_CLAUSE: &str = "tags LIKE ? ESCAPE '\\'";

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

// Tags are stored as a JSON array, so match the tag's quoted JSON form.
fn tag_like_pattern(tag: &str) -> String {
    let quoted = serde_json::to_string(tag).unwrap_or_default();
    format!("%{}%", escape_like(&quoted))
}

fn build_library_filter(filter: &LibraryFilter, root: &Path) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clauses: Vec<String> = vec!["deleted = 0".to_string()];
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(search) = filter.search.as_ref()
        && !search.trim().is_empty()
    {
        let (text_terms, tag_terms) = extract_search_terms(search.trim());

        // Each word matches independently, so word order and gaps don't matter.
        for term in text_terms {
            let like = format!("%{}%", escape_like(&term));
            clauses.push("(name LIKE ? ESCAPE '\\' OR transcript LIKE ? ESCAPE '\\')".to_string());
            params.push(Box::new(like.clone()));
            params.push(Box::new(like));
        }

        for tag in tag_terms {
            clauses.push(TAG_CLAUSE.to_string());
            params.push(Box::new(tag_like_pattern(&tag)));
        }
    }

    if let Some(status) = filter.status.as_ref() {
        let trimmed = status.trim();
        if !trimmed.is_empty() {
            if trimmed == "active" {
                clauses.push(format!("status IN {ACTIVE_STATUSES}"));
            } else {
                clauses.push("status = ?".to_string());
                params.push(Box::new(trimmed.to_string()));
            }
        }
    }

    if let Some(folder) = filter.folder.as_ref()
        && !folder.trim().is_empty()
    {
        let prefix = format!(
            "{}{}",
            root.join(folder.trim()).display(),
            std::path::MAIN_SEPARATOR
        );
        clauses.push("audio_path LIKE ? ESCAPE '\\'".to_string());
        params.push(Box::new(format!("{}%", escape_like(&prefix))));
    }

    if let Some(tag) = filter.tag.as_ref()
        && !tag.trim().is_empty()
    {
        clauses.push(TAG_CLAUSE.to_string());
        params.push(Box::new(tag_like_pattern(tag.trim())));
    }

    if let Some(cutoff) = filter.since_days.and_then(|days| {
        chrono::TimeDelta::try_days(days as i64)
            .and_then(|span| chrono::Utc::now().checked_sub_signed(span))
    }) {
        clauses.push("created_at >= ?".to_string());
        params.push(Box::new(cutoff.to_rfc3339()));
    }

    (format!("WHERE {}", clauses.join(" AND ")), params)
}
