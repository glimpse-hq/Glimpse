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
