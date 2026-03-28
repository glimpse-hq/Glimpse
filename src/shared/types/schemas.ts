import { z } from "zod";
import { DEFAULT_APP_LOCALE, isSupportedAppLocale } from "../lib/appLocales";

// --- Settings ---

export const TranscriptionModeSchema = z.enum(["cloud", "local"]);
export const TextSizeModeSchema = z.enum(["small", "default", "large"]);
export const AppLocaleSettingSchema = z.string().refine(
  (value) => value === DEFAULT_APP_LOCALE || isSupportedAppLocale(value),
  { message: "Unsupported app locale" },
);

export const RecordingPrunePolicySchema = z.enum([
  "never",
  "immediately",
  "day",
  "week",
  "month",
  "three_months",
  "year",
]);

export const LlmProviderSchema = z.enum([
  "none",
  "lmstudio",
  "ollama",
  "openai",
  "anthropic",
  "google",
  "xai",
  "groq",
  "cerebras",
  "sambanova",
  "together",
  "openrouter",
  "perplexity",
  "deepseek",
  "fireworks",
  "mistral",
  "custom",
]);

export const ReplacementSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const PersonalitySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  apps: z.array(z.string()),
  websites: z.array(z.string()),
  instructions: z.array(z.string()),
});

export const StoredSettingsSchema = z.object({
  onboarding_completed: z.boolean(),
  smart_shortcut: z.string(),
  smart_enabled: z.boolean(),
  hold_shortcut: z.string(),
  hold_enabled: z.boolean(),
  toggle_shortcut: z.string(),
  toggle_enabled: z.boolean(),
  transcription_mode: TranscriptionModeSchema,
  local_model: z.string(),
  microphone_device: z.string().nullable(),
  language: z.string(),
  app_locale: AppLocaleSettingSchema,
  llm_enabled: z.boolean(),

  cleanup_enabled: z.boolean(),
  llm_provider: LlmProviderSchema,
  llm_endpoint: z.string(),
  llm_api_key: z.string(),
  llm_model: z.string(),
  user_name: z.string(),
  dictionary: z.array(z.string()),
  replacements: z.array(ReplacementSchema),
  personalities: z.array(PersonalitySchema),
  edit_mode_enabled: z.boolean(),
  media_control_enabled: z.boolean(),
  auto_update_enabled: z.boolean(),
  recording_prune_policy: RecordingPrunePolicySchema,
  analytics_enabled: z.boolean(),
  analytics_install_id: z.string(),
});

// --- App ---

export const AppInfoSchema = z.object({
  version: z.string(),
  data_dir_size_bytes: z.number(),
  data_dir_path: z.string(),
});

// --- Transcription ---

export const TranscriptionRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  text: z.string(),
  raw_text: z.string().nullable().optional(),
  audio_path: z.string(),
  audio_available: z.boolean().default(false),
  status: z.enum(["success", "error"]),
  error_message: z.string().optional(),
  llm_cleaned: z.boolean(),
  speech_model: z.string(),
  llm_model: z.string().nullable().optional(),
  word_count: z.number(),
  audio_duration_seconds: z.number(),
  synced: z.boolean(),
  mode_id: z.string().nullable().optional(),
  mode_name: z.string().nullable().optional(),
});

// --- Library ---

export const TranscriptSegmentSchema = z.object({
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
});

export const LibraryItemStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pending") }),
  z.object({ type: z.literal("importing"), progress: z.number() }),
  z.object({ type: z.literal("transcribing"), progress: z.number() }),
  z.object({ type: z.literal("complete") }),
  z.object({ type: z.literal("cancelling") }),
  z.object({ type: z.literal("cancelled") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const LibraryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  audio_path: z.string(),
  source_path: z.string(),
  store_original: z.boolean(),
  status: LibraryItemStatusSchema,
  transcript: z.string().nullable().optional(),
  segments: z.array(TranscriptSegmentSchema).nullable().optional(),
  duration_seconds: z.number(),
  file_size_bytes: z.number(),
  original_format: z.string(),
  created_at: z.string(),
  transcribed_at: z.string().nullable().optional(),
  tags: z.array(z.string()),
  llm_cleanup_enabled: z.boolean(),
  speech_model: z.string(),
  show_timestamps: z.boolean(),
});

