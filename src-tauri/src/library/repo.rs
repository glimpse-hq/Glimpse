use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Row, ToSql};

use crate::library::{
    LibraryFilter, LibraryItem, LibraryItemPatch, LibraryItemStatus, TranscriptSegment,
};

pub(crate) fn insert_library_item(conn: &Connection, item: LibraryItem) -> Result<LibraryItem> {
    let (status, progress, error_message) = item.status.as_fields();
    let segments = serialize_segments(&item.segments)?;
    let tags = serialize_tags(&item.tags)?;

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
            duration_seconds,
            file_size_bytes,
            original_format,
            created_at,
            transcribed_at,
            tags,
            llm_cleanup_enabled,
            speech_model,
            show_timestamps
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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
            item.duration_seconds,
            item.file_size_bytes as i64,
            item.original_format,
            item.created_at,
            item.transcribed_at,
            tags,
            if item.llm_cleanup_enabled { 1 } else { 0 },
            item.speech_model,
            if item.show_timestamps { 1 } else { 0 },
        ],
    )?;

    Ok(item)
}

pub(crate) fn get_library_item(conn: &Connection, id: &str) -> Result<Option<LibraryItem>> {
    get_library_item_by_id(conn, id)
}

pub(crate) fn get_library_items_page(
    conn: &Connection,
    filter: LibraryFilter,
    limit: usize,
    offset: usize,
) -> Result<(Vec<LibraryItem>, bool)> {
    let (where_clause, mut params) = build_library_filter(&filter);
    let sql = format!(
        "SELECT id, name, audio_path, source_path, store_original, status, progress, error_message, transcript, segments,
                duration_seconds, file_size_bytes, original_format, created_at, transcribed_at,
                tags, llm_cleanup_enabled, speech_model, show_timestamps
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
            library_item_from_row(row)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let has_more = items.len() > limit;
    if has_more {
        items.truncate(limit);
    }

    Ok((items, has_more))
}

pub(crate) fn update_library_item(
    conn: &mut Connection,
    id: &str,
    patch: LibraryItemPatch,
) -> Result<Option<LibraryItem>> {
    let tx = conn.transaction()?;
    let mut item = match get_library_item_by_id(&tx, id)? {
        Some(item) => item,
        None => return Ok(None),
    };

    if let Some(name) = patch.name {
        item.name = name;
    }
    if let Some(transcript) = patch.transcript {
        item.transcript = Some(transcript);
    }
    if let Some(segments) = patch.segments {
        item.segments = Some(segments);
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
    if let Some(duration_seconds) = patch.duration_seconds {
        item.duration_seconds = duration_seconds;
    }

    update_library_item_full(&tx, &item)?;
    tx.commit()?;
    Ok(Some(item))
}

pub(crate) fn delete_library_item(conn: &Connection, id: &str) -> Result<Option<String>> {
    let item = get_library_item_by_id(conn, id)?;
    if item.is_some() {
        conn.execute("DELETE FROM library_items WHERE id = ?1", params![id])?;
    }
    Ok(item.map(|value| value.audio_path))
}

pub(crate) fn get_library_tags(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tags FROM library_items")?;
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

fn get_library_item_by_id(conn: &Connection, id: &str) -> Result<Option<LibraryItem>> {
    conn.query_row(
        "SELECT id, name, audio_path, source_path, store_original, status, progress, error_message, transcript, segments,
                duration_seconds, file_size_bytes, original_format, created_at, transcribed_at,
                tags, llm_cleanup_enabled, speech_model, show_timestamps
         FROM library_items WHERE id = ?1",
        params![id],
        library_item_from_row,
    )
    .optional()
    .map_err(Into::into)
}

fn update_library_item_full(conn: &Connection, item: &LibraryItem) -> Result<()> {
    let (status, progress, error_message) = item.status.as_fields();
    let segments = serialize_segments(&item.segments)?;
    let tags = serialize_tags(&item.tags)?;

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
            duration_seconds = ?10,
            file_size_bytes = ?11,
            original_format = ?12,
            created_at = ?13,
            transcribed_at = ?14,
            tags = ?15,
            llm_cleanup_enabled = ?16,
            speech_model = ?17,
            show_timestamps = ?18
         WHERE id = ?19",
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
            item.duration_seconds,
            item.file_size_bytes as i64,
            item.original_format,
            item.created_at,
            item.transcribed_at,
            tags,
            if item.llm_cleanup_enabled { 1 } else { 0 },
            item.speech_model,
            if item.show_timestamps { 1 } else { 0 },
            item.id,
        ],
    )?;
    Ok(())
}

fn library_item_from_row(row: &Row<'_>) -> rusqlite::Result<LibraryItem> {
    let status_value: String = row.get("status")?;
    let progress: f32 = row.get::<_, f64>("progress").unwrap_or(0.0) as f32;
    let error_message: Option<String> = row.get("error_message")?;
    let segments_json: Option<String> = row.get("segments")?;
    let tags_json: String = row.get("tags")?;

    let segments = match segments_json {
        Some(value) if !value.trim().is_empty() => {
            serde_json::from_str::<Vec<TranscriptSegment>>(&value).ok()
        }
        _ => None,
    };
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

    Ok(LibraryItem {
        id: row.get("id")?,
        name: row.get("name")?,
        audio_path: row.get("audio_path")?,
        source_path: row.get("source_path")?,
        store_original: row.get::<_, i64>("store_original")? == 1,
        status: LibraryItemStatus::from_fields(&status_value, progress, error_message),
        transcript: row.get("transcript")?,
        segments,
        duration_seconds: row.get::<_, f64>("duration_seconds")? as f32,
        file_size_bytes: row.get::<_, i64>("file_size_bytes")? as u64,
        original_format: row.get("original_format")?,
        created_at: row.get("created_at")?,
        transcribed_at: row.get("transcribed_at")?,
        tags,
        llm_cleanup_enabled: row.get::<_, i64>("llm_cleanup_enabled")? == 1,
        speech_model: row.get("speech_model")?,
        show_timestamps: row.get::<_, i64>("show_timestamps")? == 1,
    })
}

fn serialize_segments(segments: &Option<Vec<TranscriptSegment>>) -> Result<Option<String>> {
    match segments {
        Some(value) => Ok(Some(serde_json::to_string(value)?)),
        None => Ok(None),
    }
}

fn serialize_tags(tags: &[String]) -> Result<String> {
    Ok(serde_json::to_string(tags)?)
}

fn build_library_filter(filter: &LibraryFilter) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(search) = filter.search.as_ref() {
        if !search.trim().is_empty() {
            let like = format!("%{}%", search.trim());
            clauses.push("(name LIKE ? OR transcript LIKE ? OR tags LIKE ?)".to_string());
            params.push(Box::new(like.clone()));
            params.push(Box::new(like.clone()));
            params.push(Box::new(like));
        }
    }

    if let Some(status) = filter.status.as_ref() {
        if !status.trim().is_empty() {
            clauses.push("status = ?".to_string());
            params.push(Box::new(status.trim().to_string()));
        }
    }

    if let Some(tag) = filter.tag.as_ref() {
        if !tag.trim().is_empty() {
            clauses.push("tags LIKE ?".to_string());
            params.push(Box::new(format!("%\"{}\"%", tag.trim())));
        }
    }

    if let Some(days) = filter.since_days {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        clauses.push("created_at >= ?".to_string());
        params.push(Box::new(cutoff.to_rfc3339()));
    }

    if clauses.is_empty() {
        ("".to_string(), params)
    } else {
        (format!("WHERE {}", clauses.join(" AND ")), params)
    }
}
