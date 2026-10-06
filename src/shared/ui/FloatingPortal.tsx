import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type FloatingPlacement =
  "bottom-start" | "bottom-end" | "top-start" | "top-end";

type FloatingPortalProps = {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  placement?: FloatingPlacement;
  offset?: number;
  viewportPadding?: number;
  matchAnchorWidth?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  role?: string;
};

const FloatingPortal = forwardRef<HTMLDivElement, FloatingPortalProps>(
  function FloatingPortal(
    {
      anchorRef,
      children,
      placement = "bottom-start",
      offset = 6,
      viewportPadding = 8,
      matchAnchorWidth = false,
      className = "",
      style,
      onClick,
      role,
    },
    forwardedRef,
  ) {
    const floatingRef = useRef<HTMLDivElement>(null);
    const contextClassName = anchorRef.current?.closest(".settings-typescale")
      ? "settings-typescale"
      : "";
    const [position, setPosition] = useState<CSSProperties>({
      left: 0,
      top: 0,
      visibility: "hidden",
    });

    useImperativeHandle(forwardedRef, () => floatingRef.current!, []);

    useLayoutEffect(() => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;

      let animationFrame = 0;
      const updatePosition = () => {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = window.requestAnimationFrame(() => {
          const anchorRect = anchor.getBoundingClientRect();
          const floatingRect = floating.getBoundingClientRect();
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const width = matchAnchorWidth
            ? anchorRect.width
            : floatingRect.width;
          const height = floatingRect.height;
          const prefersTop = placement.startsWith("top");
          const spaceAbove = anchorRect.top - viewportPadding - offset;
          const spaceBelow =
            viewportHeight - anchorRect.bottom - viewportPadding - offset;
          const openTop = prefersTop
            ? spaceAbove >= Math.min(height, spaceBelow)
            : spaceBelow < height && spaceAbove > spaceBelow;

          let top = openTop
            ? anchorRect.top - height - offset
            : anchorRect.bottom + offset;
          top = Math.min(
            Math.max(viewportPadding, top),
            Math.max(
              viewportPadding,
              viewportHeight - height - viewportPadding,
            ),
          );

          const alignEnd = placement.endsWith("end");
          let left = alignEnd ? anchorRect.right - width : anchorRect.left;
          left = Math.min(
            Math.max(viewportPadding, left),
            Math.max(viewportPadding, viewportWidth - width - viewportPadding),
          );

          setPosition({
            left,
            right: "auto",
            top,
            width: matchAnchorWidth ? anchorRect.width : undefined,
            maxWidth: viewportWidth - viewportPadding * 2,
            maxHeight: Math.min(
              viewportHeight - viewportPadding * 2,
              Math.max(80, (openTop ? spaceAbove : spaceBelow) + offset),
            ),
            overflowX: "hidden",
            overflowY: "auto",
            visibility: "visible",
          });
        });
      };

      updatePosition();
      const observer = new ResizeObserver(updatePosition);
      observer.observe(anchor);
      observer.observe(floating);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        observer.disconnect();
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }, [anchorRef, matchAnchorWidth, offset, placement, viewportPadding]);

    return createPortal(
      <div
        ref={floatingRef}
        role={role}
        className={`fixed z-[1000] ${contextClassName} ${className}`}
        style={{ ...position, ...style }}
        onClick={onClick}
      >
        {children}
      </div>,
      document.body,
    );
  },
);

export default FloatingPortal;
