import { useEffect, type RefObject } from "react";

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutsideClick: () => void,
  enabled: boolean = true,
  additionalRefs: Array<RefObject<HTMLElement | null>> = [],
) {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !ref.current ||
        ref.current.contains(target) ||
        additionalRefs.some((candidate) => candidate.current?.contains(target))
      ) {
        return;
      }
      onOutsideClick();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [additionalRefs, enabled, onOutsideClick, ref]);
}
