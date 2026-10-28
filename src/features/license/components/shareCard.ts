import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import {
  activityLevel,
  type ActivityCell,
} from "../../transcriptions/dictationActivity";

export const CARD = 1080;

export type ShareCardLabels = {
  wordsAMinute: string;
  fasterInline: string;
  daysHeadline: string;
  ofDictating: string;
  words: string;
  dictations: string;
  saved: string;
};

export type ShareCardData = {
  labels: ShareCardLabels;
  rtl: boolean;
  locale: string;
  words: string;
  wpm: number;
  fasterPercent: number;
  timeSaved: string;
  dictations: string;
  grid: ActivityCell[][];
  busiest: number;
};

export type ShareStyle = {
  id: string;
  label: MessageDescriptor;
  draw: (ctx: CanvasRenderingContext2D, data: ShareCardData) => void;
};

const INK = "#201d19";
const PAPER = "#f5f1e8";
const AMBER = "#e4b54e";
const WHITE = "#f5efe2";
const MARGIN = 76;
const WIDTH = CARD - MARGIN * 2;
const SANS = "Satoshi, system-ui, sans-serif";
const DISPLAY = '"Glimpse Editorial", Georgia, serif';
const artwork: Partial<
  Record<"words" | "speed" | "activity", HTMLImageElement>
> = {};

const text = (
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  width = WIDTH,
  display = false,
) => {
  let current = size;
  const family = display ? DISPLAY : SANS;
  ctx.font = `400 ${current}px ${family}`;
  while (ctx.measureText(value).width > width && current > 16) {
    current -= 2;
    ctx.font = `400 ${current}px ${family}`;
  }
  ctx.fillText(value, x, y);
};

