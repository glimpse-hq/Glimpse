import type { ModelInfo } from "../../types";

export type TranscriptionLanguageOption = {
  code: string;
  name: string;
  locked?: boolean;
  isHeader?: boolean;
  prominentHeader?: boolean;
  description?: string;
};

export function languageSupportedByModel(
  model: ModelInfo | undefined,
  language: string,
): boolean {
  const code = language.trim();
  if (!code) return true;
  return Boolean(
    model?.supported_languages.some((entry) => entry.code === code),
  );
}

export function collectAllTranscriptionLanguages(
  models: ModelInfo[],
): TranscriptionLanguageOption[] {
  const seen = new Map<string, string>();
  for (const model of models) {
    for (const language of model.supported_languages) {
      const code = language.code.trim();
      if (!code || seen.has(code)) continue;
      seen.set(code, language.name);
    }
  }
  return [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildActiveTranscriptionLanguageOptions(
  model: ModelInfo | undefined,
  allLanguages: TranscriptionLanguageOption[],
  remoteSpeechActive: boolean,
  autoLabel: string,
  unsupportedLabel: string,
  unsupportedDescription: string,
): TranscriptionLanguageOption[] {
  const supported: TranscriptionLanguageOption[] = [
    { code: "", name: autoLabel },
  ];
  const locked: TranscriptionLanguageOption[] = [];
  for (const language of allLanguages) {
    if (remoteSpeechActive || languageSupportedByModel(model, language.code)) {
      supported.push({ ...language, locked: false });
    } else {
      locked.push({ ...language, locked: true });
    }
  }

  if (locked.length === 0) return supported;
  return [
    ...supported,
    {
      code: "__unsupported__",
      name: unsupportedLabel,
      isHeader: true,
      prominentHeader: true,
      description: unsupportedDescription,
    },
    ...locked,
  ];
}
