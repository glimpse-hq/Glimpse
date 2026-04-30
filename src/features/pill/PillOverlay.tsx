import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import React, { useRef, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useMachine } from "@xstate/react";
import { pillMachine } from "./machine";
import type { PillStatus } from "../../types";

/* ───────────────────────── Constants ───────────────────────── */

interface GridInfo {
  spacing: number;
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
}

const PILL_WIDTH = 97;
const PILL_HEIGHT = 27;
const DOT_SPACING = 3;
const DOT_RADIUS = {
  base: 0.9,
  icon: 1.2,
  wave: 1.0,
  loader: 1.0,
};

const EXPANDED_WIDTH = 260;
const EXPANDED_HEIGHT = 90;
const EXPANDED_BORDER_RADIUS = 24;
const EXPANDED_TEXT_TOP_FADE =
  "linear-gradient(to bottom, rgba(0, 0, 0, 0.96) 0%, rgba(0, 0, 0, 0.82) 38%, rgba(0, 0, 0, 0.38) 74%, transparent 100%)";

const ICONS = {
  warning: [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
  ],
};

// Transition timing — fast-start smooth-end (Apple-style spring)
const EXPAND_TRANSITION = [
  "width 0.5s cubic-bezier(0.32, 0.72, 0, 1)",
  "height 0.5s cubic-bezier(0.32, 0.72, 0, 1)",
  "border-radius 0.5s cubic-bezier(0.32, 0.72, 0, 1)",
].join(", ");

/* ───────────────────────── Color Palette ───────────────────────── */

interface PillColorPalette {
  base: string;
  highlight: string;
  error: string;
}

const FALLBACK_PILL_COLOR_PALETTE: PillColorPalette = {
  base: "40, 40, 40",
  highlight: "255, 255, 255",
  error: "239, 68, 68",
};

const readCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const resolvePillColorPalette = (): PillColorPalette => ({
  base: readCssVar("--ui-pill-dot-base-rgb", FALLBACK_PILL_COLOR_PALETTE.base),
  highlight: readCssVar("--ui-pill-dot-highlight-rgb", FALLBACK_PILL_COLOR_PALETTE.highlight),
  error: readCssVar("--ui-pill-dot-error-rgb", FALLBACK_PILL_COLOR_PALETTE.error),
});

/* ───────────────────────── Drawing Helpers ───────────────────────── */

function getMaskOpacity(x: number, y: number, width: number, height: number): number {
  const radius = height / 2;
  const leftCenter = radius;
  const rightCenter = width - radius;
  let distToEdge: number;

  if (x < leftCenter) {
    const dist = Math.sqrt((x - leftCenter) ** 2 + (y - height / 2) ** 2);
    distToEdge = radius - dist;
  } else if (x > rightCenter) {
    const dist = Math.sqrt((x - rightCenter) ** 2 + (y - height / 2) ** 2);
    distToEdge = radius - dist;
  } else {
    distToEdge = Math.min(y, height - y);
  }

  return Math.max(0, Math.min(1, distToEdge / 15));
}

function isIconPixel(col: number, row: number, icon: number[][], centerCol: number, centerRow: number): boolean {
  const iconH = icon.length;
  const iconW = icon[0].length;
  const startCol = centerCol - Math.floor(iconW / 2);
  const startRow = centerRow - Math.floor(iconH / 2);
  const localCol = col - startCol;
  const localRow = row - startRow;

  if (localCol >= 0 && localCol < iconW && localRow >= 0 && localRow < iconH) {
    return icon[localRow][localCol] === 1;
  }
  return false;
}

/** Prepares a canvas for drawing (clears, scales) and calls the render function. */
function renderToCanvas(
  canvas: HTMLCanvasElement | null,
  grid: GridInfo,
  palette: PillColorPalette,
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, grid: GridInfo, palette: PillColorPalette) => void,
): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  render(ctx, w, h, grid, palette);
}

/* ───────────────────────── Component ───────────────────────── */

interface PillOverlayProps {
  className?: string;
  style?: React.CSSProperties;
  sensitivity?: number;
  decay?: number;
}

interface ExpandedTextSegment {
  key: number;
  text: string;
  isWhitespace: boolean;
}

function getExpandedTextSegments(text: string): ExpandedTextSegment[] {
  let offset = 0;

  return text
    .split(/(\s+)/)
    .filter((segment) => segment !== "")
    .map((segment) => {
      const key = offset;
      offset += segment.length;
      return {
        key,
        text: segment,
        isWhitespace: /^\s+$/.test(segment),
      };
    });
}

