import type { ModelInfo } from "../../types";

export type ModelStats = {
  languagesLabel: string;
  englishOnly: boolean;
};

export const formatModelSize = (mb: number): string =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;

export const variantLabel = (variant: string): string => variant.split("_")[0];

export const formatQuantLabel = (variant: string): string | null => {
  if (!variant) return null;
  const label = variantLabel(variant);
  return label === "Multilingual" ? null : label;
};

export const deriveModelStats = (model: ModelInfo): ModelStats => {
  const langCount = model.supported_languages.length;
  const tagSet = model.tags.map((tag) => tag.toLowerCase());
  const englishOnly = tagSet.includes("english")
    ? true
    : tagSet.includes("multilingual")
      ? false
      : langCount <= 1 ||
        model.supported_languages.every((l) =>
          l.code.toLowerCase().startsWith("en"),
        );
  const languagesLabel = englishOnly ? "English only" : `${langCount} languages`;

  return {
    languagesLabel,
    englishOnly,
  };
};