const header = (
  ctx: CanvasRenderingContext2D,
  style: "words" | "speed" | "activity",
) => {
  const dark = style === "speed";
  ctx.fillStyle = dark ? "#191817" : style === "activity" ? "#eae3f0" : PAPER;
  ctx.fillRect(0, 0, CARD, CARD);
  const image = artwork[style];
  if (image) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, CARD, CARD);
  }
  ctx.save();
  ctx.translate(MARGIN - 2, 73);
  ctx.scale(49 / 48, 49 / 48);
  ctx.fillStyle = "#a5b3fe";
  ctx.beginPath();
  ctx.moveTo(36, 0);
  ctx.bezierCurveTo(42.6, 0, 48, 5.4, 48, 12);
  ctx.bezierCurveTo(48, 18.6, 42.6, 24, 36, 24);
  ctx.bezierCurveTo(29.4, 24, 24, 29.4, 24, 36);
  ctx.bezierCurveTo(24, 42.6, 18.6, 48, 12, 48);
  ctx.bezierCurveTo(5.4, 48, 0, 42.6, 0, 36);
  ctx.bezierCurveTo(0, 29.4, 5.4, 24, 12, 24);
  ctx.bezierCurveTo(18.6, 24, 24, 18.6, 24, 12);
  ctx.bezierCurveTo(24, 5.4, 29.4, 0, 36, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fbbf24";
  [12, 36].forEach((center) => {
    ctx.beginPath();
    ctx.arc(center, center, 12, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  ctx.fillStyle = dark ? WHITE : INK;
  text(ctx, "Glimpse", MARGIN + 76, 126, 54, 290, true);
};

const footer = (ctx: CanvasRenderingContext2D, dark = false) => {
  ctx.fillStyle = dark ? WHITE : INK;
  text(ctx, "tryglimpse.cc", MARGIN, 1022, 29);
};

const drawWords: ShareStyle["draw"] = (ctx, data) => {
  header(ctx, "words");
  ctx.fillStyle = INK;
  text(ctx, data.words, MARGIN - 12, 448, 320, WIDTH + 12, true);
  text(ctx, data.labels.words, MARGIN, 538, 80, WIDTH, true);
  text(
    ctx,
    `${data.dictations} ${data.labels.dictations}`,
    MARGIN,
    646,
    43,
    590,
  );
  text(ctx, `${data.timeSaved} ${data.labels.saved}`, MARGIN, 710, 43, 590);
  footer(ctx);
};

const drawSpeed: ShareStyle["draw"] = (ctx, data) => {
  header(ctx, "speed");
  ctx.fillStyle = WHITE;
  text(ctx, `${data.wpm}`, MARGIN - 12, 524, 438, 700, true);
  text(ctx, data.labels.wordsAMinute, MARGIN, 618, 74, 690, true);
  if (data.fasterPercent > 0) {
    ctx.fillStyle = AMBER;
    text(ctx, data.labels.fasterInline, MARGIN, 734, 40, 665);
  }
  ctx.fillStyle = WHITE;
  text(ctx, `${data.words} ${data.labels.words}`, MARGIN, 800, 36, 630);
  text(ctx, `${data.timeSaved} ${data.labels.saved}`, MARGIN, 858, 36, 630);
  footer(ctx, true);
};

const drawActivity: ShareStyle["draw"] = (ctx, data) => {
  header(ctx, "activity");
  ctx.fillStyle = INK;
  text(ctx, data.labels.daysHeadline, MARGIN - 8, 328, 228, WIDTH + 8, true);
  text(ctx, data.labels.ofDictating, MARGIN, 420, 50, WIDTH, true);

  const month = new Intl.DateTimeFormat(data.locale, { month: "short" });
  const step = WIDTH / Math.max(1, data.grid.length);
  const palette = ["#d9d0e0", "#c2aed1", "#a58abb", "#806098", "#57386e"];
  data.grid.forEach((column, index) => {
    const x = MARGIN + index * step;
    const monthStart = column.find((entry) => entry.date.getDate() === 1);
    const labelDate =
      monthStart?.date ?? (index === 0 ? column[0]?.date : null);
    if (labelDate) {
      ctx.fillStyle = "#685b70";
      text(
        ctx,
        month.format(labelDate),
        Math.min(x, CARD - MARGIN - 60),
        778,
        23,
        60,
      );
    }
    column.forEach((entry, row) => {
      if (entry.future) return;
      const level =
        entry.count > 0
          ? Math.max(1, activityLevel(entry.words, data.busiest))
          : 0;
      ctx.fillStyle = palette[level];
      ctx.beginPath();
      ctx.roundRect(x, 810 + row * step, step - 4, step - 4, 2);
      ctx.fill();
    });
  });
  footer(ctx);
};

export const SHARE_STYLES: ShareStyle[] = [
  {
    id: "words",
    label: msg({
      id: "member_card.label_words_spoken",
      message: "Words spoken",
    }),
    draw: drawWords,
  },
  {
    id: "speed",
    label: msg({
      id: "settings.stats.wpm",
      message: "Words a minute",
    }),
    draw: drawSpeed,
  },
  {
    id: "activity",
    label: msg({
      id: "settings.stats.title",
      message: "Statistics",
    }),
    draw: drawActivity,
  },
];

let assetsReady: Promise<unknown> | null = null;

export function drawShareCard(
  canvas: HTMLCanvasElement,
  style: ShareStyle,
  data: ShareCardData,
  scale = 2,
) {
  if (canvas.width !== CARD * scale) {
    canvas.width = CARD * scale;
    canvas.height = CARD * scale;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, CARD, CARD);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // Gives bidi a right-to-left base so signs and numerals land correctly.
  ctx.direction = data.rtl ? "rtl" : "ltr";
  style.draw(ctx, data);
  ctx.restore();
}

export async function preloadShareAssets() {
  if (!assetsReady) {
    assetsReady = Promise.allSettled([
      document.fonts.load("400 36px Satoshi"),
      new FontFace("Glimpse Editorial", "url(/fonts/Fraunces.ttf)", {
        variationSettings: '"wght" 500, "opsz" 48',
      })
        .load()
        .then((font) => document.fonts.add(font)),
      ...(["words", "speed", "activity"] as const).map(async (style) => {
        const image = new Image();
        image.src = `/share/${style}-paper.webp`;
        await image.decode();
        artwork[style] = image;
      }),
    ]);
  }
  await assetsReady;
}

export function canvasToPngBytes(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not render the image"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}
