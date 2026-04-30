import { detectAppPlatform } from "../../platform/service";

const isMacPlatform = detectAppPlatform() === "macos";

const MODIFIER_ORDER = ["Fn", "Cmd", "Opt", "Ctrl", "Shift"] as const;

function modifierRank(token: string): number {
  const index = MODIFIER_ORDER.findIndex(
    (modifier) => token === modifier || token.startsWith(modifier),
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isModifierToken(token: string): boolean {
  return modifierRank(token) !== Number.MAX_SAFE_INTEGER;
}

function humanizeModifierToken(token: string): string {
  const modifierDisplay: Record<string, string> = {
    Cmd: isMacPlatform ? "Command" : "Meta",
    Opt: isMacPlatform ? "Option" : "Alt",
    Ctrl: "Ctrl",
    Shift: "Shift",
    Fn: "Fn",
  };

  for (const modifier of MODIFIER_ORDER) {
    if (token === modifier) {
      return modifierDisplay[modifier];
    }
    if (token === `${modifier}Left`) {
      return `Left ${modifierDisplay[modifier]}`;
    }
    if (token === `${modifier}Right`) {
      return `Right ${modifierDisplay[modifier]}`;
    }
  }

  return token;
}

function humanizeKeyToken(token: string): string {
  const directDisplay: Record<string, string> = {
    Left: "Left",
    Right: "Right",
    Up: "Up",
    Down: "Down",
    Escape: "Esc",
    Return: "Enter",
    ForwardDelete: isMacPlatform ? "Forward Delete" : "Delete",
    Delete: isMacPlatform ? "Delete" : "Backspace",
  };

  if (directDisplay[token]) {
    return directDisplay[token];
  }

  if (/^[A-Z]$/.test(token) || /^\d$/.test(token) || /^F\d+$/.test(token)) {
    return token;
  }

  if (token.startsWith("Keypad")) {
    return token.replace(/^Keypad/, "Keypad ");
  }

  return token.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function shortcutTokens(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function formatShortcutForDisplay(shortcut: string): string {
  const tokens = shortcutTokens(shortcut);

  const modifiers = tokens
    .filter(isModifierToken)
    .sort((left, right) => modifierRank(left) - modifierRank(right))
    .map(humanizeModifierToken);

  const keys = tokens
    .filter((token) => !isModifierToken(token))
    .map(humanizeKeyToken);

  return [...modifiers, ...keys].join(" + ");
}