const PillOverlay: React.FC<PillOverlayProps> = ({
  className = "",
  style = {},
  sensitivity = 3,
  decay = 0.85,
}) => {
  const { t } = useLingui();
  const [state, send] = useMachine(pillMachine);
  const pillStatus = state.value as PillStatus;
  const { spectrumBins, lastSpectrumAt, isErrorFlashing, isExpanded, expandedText } = state.context;

  // Primary canvas (small pill dots)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridInfo>({ spacing: DOT_SPACING, cols: 0, rows: 0, offsetX: 0, offsetY: 0 });
  const heightsRef = useRef<number[]>([]);

  // Background canvas (expanded pill dots)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const bgContainerRef = useRef<HTMLDivElement>(null);
  const bgGridRef = useRef<GridInfo>({ spacing: DOT_SPACING, cols: 0, rows: 0, offsetX: 0, offsetY: 0 });
  const bgHeightsRef = useRef<number[]>([]);

  // Animation & audio state
  const animationRef = useRef<number | null>(null);
  const loaderTimeRef = useRef<number>(0);
  const colorPaletteRef = useRef<PillColorPalette>(FALLBACK_PILL_COLOR_PALETTE);
  const audioReferenceLevelRef = useRef<number>(0);
  const audioFrameCountRef = useRef<number>(0);

  /** Render to both canvases (primary + background). */
  const renderBoth = useCallback(
    (render: (ctx: CanvasRenderingContext2D, w: number, h: number, grid: GridInfo, palette: PillColorPalette) => void) => {
      const palette = colorPaletteRef.current;
      renderToCanvas(canvasRef.current, gridRef.current, palette, render);
      renderToCanvas(bgCanvasRef.current, bgGridRef.current, palette, render);
    },
    [],
  );

  const refreshColorPalette = useCallback(() => {
    colorPaletteRef.current = resolvePillColorPalette();
  }, []);

  /* ── Draw: Processing (breathing wave) ── */

  const drawProcessingFrame = useCallback((time: number) => {
    renderBoth((ctx, width, height, { cols, rows, spacing, offsetX, offsetY }, palette) => {
      const speed = 0.0015;
      const waveLength = cols * 0.4;
      const breathe = 0.5 + 0.5 * Math.sin(time * 0.001);

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = offsetX + c * spacing + spacing / 2;
          const cy = offsetY + r * spacing + spacing / 2;
          const maskAlpha = getMaskOpacity(cx, cy, width, height);
          if (maskAlpha <= 0.05) continue;

          const distFromCenterY = Math.abs(cy - height / 2);
          const wavePhase = (c / waveLength) - (time * speed);
          const wave = Math.sin(wavePhase * Math.PI * 2) * 0.5 + 0.5;

          const maxRadius = height * 0.4 * (0.6 + 0.4 * breathe);
          const activeRadius = wave * maxRadius;
          const isActive = distFromCenterY < activeRadius;

          ctx.beginPath();
          if (isActive) {
            const edgeFactor = 1 - (distFromCenterY / (activeRadius + 0.5));
            const brightness = Math.pow(edgeFactor, 1.5) * (0.7 + 0.3 * wave);
            ctx.fillStyle = `rgba(${palette.highlight}, ${brightness * maskAlpha})`;
            if (brightness > 0.7) {
              ctx.shadowBlur = 3;
              ctx.shadowColor = `rgba(${palette.highlight}, 0.3)`;
            }
            ctx.arc(cx, cy, DOT_RADIUS.loader, 0, Math.PI * 2);
          } else {
            ctx.fillStyle = `rgba(${palette.base}, ${maskAlpha * 0.4})`;
            ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
          }
          ctx.fill();

          if (isActive) {
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
        }
      }
    });
  }, [renderBoth]);

  /* ── Draw: Error (flashing warning icon) ── */

  const drawErrorFrame = useCallback((time: number) => {
    renderBoth((ctx, width, height, { cols, rows, spacing, offsetX, offsetY }, palette) => {
      const centerCol = Math.floor(cols / 2);
      const centerRow = Math.floor(rows / 2);
      const flash = Math.sin(time * 0.02 * Math.PI * 2);
      const intensity = 0.5 + 0.5 * Math.max(0, flash);

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = offsetX + c * spacing + spacing / 2;
          const cy = offsetY + r * spacing + spacing / 2;
          const maskAlpha = getMaskOpacity(cx, cy, width, height);
          if (maskAlpha <= 0.05) continue;

          const isIcon = isIconPixel(c, r, ICONS.warning, centerCol, centerRow);

          ctx.beginPath();
          if (isIcon) {
            ctx.fillStyle = `rgba(${palette.error}, ${maskAlpha})`;
            ctx.shadowBlur = 6;
            ctx.shadowColor = `rgba(${palette.error}, 0.6)`;
            ctx.arc(cx, cy, DOT_RADIUS.icon, 0, Math.PI * 2);
          } else {
            ctx.fillStyle = `rgba(${palette.error}, ${intensity * maskAlpha * 0.6})`;
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    });
  }, [renderBoth]);

  /* ── Draw: Audio spectrum (listening waveform) ── */

  const drawAudioFrame = useCallback((audioData: Uint8Array) => {
    // Compute audio normalization once (shared across both canvases)
    let normalizationFactor = 1;
    if (audioData.length > 0) {
      let framePeak = 0;
      for (let i = 0; i < audioData.length; i += 4) {
        if (audioData[i] > framePeak) framePeak = audioData[i];
      }

      const SIGNAL_FLOOR = 15;
      const TARGET_PEAK = 200;
      const MIN_REFERENCE = 40;

      audioFrameCountRef.current++;

      if (framePeak > SIGNAL_FLOOR) {
        const frameCount = audioFrameCountRef.current;
        const adaptUp = frameCount < 30 ? 0.3 : 0.1;
        const adaptDown = frameCount < 30 ? 0.05 : 0.005;

        if (framePeak > audioReferenceLevelRef.current) {
          audioReferenceLevelRef.current += (framePeak - audioReferenceLevelRef.current) * adaptUp;
        } else {
          audioReferenceLevelRef.current += (framePeak - audioReferenceLevelRef.current) * adaptDown;
        }
      }

      const effectiveRef = Math.max(audioReferenceLevelRef.current, MIN_REFERENCE);
      normalizationFactor = TARGET_PEAK / effectiveRef;
    }

    // Render to each canvas with its own height array
    const targets = [
      { canvas: canvasRef.current, grid: gridRef.current, heights: heightsRef },
      { canvas: bgCanvasRef.current, grid: bgGridRef.current, heights: bgHeightsRef },
    ] as const;

    const palette = colorPaletteRef.current;

    for (const { canvas, grid, heights } of targets) {
      renderToCanvas(canvas, grid, palette, (ctx, width, height, { cols, rows, spacing, offsetX, offsetY }) => {
        const centerCol = Math.floor(cols / 2);

        if (audioData.length > 0) {
          for (let i = 0; i <= centerCol; i++) {
            const distFromCenter = i / centerCol;
            const freqIndex = Math.floor(audioData.length * 0.4 * (distFromCenter * distFromCenter));
            let sample = audioData[freqIndex] || 0;
            if (audioData[freqIndex + 1]) sample = (sample + audioData[freqIndex + 1]) / 2;

            let val = (sample * normalizationFactor / 255) * sensitivity;
            if (distFromCenter < 0.2) val *= 1.25;
            val = Math.min(val, 1.0);

            const leftIdx = centerCol - i;
            if (leftIdx >= 0 && leftIdx < cols) {
              if (val > heights.current[leftIdx]) {
                heights.current[leftIdx] += (val - heights.current[leftIdx]) * 0.5;
              } else {
                heights.current[leftIdx] += (val - heights.current[leftIdx]) * (1 - decay);
              }
            }

            const rightIdx = centerCol + i;
            if (rightIdx < cols && rightIdx !== leftIdx) {
              heights.current[rightIdx] = heights.current[leftIdx];
            }
          }
        }

        for (let c = 0; c < cols; c++) {
          const amp = heights.current[c] || 0;
          const activeRadiusPixels = amp * (height * 0.45);

          for (let r = 0; r < rows; r++) {
            const cx = offsetX + c * spacing + spacing / 2;
            const cy = offsetY + r * spacing + spacing / 2;
            const maskAlpha = getMaskOpacity(cx, cy, width, height);
            if (maskAlpha <= 0.05) continue;

            const distFromCenterY = Math.abs(cy - height / 2);
            const isWaveActive = activeRadiusPixels > 0.5 && distFromCenterY < activeRadiusPixels;

            ctx.beginPath();
            if (isWaveActive) {
              const waveEdgeDist = 1 - (distFromCenterY / (activeRadiusPixels + 0.1));
              const brightness = 0.5 + (waveEdgeDist * 0.5);
              ctx.fillStyle = `rgba(${palette.highlight}, ${brightness * maskAlpha})`;
              ctx.shadowBlur = brightness > 0.8 ? 4 : 0;
              ctx.shadowColor = brightness > 0.8 ? `rgba(${palette.highlight}, 0.4)` : "transparent";
              ctx.arc(cx, cy, DOT_RADIUS.wave, 0, Math.PI * 2);
            } else {
              ctx.fillStyle = `rgba(${palette.base}, ${maskAlpha})`;
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        }
      });
    }
  }, [decay, sensitivity]);

  /* ── Draw: Idle (static base dots) ── */

  const drawBaseDots = useCallback(() => {
    renderBoth((ctx, width, height, { cols, rows, spacing, offsetX, offsetY }, palette) => {
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = offsetX + c * spacing + spacing / 2;
          const cy = offsetY + r * spacing + spacing / 2;
          const maskAlpha = getMaskOpacity(cx, cy, width, height);
          if (maskAlpha <= 0.05) continue;

          ctx.beginPath();
          ctx.fillStyle = `rgba(${palette.base}, ${maskAlpha})`;
          ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }, [renderBoth]);

  /* ── Draw: Static icon (error settled state) ── */

  const drawStaticIcon = useCallback((icon: number[][], color: string, glowColor?: string) => {
    renderBoth((ctx, width, height, { cols, rows, spacing, offsetX, offsetY }, palette) => {
      const centerCol = Math.floor(cols / 2);
      const centerRow = Math.floor(rows / 2);

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = offsetX + c * spacing + spacing / 2;
          const cy = offsetY + r * spacing + spacing / 2;
          const maskAlpha = getMaskOpacity(cx, cy, width, height);
          if (maskAlpha <= 0.05) continue;

          const isIcon = isIconPixel(c, r, icon, centerCol, centerRow);

          ctx.beginPath();
          if (isIcon) {
            ctx.fillStyle = `rgba(${color}, ${maskAlpha})`;
            ctx.shadowBlur = glowColor ? 8 : 0;
            ctx.shadowColor = glowColor ? `rgba(${glowColor}, 0.5)` : "transparent";
            ctx.arc(cx, cy, DOT_RADIUS.icon, 0, Math.PI * 2);
          } else {
            ctx.fillStyle = `rgba(${palette.base}, ${maskAlpha})`;
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    });
  }, [renderBoth]);

  /* ───────────────────────── Animation Loop ───────────────────────── */

  const stopAllAnimations = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  // Stable refs for the animation loop
  const drawAudioFrameRef = useRef(drawAudioFrame);
  const drawProcessingFrameRef = useRef(drawProcessingFrame);
  const drawErrorFrameRef = useRef(drawErrorFrame);
  const drawBaseDotsRef = useRef(drawBaseDots);
  const drawStaticIconRef = useRef(drawStaticIcon);

  useEffect(() => {
    drawAudioFrameRef.current = drawAudioFrame;
    drawProcessingFrameRef.current = drawProcessingFrame;
    drawErrorFrameRef.current = drawErrorFrame;
    drawBaseDotsRef.current = drawBaseDots;
    drawStaticIconRef.current = drawStaticIcon;
  }, [drawAudioFrame, drawProcessingFrame, drawErrorFrame, drawBaseDots, drawStaticIcon]);

  const spectrumBinsRef = useRef(spectrumBins);
  const lastSpectrumAtRef = useRef(lastSpectrumAt);

  useEffect(() => {
    spectrumBinsRef.current = spectrumBins;
    lastSpectrumAtRef.current = lastSpectrumAt;
  }, [spectrumBins, lastSpectrumAt]);

  useEffect(() => {
    stopAllAnimations();

    if (pillStatus === "idle") {
      drawBaseDotsRef.current();
      return;
    }

    if (pillStatus === "listening") {
      audioReferenceLevelRef.current = 0;
      audioFrameCountRef.current = 0;
      heightsRef.current.fill(0);
    }

    loaderTimeRef.current = 0;
    let animationStartTime: number | null = null;
    const emptySpectrum = new Uint8Array(256);

    const tick = (frameTime: number) => {
      if (animationStartTime === null) {
        animationStartTime = frameTime;
      }
      loaderTimeRef.current = frameTime - animationStartTime;

      switch (pillStatus) {
        case "listening": {
          const now = performance.now();
          const audioData =
            now - lastSpectrumAtRef.current > 250
              ? emptySpectrum
              : spectrumBinsRef.current;
          drawAudioFrameRef.current(audioData);
          break;
        }
        case "processing":
          drawProcessingFrameRef.current(loaderTimeRef.current);
          break;
        case "error":
          if (isErrorFlashing) {
            drawErrorFrameRef.current(loaderTimeRef.current);
          }
          break;
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => stopAllAnimations();
  }, [pillStatus, isErrorFlashing, stopAllAnimations]);

  useEffect(() => {
    if (pillStatus === "error" && !isErrorFlashing) {
      stopAllAnimations();
      const errorColor = colorPaletteRef.current.error;
      drawStaticIconRef.current(ICONS.warning, errorColor, errorColor);
    }
  }, [pillStatus, isErrorFlashing, stopAllAnimations]);

  /* ───────────────────────── Window / Keyboard ───────────────────────── */

  const hideWindow = useCallback(async () => {
    try {
      await invoke("cancel_recording");
      const win = getCurrentWindow();
      await win.hide();
    } catch (err) {
      console.error("Failed to hide window:", err);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pillStatus === "error") {
        e.preventDefault();
        send({ type: "DISMISS" });
        hideWindow();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pillStatus, send, hideWindow]);

  /* ───────────────────────── Canvas Setup ───────────────────────── */

  const setupCanvas = useCallback(() => {
    refreshColorPalette();
    const dpr = window.devicePixelRatio || 1;

    const setupSingle = (
      container: HTMLDivElement | null,
      canvas: HTMLCanvasElement | null,
      gRef: React.MutableRefObject<GridInfo>,
      hRef: React.MutableRefObject<number[]>,
    ) => {
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      const cols = Math.floor(rect.width / DOT_SPACING);
      const rows = Math.floor(rect.height / DOT_SPACING);
      gRef.current = {
        spacing: DOT_SPACING,
        cols,
        rows,
        offsetX: (rect.width - cols * DOT_SPACING) / 2,
        offsetY: (rect.height - rows * DOT_SPACING) / 2,
      };

      if (hRef.current.length !== cols) {
        hRef.current = new Array(cols).fill(0);
      }
    };

    setupSingle(containerRef.current, canvasRef.current, gridRef, heightsRef);
    setupSingle(bgContainerRef.current, bgCanvasRef.current, bgGridRef, bgHeightsRef);

    if (pillStatus === "idle") {
      drawBaseDotsRef.current();
    }
  }, [drawBaseDots, refreshColorPalette, pillStatus]);

  useEffect(() => {
    refreshColorPalette();
  }, [refreshColorPalette]);

  useEffect(() => {
    const observer = new ResizeObserver(setupCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    if (bgContainerRef.current) observer.observe(bgContainerRef.current);
    setupCanvas();
    return () => observer.disconnect();
  }, [setupCanvas]);

  /* ───────────────────────── Render ───────────────────────── */

  const getStatusMessage = (s: PillStatus) => {
    switch (s) {
      case "listening":
        return t({
          id: "pill.status.listening",
          message: "Listening...",
        });
      case "processing":
        return t({
          id: "pill.status.processing",
          message: "Processing...",
        });
      case "error":
        return t({
          id: "pill.status.error",
          message: "Error occurred",
        });
      default: return "";
    }
  };

  const shellWidth = isExpanded ? EXPANDED_WIDTH : PILL_WIDTH;
  const shellHeight = isExpanded ? EXPANDED_HEIGHT : PILL_HEIGHT;
  const shellRadius = isExpanded ? EXPANDED_BORDER_RADIUS : PILL_HEIGHT / 2;
  const shellTransition = isExpanded ? EXPAND_TRANSITION : "none";
  const expandedContentTransition = isExpanded
    ? "opacity 0.35s ease 0.15s, flex 0.5s cubic-bezier(0.32, 0.72, 0, 1)"
    : "none";
  const expandedPaddingTransition = isExpanded
    ? "padding 0.5s cubic-bezier(0.32, 0.72, 0, 1)"
    : "none";
  const topFadeTransition = isExpanded ? "opacity 0.3s ease" : "none";
  const bgOpacityTransition = isExpanded
    ? "opacity 0.6s ease 0.15s"
    : "none";
  const baseOpacityTransition = isExpanded
    ? "opacity 0.4s ease"
    : "none";

  return (
    <div
      className={`relative w-full h-full flex flex-col justify-end select-none ${className}`}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="sr-only" role="status" aria-live="polite">
        {getStatusMessage(pillStatus)}
      </div>
      <div className="relative flex flex-col items-center pb-2">
        {/* Pill shell — transitions between basic and dynamic modes */}
        <div
          className={`relative overflow-hidden border flex flex-col ${isErrorFlashing ? "animate-shake" : ""}`}
          style={{
            width: shellWidth,
            height: shellHeight,
            borderRadius: shellRadius,
            backgroundColor: "var(--ui-pill-shell-bg)",
            borderColor: "var(--ui-pill-shell-border)",
            boxShadow: "var(--ui-pill-shell-shadow)",
            transition: shellTransition,
          }}
        >
          {/* Expanded content area — positioned above background dots */}
          <div
            className="pill-expanded-content relative z-10"
            style={{
              flex: isExpanded ? 1 : 0,
              opacity: isExpanded ? 1 : 0,
              overflow: "hidden",
              minHeight: 0,
              transition: expandedContentTransition,
            }}
          >
            <div
              className="h-full w-full flex flex-col"
              style={{
                padding: isExpanded ? "14px 16px 14px" : "0 16px",
                transition: expandedPaddingTransition,
                position: "relative",
              }}
            >
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-0 pointer-events-none z-20"
                style={{
                  height: 30,
                  background: EXPANDED_TEXT_TOP_FADE,
                  opacity: isExpanded ? 1 : 0,
                  transition: topFadeTransition,
                }}
              />

              <div className="flex-1 w-full overflow-hidden flex flex-col justify-end relative z-10">
                <motion.div
                  layout="position"
                  className="w-full flex flex-col justify-end"
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      lineHeight: "1.5",
                      fontFamily: "'SF Pro Text', 'Inter', system-ui, -apple-system, sans-serif",
                      color: "rgba(255, 255, 255, 0.85)",
                      fontWeight: 400,
                      letterSpacing: "-0.01em",
                      textAlign: "center",
                      width: "100%",
                      wordBreak: "break-word",
                    }}
                  >
                    {expandedText ? getExpandedTextSegments(expandedText).map(({ key, text, isWhitespace }) => {
                      if (isWhitespace) {
                        return (
                          <motion.span
                            key={key}
                            layout="position"
                            transition={{ layout: { type: "spring", bounce: 0, duration: 0.4 } }}
                            style={{ display: "inline-block", whiteSpace: "pre" }}
                          >
                            {text}
                          </motion.span>
                        );
                      }
                      return (
                        <motion.span
                          key={key}
                          layout="position"
                          initial={{ opacity: 0, filter: "blur(4px)", y: 8 }}
                          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                          transition={{
                            opacity: { duration: 0.4, ease: "easeOut" },
                            filter: { duration: 0.4, ease: "easeOut" },
                            y: { duration: 0.4, ease: "easeOut" },
                            layout: { type: "spring", bounce: 0, duration: 0.4 }
                          }}
                          style={{ display: "inline-block", willChange: "transform, opacity, filter" }}
                        >
                          {text}
                        </motion.span>
                      );
                    }) : null}
                  </p>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Background canvas — full expanded size, fades in at low opacity */}
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center z-[1]"
            style={{
              opacity: isExpanded ? 0.08 : 0,
              transition: bgOpacityTransition,
            }}
          >
            <div
              ref={bgContainerRef}
              className="relative overflow-hidden rounded-[inherit]"
              style={{ width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }}
            >
              <canvas
                ref={bgCanvasRef}
                className="absolute inset-0 w-full h-full block"
                role="img"
                aria-label={t({
                  id: "pill.background_visualizer",
                  message: "Background audio visualizer",
                })}
              />
            </div>
          </div>

          {/* Primary canvas — small pill dots, fades out when expanded */}
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center z-[2]"
            style={{
              opacity: isExpanded ? 0 : 1,
              transition: baseOpacityTransition,
            }}
          >
            <div
              ref={containerRef}
              className="relative overflow-hidden rounded-full"
              style={{ width: PILL_WIDTH, height: PILL_HEIGHT }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full block"
                role="img"
                aria-label={t({
                  id: "pill.visualizer",
                  message: "Audio visualizer",
                })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PillOverlay;