export const LibraryItemsPageSchema = z.object({
  items: z.array(LibraryItemSchema),
  has_more: z.boolean(),
});

export const LibraryProgressPayloadSchema = z.object({
  id: z.string(),
  progress: z.number(),
  current_chunk: z.number(),
  total_chunks: z.number(),
  chunk_text: z.string().nullable().optional(),
  chunk_segments: z.array(TranscriptSegmentSchema).nullable().optional(),
});

export const LibraryImportProgressPayloadSchema = z.object({
  id: z.string(),
  progress: z.number(),
});

// --- Models ---

export const ModelInfoSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  size_mb: z.number(),
  file_count: z.number(),
  engine_id: z.string(),
  engine: z.string(),
  variant: z.string(),
  tags: z.array(z.string()),
  capabilities: z.array(z.string()),
  supported_languages: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
    }),
  ),
});

export const ModelStatusSchema = z.object({
  key: z.string(),
  installed: z.boolean(),
  bytes_on_disk: z.number(),
  missing_files: z.array(z.string()),
  directory: z.string(),
});

export const DownloadProgressPayloadSchema = z.object({
  model: z.string(),
  file: z.string(),
  downloaded: z.number(),
  total: z.number(),
  percent: z.number(),
});

export const DownloadEventSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle"), percent: z.number(), downloaded: z.number(), total: z.number(), file: z.string().optional() }),
  z.object({ status: z.literal("downloading"), percent: z.number(), downloaded: z.number(), total: z.number(), file: z.string() }),
  z.object({ status: z.literal("complete"), percent: z.number(), downloaded: z.number(), total: z.number() }),
  z.object({ status: z.literal("cancelled"), percent: z.number(), downloaded: z.number(), total: z.number() }),
  z.object({ status: z.literal("error"), percent: z.number(), downloaded: z.number(), total: z.number(), message: z.string() }),
]);

// --- Audio ---

export const DeviceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_default: z.boolean(),
});

// --- Toast ---

export const ToastTypeSchema = z.enum(["error", "info", "success", "warning", "update", "celebration"]);

export const ToastPayloadSchema = z.object({
  type: ToastTypeSchema,
  title: z.string().optional(),
  message: z.string(),
  autoDismiss: z.boolean().optional(),
  duration: z.number().optional(),
  retryId: z.string().optional(),
  mode: z.enum(["local", "cloud"]).optional(),
  action: z.string().optional(),
  actionLabel: z.string().optional(),
});

// --- Pill ---

export const PillStatusSchema = z.enum(["idle", "listening", "processing", "error"]);

export const PillStatePayloadSchema = z.object({
  status: PillStatusSchema,
  mode: z.string().optional(),
});

export const AudioSpectrumPayloadSchema = z.object({
  bins: z.array(z.number()),
});

// --- Inferred types (use these progressively to replace hand-written types) ---

export type ZStoredSettings = z.infer<typeof StoredSettingsSchema>;
export type ZAppInfo = z.infer<typeof AppInfoSchema>;
export type ZTranscriptionRecord = z.infer<typeof TranscriptionRecordSchema>;
export type ZLibraryItem = z.infer<typeof LibraryItemSchema>;
export type ZLibraryItemsPage = z.infer<typeof LibraryItemsPageSchema>;
export type ZLibraryProgressPayload = z.infer<typeof LibraryProgressPayloadSchema>;
export type ZLibraryImportProgressPayload = z.infer<typeof LibraryImportProgressPayloadSchema>;
export type ZModelInfo = z.infer<typeof ModelInfoSchema>;
export type ZModelStatus = z.infer<typeof ModelStatusSchema>;
export type ZDeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type ZToastPayload = z.infer<typeof ToastPayloadSchema>;
export type ZPillStatePayload = z.infer<typeof PillStatePayloadSchema>;
export type ZAudioSpectrumPayload = z.infer<typeof AudioSpectrumPayloadSchema>;
