import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusableIn = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );

// Open modals and menus, newest last. Their keydown listeners all sit on
// document and run in the order they were added, so each one handles keys only
// while it is the newest. A menu opened inside a modal gets Escape and Tab
// before the modal does.
const layers: symbol[] = [];

export function openLayer() {
  const token = Symbol();
  layers.push(token);
  return {
    isTop: () => layers[layers.length - 1] === token,
    close: () => {
      const index = layers.indexOf(token);
      if (index !== -1) layers.splice(index, 1);
    },
  };
}

// Moves focus into a modal when it opens, keeps Tab inside it, and gives focus
// back to whatever had it before once the modal closes. Escape calls onEscape.
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onEscape?: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const layer = openLayer();
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      const target = focusableIn(root)[0] ?? root;
      if (target === root && !root.hasAttribute("tabindex")) {
        root.setAttribute("tabindex", "-1");
      }
      target.focus({ preventScroll: true });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !layer.isTop()) return;
      if (event.key === "Escape") {
        const escape = onEscapeRef.current;
        if (!escape) return;
        event.preventDefault();
        event.stopPropagation();
        escape();
        return;
      }
      if (event.key !== "Tab") return;
      const container = ref.current;
      if (!container) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !container.contains(current);
      if (event.shiftKey && (outside || current === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      layer.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
