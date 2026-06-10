export type TranscriptSegment = {
  start_ms: number;
  end_ms: number;
  text: string;
};

export type LibraryItemStatus =
  | { type: "pending" }
  | { type: "importing"; progress: number }
  | { type: "transcribing"; progress: number }
  | { type: "complete" }
  | { type: "cancelling" }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export type LibraryItem = {
  id: string;
  name: string;
  audio_path: string;
  source_path: string;
  store_original: boolean;
  status: LibraryItemStatus;
  transcript?: string | null;
  segments?: TranscriptSegment[] | null;
  duration_seconds: number;
  file_size_bytes: number;
  original_format: string;
  created_at: string;
  transcribed_at?: string | null;
  tags: string[];
  llm_cleanup_enabled: boolean;
  speech_model: string;
  show_timestamps: boolean;
};

export type LibraryItemsPage = {
  items: LibraryItem[];
  has_more: boolean;
};

export type LibraryFilter = {
  search?: string | null;
  status?: string | null;
  tag?: string | null;
  since_days?: number | null;
};

export type LibraryItemPatch = {
  name?: string | null;
  transcript?: string | null;
  segments?: TranscriptSegment[] | null;
  tags?: string[] | null;
  status?: LibraryItemStatus | null;
  llm_cleanup_enabled?: boolean | null;
  speech_model?: string | null;
  transcribed_at?: string | null;
  show_timestamps?: boolean | null;
  duration_seconds?: number | null;
};

export type LibraryImportOptions = {
  store_original: boolean;
  model_key: string;
  llm_cleanup_enabled: boolean;
  show_timestamps: boolean;
};

export type ExportFormat = "txt" | "md" | "srt" | "vtt";

export type LibraryProgressPayload = {
  id: string;
  progress: number;
  current_chunk: number;
  total_chunks: number;
  chunk_text?: string | null;
  chunk_segments?: TranscriptSegment[] | null;
};

export type LibraryImportProgressPayload = {
  id: string;
  progress: number;
};
