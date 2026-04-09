export type InstalledApp = {
  name: string;
  path: string;
  icon_path?: string | null;
};

export type WebsiteIcon = {
  site: string;
  icon_path?: string | null;
};

export const MAX_INSTRUCTIONS_CHARS = 3000;
export const DEFAULT_INSTRUCTIONS_HEIGHT = 128;
const MIN_INSTRUCTIONS_HEIGHT = Math.round(
  DEFAULT_INSTRUCTIONS_HEIGHT * 0.8,
);
const MAX_INSTRUCTIONS_HEIGHT = Math.round(
  DEFAULT_INSTRUCTIONS_HEIGHT * 2.5,
);

export const normalizeEntry = (value: string) => value.trim();

const toCodePoints = (value: string) => Array.from(value);

export const countInstructionsChars = (value: string) =>
  toCodePoints(value).length;

export const clampInstructionsText = (value: string) => {
  const codePoints = toCodePoints(value);
  if (codePoints.length <= MAX_INSTRUCTIONS_CHARS) {
    return value;
  }
  return codePoints.slice(0, MAX_INSTRUCTIONS_CHARS).join("");
};

export const clampInstructionsHeight = (value: number) =>
  Math.min(MAX_INSTRUCTIONS_HEIGHT, Math.max(MIN_INSTRUCTIONS_HEIGHT, value));

export const normalizeWebsite = (value: string) => {
  let trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  trimmed = trimmed.replace(/^https?:\/\//, "");
  trimmed = trimmed.replace(/^www\./, "");
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    trimmed = trimmed.slice(0, slashIndex);
  }
  return trimmed;
};

export const formatWebsitePreview = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) return trimmed;
  return trimmed.slice(0, dotIndex);
};

export const isValidDomain = (value: string) => {
  const domain = value.trim().toLowerCase();
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-z0-9-]+$/.test(label);
  });
};

export const createId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `mode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const getInitials = (value: string) => {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

export const getWebsiteFallback = (site: string) => {
  const normalized = normalizeWebsite(site);
  const preview = formatWebsitePreview(normalized || site).trim();
  if (!preview) {
    return "\u2022";
  }
  return preview.slice(0, 1).toUpperCase();
};

export const buildWebsiteIconMap = (entries: WebsiteIcon[]) => {
  const next: Record<string, string> = {};
  for (const entry of entries) {
    const key = normalizeWebsite(entry.site);
    if (key && entry.icon_path) {
      next[key] = entry.icon_path;
    }
  }
  return next;
};
