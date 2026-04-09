import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionRecord } from "../../types";

export async function getTranscriptions(
  searchQuery: string | null,
): Promise<TranscriptionRecord[]> {
  return invoke<TranscriptionRecord[]>("get_transcriptions", { searchQuery });
}

export async function deleteTranscription(id: string): Promise<void> {
  await invoke("delete_transcription", { id });
}

export async function retryTranscription(id: string): Promise<void> {
  await invoke("retry_transcription", { id });
}

export async function cancelRetryTranscription(id: string): Promise<void> {
  await invoke("cancel_retry_transcription", { id });
}

export async function retryLlmCleanup(id: string): Promise<void> {
  await invoke("retry_llm_cleanup", { id });
}

export async function undoLlmCleanup(id: string): Promise<void> {
  await invoke("undo_llm_cleanup", { id });
}

export async function deleteAllTranscriptions(): Promise<void> {
  await invoke("delete_all_transcriptions");
}
