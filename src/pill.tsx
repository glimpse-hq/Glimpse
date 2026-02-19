import React, { useRef, useEffect, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { PillStatus, PillStatePayload, AudioSpectrumPayload } from "./types";

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

const ICONS = {
  warning: [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
  ],
};

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

interface PillOverlayProps {
  className?: string;
  style?: React.CSSProperties;
  sensitivity?: number;
  decay?: number;
}

const PillOverlay: React.FC<PillOverlayProps> = ({
  className = "",
  style = {},
  sensitivity = 3,
  decay = 0.85,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridInfo>({ spacing: DOT_SPACING, cols: 0, rows: 0, offsetX: 0, offsetY: 0 });
  const heightsRef = useRef<number[]>([]);
  const animationRef = useRef<number | null>(null);
  const loaderTimeRef = useRef<number>(0);
  const audioDataRef = useRef<Uint8Array>(new Uint8Array(256));
  const emptyAudioDataRef = useRef<Uint8Array>(new Uint8Array(256));
  const lastAudioDataAtRef = useRef<number>(0);
  const audioReferenceLevelRef = useRef<number>(0);
  const audioFrameCountRef = useRef<number>(0);

  const [status, setStatus] = useState<PillStatus>("idle");
  const statusRef = useRef<PillStatus>("idle");
  const [isErrorFlashing, setIsErrorFlashing] = useState(false);
  const colorPaletteRef = useRef<PillColorPalette>(FALLBACK_PILL_COLOR_PALETTE);

  const refreshColorPalette = useCallback(() => {
    colorPaletteRef.current = resolvePillColorPalette();
  }, []);

  const getMaskOpacity = useCallback((x: number, y: number, width: number, height: number): number => {
    const radius = height / 2;
    const leftCenter = radius;
    const rightCenter = width - radius;
    let distToEdge = 0;

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
  }, []);

  const isIconPixel = useCallback((col: number, row: number, icon: number[][], centerCol: number, centerRow: number): boolean => {
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
  }, []);

  const drawProcessingFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { cols, rows, spacing, offsetX, offsetY } = gridRef.current;
    const colorPalette = colorPaletteRef.current;

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

          ctx.fillStyle = `rgba(${colorPalette.highlight}, ${brightness * maskAlpha})`;
          if (brightness > 0.7) {
            ctx.shadowBlur = 3;
            ctx.shadowColor = `rgba(${colorPalette.highlight}, 0.3)`;
          }
          ctx.arc(cx, cy, DOT_RADIUS.loader, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = `rgba(${colorPalette.base}, ${maskAlpha * 0.4})`;
          ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
        }
        ctx.fill();

        if (isActive) {
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
        }
      }
    }
  }, [getMaskOpacity]);

  const drawErrorFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { cols, rows, spacing, offsetX, offsetY } = gridRef.current;
    const centerCol = Math.floor(cols / 2);
    const centerRow = Math.floor(rows / 2);
    const colorPalette = colorPaletteRef.current;

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
          ctx.fillStyle = `rgba(${colorPalette.error}, ${maskAlpha})`;
          ctx.shadowBlur = 6;
          ctx.shadowColor = `rgba(${colorPalette.error}, 0.6)`;
          ctx.arc(cx, cy, DOT_RADIUS.icon, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = `rgba(${colorPalette.error}, ${intensity * maskAlpha * 0.6})`;
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }, [getMaskOpacity, isIconPixel]);

  const drawAudioFrame = useCallback((audioData: Uint8Array) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { cols, rows, spacing, offsetX, offsetY } = gridRef.current;
    const centerCol = Math.floor(cols / 2);
    const colorPalette = colorPaletteRef.current;

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
        // Adaptive rate: fast in first ~30 frames (~0.5s), then stabilize
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
      const normalizationFactor = TARGET_PEAK / effectiveRef;

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
          if (val > heightsRef.current[leftIdx]) {
            heightsRef.current[leftIdx] += (val - heightsRef.current[leftIdx]) * 0.5;
          } else {
            heightsRef.current[leftIdx] += (val - heightsRef.current[leftIdx]) * (1 - decay);
          }
        }

        const rightIdx = centerCol + i;
        if (rightIdx < cols && rightIdx !== leftIdx) {
          heightsRef.current[rightIdx] = heightsRef.current[leftIdx];
        }
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let c = 0; c < cols; c++) {
      const amp = heightsRef.current[c] || 0;
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
          ctx.fillStyle = `rgba(${colorPalette.highlight}, ${brightness * maskAlpha})`;
          ctx.shadowBlur = brightness > 0.8 ? 4 : 0;
          ctx.shadowColor = brightness > 0.8 ? `rgba(${colorPalette.highlight}, 0.4)` : "transparent";
          ctx.arc(cx, cy, DOT_RADIUS.wave, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = `rgba(${colorPalette.base}, ${maskAlpha})`;
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }, [decay, getMaskOpacity, sensitivity]);

  const drawBaseDots = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { cols, rows, spacing, offsetX, offsetY } = gridRef.current;
    const colorPalette = colorPaletteRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const cx = offsetX + c * spacing + spacing / 2;
        const cy = offsetY + r * spacing + spacing / 2;
        const maskAlpha = getMaskOpacity(cx, cy, width, height);
        if (maskAlpha <= 0.05) continue;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${colorPalette.base}, ${maskAlpha})`;
        ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [getMaskOpacity]);

  const drawStaticIcon = useCallback((icon: number[][], color: string, glowColor?: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const { cols, rows, spacing, offsetX, offsetY } = gridRef.current;
    const centerCol = Math.floor(cols / 2);
    const centerRow = Math.floor(rows / 2);
    const colorPalette = colorPaletteRef.current;

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
          ctx.fillStyle = `rgba(${colorPalette.base}, ${maskAlpha})`;
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.arc(cx, cy, DOT_RADIUS.base, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }, [getMaskOpacity, isIconPixel]);

  const stopAllAnimations = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const runAnimation = useCallback((type: "processing" | "listening" | "error") => {
    stopAllAnimations();
    loaderTimeRef.current = 0;

    const tick = () => {
      loaderTimeRef.current += 16;

      switch (type) {
        case "processing":
          drawProcessingFrame(loaderTimeRef.current);
          break;
        case "listening": {
          const now = performance.now();
          const audioData =
            now - lastAudioDataAtRef.current > 250
              ? emptyAudioDataRef.current
              : audioDataRef.current;
          drawAudioFrame(audioData);
          break;
        }
        case "error":
          drawErrorFrame(loaderTimeRef.current);
          break;
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
  }, [drawAudioFrame, drawErrorFrame, drawProcessingFrame, stopAllAnimations]);

  const fadeOutWave = useCallback(() => {
    let hasActivity = false;
    for (let i = 0; i < heightsRef.current.length; i++) {
      heightsRef.current[i] *= 0.8;
      if (heightsRef.current[i] > 0.01) hasActivity = true;
    }

    if (hasActivity) {
      drawAudioFrame(emptyAudioDataRef.current);
      animationRef.current = requestAnimationFrame(fadeOutWave);
    } else {
      heightsRef.current.fill(0);
      drawBaseDots();
    }
  }, [drawAudioFrame, drawBaseDots]);

  const hideWindow = useCallback(async () => {
    try {
        invoke("cancel_recording");
        const window = getCurrentWindow();
        await window.hide();
    } catch (err) {
        console.error("Failed to hide window:", err);
    }
  }, []);

  const dismissOverlay = useCallback(() => {
    setStatus("idle");
    setIsErrorFlashing(false);
    hideWindow();
  }, [hideWindow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status === "error") {
        e.preventDefault();
        dismissOverlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, dismissOverlay]);

  const runAnimationRef = useRef(runAnimation);
  const stopAllAnimationsRef = useRef(stopAllAnimations);
  const drawBaseDotsRef = useRef(drawBaseDots);

  useEffect(() => {
    runAnimationRef.current = runAnimation;
    stopAllAnimationsRef.current = stopAllAnimations;
    drawBaseDotsRef.current = drawBaseDots;
  }, [runAnimation, stopAllAnimations, drawBaseDots]);

  useEffect(() => {
    refreshColorPalette();
  }, [refreshColorPalette]);

  useEffect(() => {
    const unlistenPromise = listen<AudioSpectrumPayload>("audio:spectrum", (e) => {
      const bins = e.payload.bins;
      const current = audioDataRef.current;
      if (current.length !== bins.length) {
        audioDataRef.current = new Uint8Array(bins);
        emptyAudioDataRef.current = new Uint8Array(bins.length);
      } else {
        for (let i = 0; i < bins.length; i++) {
          current[i] = bins[i] ?? 0;
        }
      }
      lastAudioDataAtRef.current = performance.now();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<PillStatePayload>("pill:state", (e) => {
      const prev = statusRef.current;
      const next = e.payload.status;

      if (next === "listening" && prev !== "listening") {
        audioDataRef.current = emptyAudioDataRef.current;
        lastAudioDataAtRef.current = 0;
        audioReferenceLevelRef.current = 0;
        audioFrameCountRef.current = 0;
        heightsRef.current.fill(0);
        runAnimationRef.current("listening");
      }

      statusRef.current = next;
      setStatus(next);

      if (next === "processing") {
        runAnimationRef.current("processing");
      } else if (next === "error") {
        setIsErrorFlashing(true);
        runAnimationRef.current("error");
        setTimeout(() => setIsErrorFlashing(false), 1200);
      } else if (next === "idle") {
        stopAllAnimationsRef.current();
        drawBaseDotsRef.current();
      }
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
      stopAllAnimationsRef.current();
    };
  }, []);

  useEffect(() => {
    if (status === "error" && !isErrorFlashing) {
      stopAllAnimations();
      const errorColor = colorPaletteRef.current.error;
      drawStaticIcon(ICONS.warning, errorColor, errorColor);
    }
  }, [status, isErrorFlashing, drawStaticIcon, stopAllAnimations]);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    refreshColorPalette();

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    const cols = Math.floor(rect.width / DOT_SPACING);
    const rows = Math.floor(rect.height / DOT_SPACING);
    gridRef.current = {
      spacing: DOT_SPACING,
      cols,
      rows,
      offsetX: (rect.width - cols * DOT_SPACING) / 2,
      offsetY: (rect.height - rows * DOT_SPACING) / 2,
    };

    if (heightsRef.current.length !== cols) {
      heightsRef.current = new Array(cols).fill(0);
    }
    
    if (statusRef.current === "idle") {
        drawBaseDots();
    }
  }, [drawBaseDots, refreshColorPalette]);

  useEffect(() => {
    const observer = new ResizeObserver(setupCanvas);
    if (containerRef.current) observer.observe(containerRef.current);
    setupCanvas();
    return () => observer.disconnect();
  }, [setupCanvas]);

  const getStatusMessage = (s: PillStatus) => {
    switch (s) {
      case "listening": return "Listening...";
      case "processing": return "Processing...";
      case "error": return "Error occurred";
      default: return "";
    }
  };

  return (
    <div
      className={`relative w-full h-full flex flex-col justify-end select-none ${className}`}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="sr-only" role="status" aria-live="polite">
        {getStatusMessage(status)}
      </div>
      <div className="relative flex flex-col items-center pb-2">
        <div
          ref={containerRef}
          className={`relative overflow-hidden rounded-full border ${isErrorFlashing ? "animate-shake" : ""}`}
          style={{
            width: PILL_WIDTH,
            height: PILL_HEIGHT,
            backgroundColor: "var(--ui-pill-shell-bg)",
            borderColor: "var(--ui-pill-shell-border)",
            boxShadow: "var(--ui-pill-shell-shadow)",
          }}
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full block"
            role="img"
            aria-label="Audio visualizer"
          />
        </div>
      </div>
    </div>
  );
};

export default PillOverlay;
