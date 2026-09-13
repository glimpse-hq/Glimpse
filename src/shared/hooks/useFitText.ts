import { useLayoutEffect, useRef } from "react";

export function useFitText<T extends HTMLElement>(
  text: string,
  baseSize: string,
  minScale = 0.72,
) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.fontSize = baseSize;
    const { scrollWidth, clientWidth } = element;
    if (scrollWidth > clientWidth && clientWidth > 0) {
      const base = parseFloat(getComputedStyle(element).fontSize);
      const scale = Math.max(minScale, clientWidth / scrollWidth);
      element.style.fontSize = `${base * scale}px`;
    }
  }, [text, baseSize, minScale]);

  return ref;
}
