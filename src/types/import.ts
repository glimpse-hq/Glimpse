export interface DetectedApp {
  id: string;
  name: string;
}

export interface ImportPreview {
  id: string;
  name: string;
  dictionaryCount: number;
  replacementsCount: number;
  personalitiesCount: number;
  shortcut: string | null;
  language: string | null;
  autoLaunch: boolean | null;
  modelSource: string | null;
  modelKey: string | null;
  modelRecognized: boolean;
  transcriptCount: number;
}

export interface ImportSelections {
  dictionary: boolean;
  replacements: boolean;
  personalities: boolean;
  shortcut: boolean;
  language: boolean;
  autoLaunch: boolean;
  model: boolean;
  history: boolean;
}

export interface ImportResult {
  dictionaryAdded: number;
  replacementsAdded: number;
  personalitiesAdded: number;
  shortcutApplied: boolean;
  shortcut: string | null;
  languageApplied: boolean;
  autoLaunchApplied: boolean;
  modelKey: string | null;
  modelUnrecognized: boolean;
  transcriptsAdded: number;
}
