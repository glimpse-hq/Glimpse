export type ActionCardAccent = {
  borderColor: string;
  backgroundColor: string;
};

export const ACTION_CARD_BUTTON_ACCENTS = {
  interactive: {
    borderColor: "var(--color-interactive-30)",
    backgroundColor: "var(--color-interactive-10)",
  },
  cloud: {
    borderColor: "var(--color-cloud-30)",
    backgroundColor: "var(--color-cloud-10)",
  },
  local: {
    borderColor: "var(--color-local-30)",
    backgroundColor: "var(--color-local-10)",
  },
  accent: {
    borderColor: "var(--color-accent-30)",
    backgroundColor: "var(--color-accent-10)",
  },
  error: {
    borderColor: "rgba(239, 68, 68, 0.3)",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
} satisfies Record<string, ActionCardAccent>;

export type ActionCardAccentPreset = keyof typeof ACTION_CARD_BUTTON_ACCENTS;
