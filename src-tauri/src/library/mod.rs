mod bleed;
pub(crate) mod commands;
mod processing;
mod queue;
pub(crate) mod repo;
mod speakers;
mod types;

pub(crate) use bleed::{BLEED_REACH_MS, remove_live_bleed};
#[cfg(target_os = "macos")]
pub(crate) use commands::handle_opened_paths;
pub(crate) use processing::{
    build_export_content, convert_to_wav, create_recording_item, read_wav_info, speaker_name,
};
pub(crate) use queue::schedule_library_job;
pub(crate) use speakers::{recording_speakers, voiced_segments};
#[cfg(target_os = "macos")]
pub use types::EVENT_LIBRARY_RENDERER_READY;
pub(crate) use types::RecordingOutput;
pub(crate) use types::default_item_kind;
pub use types::{
    AudioSources, Bookmark, ExportFormat, JobSource, LibraryFilter, LibraryImportOptions,
    LibraryItem, LibraryItemPatch, LibraryItemStatus, LiveSpeakerHints, LiveTurn,
    PreviousTranscript, Speaker, TranscriptSegment,
};
