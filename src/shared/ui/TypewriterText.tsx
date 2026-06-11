import {
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
} from "react";

export function useTypewriter(text: string, speedMs = 20, delayMs = 0): string {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    setDisplayed("");
    if (!text) return undefined;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayed(text);
      return undefined;
    }

    let cancelled = false;
    let index = 0;
    let timeoutId: number | null = null;

    const typeNext = () => {
      if (cancelled || index >= text.length) return;
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) return;
      timeoutId = window.setTimeout(typeNext, speedMs);
    };

    timeoutId = window.setTimeout(typeNext, delayMs);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [text, speedMs, delayMs]);

  return displayed;
}

export function estimateTypewriterMs(
  text: string,
  speedMs = 20,
  delayMs = 0,
): number {
  return delayMs + text.length * speedMs;
}

type TypewriterTextProps = {
  text: string;
  speedMs?: number;
  delayMs?: number;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
};

export function TypewriterText({
  text,
  speedMs = 20,
  delayMs = 0,
  className,
  style,
  as: Tag = "span",
}: TypewriterTextProps) {
  const displayed = useTypewriter(text, speedMs, delayMs);

  return (
    <Tag className={className} style={style}>
      {displayed}
    </Tag>
  );
}
