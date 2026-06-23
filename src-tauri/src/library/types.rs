use serde::{Deserialize, Serialize};

pub(crate) const SUPPORTED_AUDIO_FORMATS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "flac"];
pub(crate) const SUPPORTED_VIDEO_FORMATS: &[&str] = &["mp4", "mov", "webm", "mkv"];
pub(crate) const MAX_CHUNK_MINUTES: u32 = crate::speech::PARAKEET_CHUNK_SECONDS / 60;
pub(crate) const CHUNK_OVERLAP_SECONDS: u32 = 5;
pub(crate) const DIRECT_TRANSCRIBE_MINUTES: u32 = MAX_CHUNK_MINUTES;
pub(crate) const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Typed marker error so cancellation survives `anyhow` propagation without
/// re-parsing the message text.
#[derive(Debug)]
pub(crate) struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Transcription cancelled")
    }
}

impl std::error::Error for Cancelled {}

pub(crate) fn cancelled_error() -> anyhow::Error {
    anyhow::Error::new(Cancelled)
}

pub(crate) fn is_cancelled_error(err: &anyhow::Error) -> bool {
    err.downcast_ref::<Cancelled>().is_some()
}

pub(crate) fn is_ffmpeg_error_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("ffmpeg not found")
        || lower.contains("install ffmpeg")
        || lower.contains("ffmpeg is required")
}

pub const EVENT_LIBRARY_PROGRESS: &str = "library:transcription_progress";
pub const EVENT_LIBRARY_COMPLETE: &str = "library:transcription_complete";
pub const EVENT_LIBRARY_ERROR: &str = "library:transcription_error";
#[cfg(target_os = "macos")]
pub const EVENT_LIBRARY_OPEN_IMPORT: &str = "library:open_import";
#[cfg(target_os = "macos")]
pub const EVENT_LIBRARY_RENDERER_READY: &str = "library:renderer_ready";
pub const EVENT_LIBRARY_IMPORT_PROGRESS: &str = "library:import_progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speaker {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

pub(crate) fn default_item_kind() -> String {
    "import".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LibraryItemStatus {
    Pending,
    Importing { progress: f32 },
    Transcribing { progress: f32 },
    Complete,
    Cancelling,
    Cancelled,
    Error { message: String },
}

impl LibraryItemStatus {
    pub fn as_fields(&self) -> (String, f32, Option<String>) {
        match self {
            Self::Pending => ("pending".to_string(), 0.0, None),
            Self::Importing { progress } => ("importing".to_string(), *progress, None),
            Self::Transcribing { progress } => ("transcribing".to_string(), *progress, None),
            Self::Complete => ("complete".to_string(), 1.0, None),
            Self::Cancelling => ("cancelling".to_string(), 0.0, None),
            Self::Cancelled => ("cancelled".to_string(), 0.0, None),
            Self::Error { message } => ("error".to_string(), 0.0, Some(message.clone())),
        }
    }

    pub fn from_fields(
        status: &str,
        progress: f32,
        error_message: Option<String>,
    ) -> LibraryItemStatus {
        match status {
            "pending" => Self::Pending,
            "importing" => Self::Importing { progress },
            "transcribing" => Self::Transcribing { progress },
            "complete" => Self::Complete,
            "cancelling" => Self::Cancelling,
            "cancelled" => Self::Cancelled,
            "error" => Self::Error {
                message: error_message.unwrap_or_else(|| "Transcription failed".to_string()),
            },
            _ => Self::Error {
                message: "Unknown status".to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
    pub id: String,
    pub name: String,
    pub audio_path: String,
    pub source_path: String,
    pub store_original: bool,
    pub status: LibraryItemStatus,
    pub transcript: Option<String>,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub words: Option<Vec<TranscriptSegment>>,
    pub duration_seconds: f32,
    pub file_size_bytes: u64,
    pub original_format: String,
    pub created_at: String,
    pub transcribed_at: Option<String>,
    pub tags: Vec<String>,
    pub llm_cleanup_enabled: bool,
    pub speech_model: String,
    pub show_timestamps: bool,
    #[serde(default)]
    pub detect_speakers: bool,
    #[serde(default = "default_item_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speakers: Option<Vec<Speaker>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryFilter {
    pub search: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
    pub since_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItemsPage {
    pub items: Vec<LibraryItem>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryItemPatch {
    pub name: Option<String>,
    pub transcript: Option<String>,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub words: Option<Vec<TranscriptSegment>>,
    pub tags: Option<Vec<String>>,
    pub status: Option<LibraryItemStatus>,
    pub llm_cleanup_enabled: Option<bool>,
    pub speech_model: Option<String>,
    pub transcribed_at: Option<String>,
    pub show_timestamps: Option<bool>,
    pub detect_speakers: Option<bool>,
    pub duration_seconds: Option<f32>,
    pub kind: Option<String>,
    pub speakers: Option<Vec<Speaker>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryImportOptions {
    pub store_original: bool,
    pub model_key: String,
    pub llm_cleanup_enabled: bool,
    pub show_timestamps: bool,
    #[serde(default)]
    pub detect_speakers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryProgressPayload {
    pub id: String,
    pub progress: f32,
    pub current_chunk: u32,
    pub total_chunks: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_segments: Option<Vec<TranscriptSegment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Txt,
    Md,
    Srt,
    Vtt,
}

#[derive(Debug, Clone)]
pub(crate) struct LibraryProgressUpdate {
    pub progress: f32,
    pub current_chunk: u32,
    pub total_chunks: u32,
    pub transcript: Option<String>,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub chunk_text: Option<String>,
    pub chunk_segments: Option<Vec<TranscriptSegment>>,
}

impl LibraryProgressUpdate {
    pub fn with_chunk_counts(progress: f32, current_chunk: u32, total_chunks: u32) -> Self {
        Self {
            progress: progress.min(1.0),
            current_chunk: current_chunk.min(total_chunks),
            total_chunks,
            transcript: None,
            segments: None,
            chunk_text: None,
            chunk_segments: None,
        }
    }
}

#[derive(Debug)]
pub(crate) struct LibraryTranscriptionResult {
    pub transcript: String,
    pub segments: Option<Vec<TranscriptSegment>>,
    pub words: Option<Vec<TranscriptSegment>>,
    pub speech_model: Option<String>,
    pub speakers: Option<Vec<Speaker>>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LibraryCompletePayload {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LibraryErrorPayload {
    pub id: String,
    pub message: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LibraryImportProgressPayload {
    pub id: String,
    pub progress: f32,
}
