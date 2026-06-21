import { useCallback, useEffect, useRef, useState } from "react";

// Copy text to the clipboard and flag `copied` for `resetMs`, then clear it.
// `reset` clears the flag early (e.g. when the surrounding UI closes).
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clear();
    setCopied(false);
  }, [clear]);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        clear();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, resetMs);
        return true;
      } catch (err) {
        console.error("Failed to copy:", err);
        setCopied(false);
        return false;
      }
    },
    [clear, resetMs],
  );

  useEffect(() => clear, [clear]);

  return { copied, copy, reset };
}
