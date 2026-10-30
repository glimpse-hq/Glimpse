import type { ModelInfo } from "../../types";

export type TranscriptionLanguageOption = {
  code: string;
  name: string;
  locked?: boolean;
  isHeader?: boolean;
  prominentHeader?: boolean;
  description?: string;
};

export const languageName = (code: string, locale: string) => {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
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

export function languageSupportedByAny(
  models: ModelInfo[],
  language: string,
): boolean {
  return (
    !language.trim() ||
    models.some((model) => languageSupportedByModel(model, language))
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
  models: ModelInfo[],
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
    if (remoteSpeechActive || languageSupportedByAny(models, language.code)) {
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
