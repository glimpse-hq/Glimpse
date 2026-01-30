use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::{DateTime, Local, TimeZone};
use parking_lot::Mutex;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row, ToSql};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::library::{
    LibraryFilter,
    LibraryItem,
    LibraryItemPatch,
    LibraryItemStatus,
    TranscriptSegment,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionRecord {
    pub id: String,
    pub timestamp: DateTime<Local>,
    /// The final text (cleaned if LLM was used, otherwise raw)
    pub text: String,
    /// The raw transcription before LLM cleanup (if applicable)
    #[serde(default)]
    pub raw_text: Option<String>,
    pub audio_path: String,
    pub status: TranscriptionStatus,
    pub error_message: Option<String>,
    /// Whether LLM cleanup was applied
    #[serde(default)]
    pub llm_cleaned: bool,
    #[serde(default)]
    pub speech_model: String,
    #[serde(default)]
    pub llm_model: Option<String>,
    #[serde(default)]
    pub word_count: u32,
    #[serde(default)]
    pub audio_duration_seconds: f32,
    #[serde(default)]
    pub synced: bool,
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub mode_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionStatus {
    Success,
    Error,
}

impl TranscriptionStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Error => "error",
        }
    }

    fn from_str(value: &str) -> std::result::Result<Self, &'static str> {
        match value.to_ascii_lowercase().as_str() {
            "success" => Ok(Self::Success),
            "error" => Ok(Self::Error),
            _ => Err("Unknown transcription status"),
        }
    }
}

