import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  LibraryItem,
  LibraryItemsPage,
  LibraryItemPatch,
  LibraryImportOptions,
  LibraryFilter,
  ExportFormat,
  LibraryProgressPayload,
  LibraryImportProgressPayload,
} from "../../types";

export async function createLibraryItem(
  path: string,
  options: LibraryImportOptions,
): Promise<LibraryItem> {
  return invoke<LibraryItem>("create_library_item", { path, options });
}

export async function getLibraryItemsPage(
  filter: LibraryFilter,
  limit: number,
  offset: number,
): Promise<LibraryItemsPage> {
  return invoke<LibraryItemsPage>("get_library_items_page", {
    filter,
    limit,
    offset,
  });
}

export async function updateLibraryItem(
  id: string,
  patch: LibraryItemPatch,
): Promise<LibraryItem> {
  return invoke<LibraryItem>("update_library_item", { id, patch });
}

export async function deleteLibraryItem(id: string): Promise<void> {
  await invoke("delete_library_item", { id });
}

export async function cancelLibraryTranscription(id: string): Promise<void> {
  await invoke("cancel_library_transcription", { id });
}

export async function retryLibraryTranscription(id: string): Promise<void> {
  await invoke("retry_library_transcription", { id });
}

export async function exportLibraryItemToPath(
  id: string,
  format: ExportFormat,
  outputPath: string,
): Promise<void> {
  await invoke("export_library_item_to_path", { id, format, outputPath });
}

export async function getLibraryTags(): Promise<string[]> {
  return invoke<string[]>("get_library_tags");
}

export function onTranscriptionProgress(
  handler: (payload: LibraryProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<LibraryProgressPayload>(
    "library:transcription_progress",
    (e) => handler(e.payload),
  );
}

export function onTranscriptionComplete(
  handler: (payload: { id: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string }>("library:transcription_complete", (e) =>
    handler(e.payload),
  );
}

export function onTranscriptionError(
  handler: (payload: { id: string; message: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ id: string; message: string }>(
    "library:transcription_error",
    (e) => handler(e.payload),
  );
}

export function onImportProgress(
  handler: (payload: LibraryImportProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<LibraryImportProgressPayload>(
    "library:import_progress",
    (e) => handler(e.payload),
  );
}

export function onOpenImport(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return listen<string[]>("library:open_import", (e) =>
    handler(e.payload),
  );
}
