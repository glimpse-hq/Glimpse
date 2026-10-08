import { useEffect, useRef, type RefObject } from "react";
import { focusableIn, openLayer } from "./useFocusTrap";

const ITEMS = ["menuitem", "menuitemcheckbox", "menuitemradio", "option"]
  .map((role) => `[role="${role}"]:not([disabled])`)
  .join(", ");

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target.closest("input, textarea, [contenteditable='true']") !== null;

// Keyboard behavior for a popup menu, listbox, or popover: focus moves into it
// on open, arrow keys move between items, and Escape (or Tab out of a list)
// closes it with focus back on the control that opened it. Fields inside that
// handle Escape themselves call preventDefault, which leaves the popup open.
// Only the newest open menu or modal handles keys, so a modal underneath does
// not close or trap Tab, and Escape stops here before window listeners.
export function useMenuKeyboard<T extends HTMLElement>(
  ref: RefObject<T | null>,
  open: boolean,
  close: () => void,
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const layer = openLayer();
    // A mouse click leaves focus on the body in WebKit; there is no opener
    // to return to then.
    const opener =
      document.activeElement === document.body
        ? null
        : (document.activeElement as HTMLElement | null);
    const frame = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      const first =
        root.querySelector<HTMLElement>('[aria-selected="true"]') ??
        root.querySelector<HTMLElement>(ITEMS) ??
        focusableIn(root)[0];
      first?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const root = ref.current;
      if (!root || event.defaultPrevented || !layer.isTop()) return;
      const inside = root.contains(event.target as Node);
      const items = Array.from(root.querySelectorAll<HTMLElement>(ITEMS));
      const tabOut = event.key === "Tab" && inside && items.length > 0;
      if (event.key === "Escape" || tabOut) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        return;
      }
      if (!inside || items.length === 0) return;
      const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
      if (isEditable(event.target) && !arrow) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: number | null = null;
      if (event.key === "ArrowDown") next = (index + 1) % items.length;
      else if (event.key === "ArrowUp")
        next = index <= 0 ? items.length - 1 : index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      if (next === null) return;
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      layer.close();
      const root = ref.current;
      if (
        opener?.isConnected &&
        (document.activeElement === document.body ||
          (root && root.contains(document.activeElement)))
      ) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}
