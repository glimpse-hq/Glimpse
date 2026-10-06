import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { Speaker } from "../../types";

export const SPEAKER_COLORS = [
  "#7aa2f7",
  "#9ece6a",
  "#e0af68",
  "#f7768e",
  "#bb9af7",
  "#7dcfff",
  "#ff9e64",
  "#73daca",
];

export const SPEAKER_COLOR_NAMES: Record<string, MessageDescriptor> = {
  "#7aa2f7": msg({ id: "speaker_color.blue", message: "Blue" }),
  "#9ece6a": msg({ id: "speaker_color.green", message: "Green" }),
  "#e0af68": msg({ id: "speaker_color.yellow", message: "Yellow" }),
  "#f7768e": msg({ id: "speaker_color.pink", message: "Pink" }),
  "#bb9af7": msg({ id: "speaker_color.purple", message: "Purple" }),
  "#7dcfff": msg({ id: "speaker_color.cyan", message: "Cyan" }),
  "#ff9e64": msg({ id: "speaker_color.orange", message: "Orange" }),
  "#73daca": msg({ id: "speaker_color.teal", message: "Teal" }),
};

// Recording tracks keep fixed colors; detected speakers take the rest.
export const withSpeakerColors = (list: Speaker[]) => {
  const taken = new Set(list.map((speaker) => speaker.color));
  const free = SPEAKER_COLORS.filter((color) => !taken.has(color));
  let next = 0;
  return list.map((speaker, index) => ({
    ...speaker,
    color:
      speaker.color ??
      free[next++] ??
      SPEAKER_COLORS[index % SPEAKER_COLORS.length],
  }));
};
