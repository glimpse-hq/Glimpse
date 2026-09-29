import { useCallback, useState } from "react";

export type LiveTextSize = "small" | "medium" | "large";

export type LivePrefs = {
  textSize: LiveTextSize;
  timestamps: boolean;
  keepOnTop: boolean;
  openOnStart: boolean;
};

const STORAGE_KEY = "glimpse.live.prefs";

const DEFAULTS: LivePrefs = {
  textSize: "medium",
  timestamps: false,
  keepOnTop: true,
  openOnStart: false,
};

export const readLivePrefs = (): LivePrefs => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULTS, ...stored };
  } catch {
    return DEFAULTS;
  }
};

export function useLivePrefs() {
  const [prefs, setPrefs] = useState<LivePrefs>(readLivePrefs);
  const update = useCallback((patch: Partial<LivePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
