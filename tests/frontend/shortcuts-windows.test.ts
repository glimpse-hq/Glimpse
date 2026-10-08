import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { mockLingui } from "./support/lingui";

mockLingui();
// shortcuts.ts reads the platform once at import, so the mock comes first and
// the query string loads a fresh copy if another test file already imported it.
mock.module(join(import.meta.dir, "../../src/platform/service"), () => ({
  detectAppPlatform: () => "windows",
}));

const { formatShortcutForDisplay, shortcutDisplayParts } =
  await import("../../src/shared/lib/shortcuts?windows");

describe("shortcut display on Windows", () => {
  test("orders modifiers Fn, Win, Ctrl, Alt, Shift", () => {
    expect(shortcutDisplayParts("Shift+Space+Control+Alt+Cmd+Fn")).toEqual([
      "Fn",
      "Win",
      "Ctrl",
      "Alt",
      "Shift",
      "Space",
    ]);
  });

  test("writes Ctrl before Alt", () => {
    expect(formatShortcutForDisplay("alt+ctrl+Space")).toBe(
      "Ctrl + Alt + Space",
    );
    expect(formatShortcutForDisplay("CommandOrControl+option+K")).toBe(
      "Ctrl + Alt + K",
    );
  });
});
