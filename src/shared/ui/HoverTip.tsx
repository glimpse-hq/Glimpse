import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type HoverTipProps = {
  label: string;
  detail: string;
  className?: string;
  children: ReactNode;
};

const HoverTip = ({ label, detail, className, children }: HoverTipProps) => {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!anchor || !element) return;
    const margin = 8;
    const width = element.offsetWidth;
    const left = Math.min(
      Math.max(margin, anchor.x - width / 2),
      window.innerWidth - margin - width,
    );
    element.style.left = `${left}px`;
    element.style.top = `${anchor.y - 4}px`;
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [anchor]);

  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
  };
  const hide = () => setAnchor(null);

  return (
    <>
      <span
        className={className}
        onPointerEnter={(event) => show(event.currentTarget)}
        onPointerLeave={hide}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={hide}
      >
        {children}
      </span>
      {anchor &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="settings-typescale ui-surface-menu hover-tip pointer-events-none fixed z-tooltip w-max max-w-64 px-2 py-1 ui-text-micro leading-snug"
          >
            <div className="font-medium ui-color-primary">{label}</div>
            <div className="ui-color-muted">{detail}</div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default HoverTip;
