mod bleed;
pub(crate) mod commands;
mod processing;
mod queue;
pub(crate) mod repo;
mod speakers;
mod types;

#[cfg(target_os = "macos")]
pub(crate) use commands::handle_opened_paths;
pub(crate) use processing::{
    build_export_content, convert_to_wav, create_recording_item, read_wav_info,
};
pub(crate) use queue::schedule_library_job;
#[cfg(target_os = "macos")]
pub use types::EVENT_LIBRARY_RENDERER_READY;
pub(crate) use types::RecordingOutput;
pub(crate) use types::default_item_kind;
pub use types::{
    AudioSources, Bookmark, ExportFormat, JobSource, LibraryFilter, LibraryImportOptions,
    LibraryItem, LibraryItemPatch, LibraryItemStatus, TranscriptSegment,
};
