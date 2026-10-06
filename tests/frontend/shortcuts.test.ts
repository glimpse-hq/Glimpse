import { describe, expect, test } from "bun:test";
import { mockLingui } from "./support/lingui";

mockLingui();

const { detectAppPlatform } = await import("../../src/platform/service");
const { formatShortcutForDisplay, shortcutDisplayParts } =
  await import("../../src/shared/lib/shortcuts");

// Bun reports navigator.platform as MacIntel on macOS hosts; the display names
// below are the macOS ones.
const onMac = detectAppPlatform() === "macos";

describe.if(onMac)("shortcut display on macOS", () => {
  test("orders modifiers Fn, Command, Option, Control, Shift", () => {
    expect(shortcutDisplayParts("Shift+Space+Control+Alt+Cmd+Fn")).toEqual([
      "Fn",
      "Command",
      "Option",
      "Ctrl",
      "Shift",
      "Space",
    ]);
  });

  test("normalizes aliases case-insensitively", () => {
    expect(formatShortcutForDisplay("CommandOrControl+shift+K")).toBe(
      "Command + Shift + K",
    );
    expect(formatShortcutForDisplay("meta+OPTION+spacebar")).toBe(
      "Command + Option + Space",
    );
    expect(formatShortcutForDisplay("ctrl+altgr+F12")).toBe(
      "Option + Ctrl + F12",
    );
  });

  test("names left and right modifiers", () => {
    expect(formatShortcutForDisplay("RightCommand")).toBe("Right Command");
    expect(formatShortcutForDisplay("leftalt+rightshift")).toBe(
      "Left Option + Right Shift",
    );
    expect(formatShortcutForDisplay("LeftControl")).toBe("Left Ctrl");
  });

  test("names arrows, editing keys, and mouse buttons", () => {
    expect(formatShortcutForDisplay("ArrowLeft")).toBe("Left");
    expect(formatShortcutForDisplay("Escape")).toBe("Esc");
    expect(formatShortcutForDisplay("Return")).toBe("Enter");
    expect(formatShortcutForDisplay("delete")).toBe("Delete");
    expect(formatShortcutForDisplay("ForwardDelete")).toBe("Forward Delete");
    expect(formatShortcutForDisplay("mouse4")).toBe("Mouse Back");
    expect(formatShortcutForDisplay("XButton2")).toBe("Mouse Forward");
    expect(formatShortcutForDisplay("mb3")).toBe("Middle Click");
  });

  test("splits camel-case and keypad key names", () => {
    expect(formatShortcutForDisplay("KeypadEnter")).toBe("Keypad Enter");
    expect(formatShortcutForDisplay("PageDown")).toBe("Page Down");
    expect(formatShortcutForDisplay("A")).toBe("A");
    expect(formatShortcutForDisplay("7")).toBe("7");
  });

  test("drops empty tokens and trims spaces", () => {
    expect(shortcutDisplayParts(" cmd + + K ")).toEqual(["Command", "K"]);
    expect(shortcutDisplayParts("")).toEqual([]);
  });
});
