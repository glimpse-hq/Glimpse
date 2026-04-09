import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryItem,
  LibraryItemsPage,
  LibraryItemPatch,
  LibraryImportOptions,
  LibraryFilter,
  ExportFormat,
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