pub struct StorageManager {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct TranscriptionMetadata {
    pub speech_model: String,
    pub llm_model: Option<String>,
    pub word_count: u32,
    pub audio_duration_seconds: f32,
    pub synced: bool,
    pub mode_id: Option<String>,
    pub mode_name: Option<String>,
}

impl Default for TranscriptionMetadata {
    fn default() -> Self {
        Self {
            speech_model: String::new(),
            llm_model: None,
            word_count: 0,
            audio_duration_seconds: 0.0,
            synced: false,
            mode_id: None,
            mode_name: None,
        }
    }
}

impl StorageManager {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("Failed to create storage directory at {}", parent.display())
            })?;
        }

        let connection = Connection::open(&db_path).with_context(|| {
            format!(
                "Failed to open transcription database at {}",
                db_path.display()
            )
        })?;

        Self::configure_connection(&connection)?;
        Self::apply_migrations(&connection)?;

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn save_transcription(
        &self,
        text: String,
        audio_path: String,
        status: TranscriptionStatus,
        error_message: Option<String>,
        metadata: TranscriptionMetadata,
        id_override: Option<String>,
    ) -> Result<TranscriptionRecord> {
        let record = TranscriptionRecord {
            id: id_override.unwrap_or_else(|| Uuid::new_v4().to_string()),
            timestamp: Local::now(),
            text,
            raw_text: None,
            audio_path,
            status,
            error_message,
            llm_cleaned: false,
            speech_model: metadata.speech_model,
            llm_model: metadata.llm_model,
            word_count: metadata.word_count,
            audio_duration_seconds: metadata.audio_duration_seconds,
            synced: metadata.synced,
            mode_id: metadata.mode_id,
            mode_name: metadata.mode_name,
        };

        let conn = self.connection.lock();
        Self::insert_record(&conn, &record)?;
        Ok(record)
    }

    pub fn import_transcription(&self, record: TranscriptionRecord) -> Result<bool> {
        let conn = self.connection.lock();

        if Self::get_record(&conn, &record.id)?.is_some() {
            return Ok(false);
        }

        Self::insert_record(&conn, &record)?;
        Ok(true)
    }

    pub fn save_transcription_with_cleanup(
        &self,
        raw_text: String,
        cleaned_text: String,
        audio_path: String,
        metadata: TranscriptionMetadata,
        id_override: Option<String>,
    ) -> Result<TranscriptionRecord> {
        let record = TranscriptionRecord {
            id: id_override.unwrap_or_else(|| Uuid::new_v4().to_string()),
            timestamp: Local::now(),
            text: cleaned_text,
            raw_text: Some(raw_text),
            audio_path,
            status: TranscriptionStatus::Success,
            error_message: None,
            llm_cleaned: true,
            speech_model: metadata.speech_model,
            llm_model: metadata.llm_model,
            word_count: metadata.word_count,
            audio_duration_seconds: metadata.audio_duration_seconds,
            synced: metadata.synced,
            mode_id: metadata.mode_id,
            mode_name: metadata.mode_name,
        };

        let conn = self.connection.lock();
        Self::insert_record(&conn, &record)?;
        Ok(record)
    }

    pub fn update_with_llm_cleanup(
        &self,
        id: &str,
        cleaned_text: String,
        llm_model: Option<String>,
    ) -> Result<Option<TranscriptionRecord>> {
        let conn = self.connection.lock();
        Self::apply_llm_cleanup(&conn, id, &cleaned_text, llm_model.as_deref())
    }

    pub fn revert_to_raw(&self, id: &str) -> Result<Option<TranscriptionRecord>> {
        let conn = self.connection.lock();
        Self::revert_to_raw_internal(&conn, id)
    }

    pub fn mark_as_synced(&self, id: &str) -> Result<()> {
        let conn = self.connection.lock();
        conn.execute(
            "UPDATE transcriptions SET synced = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn update_transcription_result(
        &self,
        id: &str,
        text: String,
        raw_text: Option<String>,
        status: TranscriptionStatus,
        error_message: Option<String>,
        metadata: TranscriptionMetadata,
    ) -> Result<Option<TranscriptionRecord>> {
        let conn = self.connection.lock();
        let existing = Self::get_record(&conn, id)?;
        if existing.is_none() {
            return Ok(None);
        }

        conn.execute(
            "UPDATE transcriptions SET 
                text = ?1,
                raw_text = ?2,
                status = ?3,
                error_message = ?4,
                llm_cleaned = ?5,
                speech_model = ?6,
                llm_model = ?7,
                word_count = ?8,
                audio_duration_seconds = ?9,
                synced = ?10,
                mode_id = ?11,
                mode_name = ?12
             WHERE id = ?13",
            params![
                text,
                raw_text,
                status.as_str(),
                error_message,
                raw_text.is_some(),
                metadata.speech_model,
                metadata.llm_model,
                metadata.word_count,
                metadata.audio_duration_seconds,
                metadata.synced,
                metadata.mode_id,
                metadata.mode_name,
                id,
            ],
        )?;

        Self::get_record(&conn, id)
    }

    pub fn get_all_filtered(&self, search_query: Option<&str>) -> Result<Vec<TranscriptionRecord>> {
        let conn = self.connection.lock();
        let (where_clause, params) = Self::build_search_query(search_query);

        let sql = format!(
            "SELECT id, timestamp, text, raw_text, audio_path, status, error_message, llm_cleaned,
                    speech_model, llm_model, word_count, audio_duration_seconds, synced, mode_id, mode_name
             FROM transcriptions
             {}
             ORDER BY timestamp DESC",
            where_clause
        );

        let mut stmt = conn.prepare(&sql)?;
        let records = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                Self::record_from_row(row)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(records)
    }

    pub fn delete(&self, id: &str) -> Result<Option<String>> {
        let conn = self.connection.lock();
        let record = Self::get_record(&conn, id)?;
        if record.is_some() {
            conn.execute("DELETE FROM transcriptions WHERE id = ?1", params![id])?;
        }
        Ok(record.map(|r| r.audio_path))
    }

    /// Delete all transcription records and return their audio paths
    pub fn delete_all(&self) -> Result<Vec<String>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare("SELECT audio_path FROM transcriptions")?;
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        conn.execute("DELETE FROM transcriptions", [])?;
        Ok(paths)
    }

    pub fn get_by_id(&self, id: &str) -> Option<TranscriptionRecord> {
        let conn = self.connection.lock();
        match Self::get_record(&conn, id) {
            Ok(record) => record,
            Err(err) => {
                eprintln!("Failed to read transcription {id}: {err}");
                None
            }
        }
    }

    fn build_search_query(search_query: Option<&str>) -> (String, Vec<Box<dyn ToSql>>) {
        if let Some(query) = search_query {
            if !query.trim().is_empty() {
                let like_query = format!("%{}%", query.trim());
                return (
                    "WHERE text LIKE ?1 OR raw_text LIKE ?1".to_string(),
                    vec![Box::new(like_query)],
                );
            }
        }
        ("".to_string(), Vec::new())
    }

    fn insert_record(conn: &Connection, record: &TranscriptionRecord) -> Result<()> {
        let timestamp = record.timestamp.timestamp_millis();
        conn.execute(
            "INSERT INTO transcriptions (
                id,
                timestamp,
                text,
                raw_text,
                audio_path,
                status,
                error_message,
                llm_cleaned,
                speech_model,
                llm_model,
                word_count,
                audio_duration_seconds,
                synced,
                mode_id,
                mode_name
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                record.id,
                timestamp,
                record.text,
                record.raw_text,
                record.audio_path,
                record.status.as_str(),
                record.error_message,
                if record.llm_cleaned { 1 } else { 0 },
                record.speech_model,
                record.llm_model,
                record.word_count as i64,
                record.audio_duration_seconds as f64,
                if record.synced { 1 } else { 0 },
                record.mode_id,
                record.mode_name,
            ],
        )?;
        Ok(())
    }

    fn apply_llm_cleanup(
        conn: &Connection,
        id: &str,
        cleaned_text: &str,
        llm_model: Option<&str>,
    ) -> Result<Option<TranscriptionRecord>> {
        if let Some(mut record) = Self::get_record(conn, id)? {
            if record.raw_text.is_none() {
                record.raw_text = Some(record.text.clone());
            }
            record.text = cleaned_text.to_string();
            record.llm_cleaned = true;
            record.llm_model = llm_model.map(|value| value.to_string());
            record.word_count = count_words(&record.text);
            record.synced = false;

            conn.execute(
                "UPDATE transcriptions
                 SET text = ?1, raw_text = ?2, llm_cleaned = 1, llm_model = ?3, word_count = ?4, synced = 0
                 WHERE id = ?5",
                params![
                    record.text,
                    record.raw_text,
                    record.llm_model,
                    record.word_count as i64,
                    id
                ],
            )?;

            Ok(Some(record))
        } else {
            Ok(None)
        }
    }

    fn revert_to_raw_internal(conn: &Connection, id: &str) -> Result<Option<TranscriptionRecord>> {
        if let Some(mut record) = Self::get_record(conn, id)? {
            if let Some(raw) = record.raw_text.take() {
                record.text = raw;
                record.llm_cleaned = false;
                record.word_count = count_words(&record.text);
                record.llm_model = None;
                record.synced = false;
                conn.execute(
                    "UPDATE transcriptions
                     SET text = ?1, raw_text = NULL, llm_cleaned = 0, llm_model = NULL, word_count = ?2, synced = 0
                     WHERE id = ?3",
                    params![record.text, record.word_count as i64, id],
                )?;
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    fn get_record(conn: &Connection, id: &str) -> Result<Option<TranscriptionRecord>> {
        conn.query_row(
            "SELECT id, timestamp, text, raw_text, audio_path, status, error_message, llm_cleaned,
                    speech_model, llm_model, word_count, audio_duration_seconds, synced, mode_id, mode_name
             FROM transcriptions WHERE id = ?1",
            params![id],
            Self::record_from_row,
        )
        .optional()
        .map_err(Into::into)
    }

    fn record_from_row(row: &Row<'_>) -> rusqlite::Result<TranscriptionRecord> {
        let timestamp_ms: i64 = row.get("timestamp")?;
        let timestamp = Local
            .timestamp_millis_opt(timestamp_ms)
            .single()
            .ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    Type::Integer,
                    Box::new(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("Invalid timestamp stored in database: {timestamp_ms}"),
                    )) as Box<dyn std::error::Error + Send + Sync + 'static>,
                )
            })?;

        let status_value: String = row.get("status")?;
        let status = TranscriptionStatus::from_str(&status_value).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                Type::Text,
                Box::new(io::Error::new(io::ErrorKind::InvalidData, err.to_string()))
                    as Box<dyn std::error::Error + Send + Sync + 'static>,
            )
        })?;

        Ok(TranscriptionRecord {
            id: row.get("id")?,
            timestamp,
            text: row.get("text")?,
            raw_text: row.get("raw_text")?,
            audio_path: row.get("audio_path")?,
            status,
            error_message: row.get("error_message")?,
            llm_cleaned: row.get::<_, i64>("llm_cleaned")? == 1,
            speech_model: row.get("speech_model")?,
            llm_model: row.get("llm_model")?,
            word_count: row.get::<_, i64>("word_count")? as u32,
            audio_duration_seconds: row.get::<_, f64>("audio_duration_seconds")? as f32,
            synced: row.get::<_, i64>("synced").unwrap_or(0) == 1,
            mode_id: row.get("mode_id").unwrap_or(None),
            mode_name: row.get("mode_name").unwrap_or(None),
        })
    }

    fn configure_connection(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;\nPRAGMA foreign_keys = ON;",
        )?;
        Ok(())
    }

    fn apply_migrations(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS transcriptions (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                text TEXT NOT NULL,
                raw_text TEXT NULL,
                audio_path TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT NULL,
                llm_cleaned INTEGER NOT NULL DEFAULT 0,
                speech_model TEXT NOT NULL DEFAULT '',
                llm_model TEXT NULL,
                word_count INTEGER NOT NULL DEFAULT 0,
                audio_duration_seconds REAL NOT NULL DEFAULT 0,
                synced INTEGER NOT NULL DEFAULT 0,
                mode_id TEXT NULL,
                mode_name TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp);
            CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
            CREATE INDEX IF NOT EXISTS idx_transcriptions_speech_model ON transcriptions(speech_model);

            CREATE TABLE IF NOT EXISTS library_items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                audio_path TEXT NOT NULL,
                source_path TEXT NOT NULL DEFAULT '',
                store_original INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                progress REAL DEFAULT 0,
                error_message TEXT,
                transcript TEXT,
                segments TEXT,
                duration_seconds REAL NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                original_format TEXT NOT NULL,
                created_at TEXT NOT NULL,
                transcribed_at TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                llm_cleanup_enabled INTEGER NOT NULL DEFAULT 0,
                speech_model TEXT NOT NULL,
                show_timestamps INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_library_items_created_at ON library_items(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_library_items_status ON library_items(status);",
        )?;

        Self::ensure_column(
            conn,
            "transcriptions",
            "speech_model",
            "ALTER TABLE transcriptions ADD COLUMN speech_model TEXT NOT NULL DEFAULT ''",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "llm_model",
            "ALTER TABLE transcriptions ADD COLUMN llm_model TEXT NULL",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "word_count",
            "ALTER TABLE transcriptions ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "audio_duration_seconds",
            "ALTER TABLE transcriptions ADD COLUMN audio_duration_seconds REAL NOT NULL DEFAULT 0",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "synced",
            "ALTER TABLE transcriptions ADD COLUMN synced INTEGER NOT NULL DEFAULT 0",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "mode_id",
            "ALTER TABLE transcriptions ADD COLUMN mode_id TEXT NULL",
        )?;
        Self::ensure_column(
            conn,
            "transcriptions",
            "mode_name",
            "ALTER TABLE transcriptions ADD COLUMN mode_name TEXT NULL",
        )?;
        Self::ensure_column(
            conn,
            "library_items",
            "show_timestamps",
            "ALTER TABLE library_items ADD COLUMN show_timestamps INTEGER NOT NULL DEFAULT 0",
        )?;
        Self::ensure_column(
            conn,
            "library_items",
            "source_path",
            "ALTER TABLE library_items ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
        )?;
        Self::ensure_column(
            conn,
            "library_items",
            "store_original",
            "ALTER TABLE library_items ADD COLUMN store_original INTEGER NOT NULL DEFAULT 0",
        )?;
        Ok(())
    }

    fn ensure_column(conn: &Connection, table: &str, column: &str, add_sql: &str) -> Result<()> {
        if !Self::column_exists(conn, table, column)? {
            conn.execute(add_sql, [])?;
        }
        Ok(())
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
        let query = format!("PRAGMA table_info({table})");
        let mut stmt = conn.prepare(&query)?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get("name")?;
            if name == column {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

impl StorageManager {
    pub fn insert_library_item(&self, item: LibraryItem) -> Result<LibraryItem> {
        let conn = self.connection.lock();
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

    pub fn get_library_item(&self, id: &str) -> Result<Option<LibraryItem>> {
        let conn = self.connection.lock();
        get_library_item_by_id(&conn, id)
    }

    pub fn get_library_items_page(
        &self,
        filter: LibraryFilter,
        limit: usize,
        offset: usize,
    ) -> Result<(Vec<LibraryItem>, bool)> {
        let conn = self.connection.lock();
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

    pub fn update_library_item(
        &self,
        id: &str,
        patch: LibraryItemPatch,
    ) -> Result<Option<LibraryItem>> {
        let conn = self.connection.lock();
        let mut item = match get_library_item_by_id(&conn, id)? {
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

        update_library_item_full(&conn, &item)?;
        Ok(Some(item))
    }

    pub fn delete_library_item(&self, id: &str) -> Result<Option<String>> {
        let conn = self.connection.lock();
        let item = get_library_item_by_id(&conn, id)?;
        if item.is_some() {
            conn.execute("DELETE FROM library_items WHERE id = ?1", params![id])?;
        }
        Ok(item.map(|value| value.audio_path))
    }

    pub fn get_library_tags(&self) -> Result<Vec<String>> {
        let conn = self.connection.lock();
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

fn count_words(text: &str) -> u32 {
    crate::transcribe::count_words(text)
}
