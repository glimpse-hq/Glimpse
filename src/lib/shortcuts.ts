export const shortcutModifierOrder = [
    "Control",
    "LeftShift",
    "RightShift",
    "Shift",
    "LeftOption",
    "RightOption",
    "Alt",
    "LeftCommand",
    "RightCommand",
    "Command",
] as const;

const displayTokenMap: Record<string, string> = {
    Control: "Ctrl",
    LeftShift: "LShift",
    RightShift: "RShift",
    Shift: "Shift",
    LeftOption: "L⌥",
    RightOption: "R⌥",
    Alt: "Alt",
    LeftCommand: "L⌘",
    RightCommand: "R⌘",
    Command: "⌘",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Escape: "Esc",
    Delete: "Del",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
};

export function normalizeShortcutModifier(event: KeyboardEvent): string | null {
    if (event.code === "MetaLeft") return "LeftCommand";
    if (event.code === "MetaRight") return "RightCommand";
    if (event.code === "ShiftLeft") return "LeftShift";
    if (event.code === "ShiftRight") return "RightShift";
    if (event.code === "AltLeft") return "LeftOption";
    if (event.code === "AltRight") return "RightOption";
    if (event.key === "Control" || event.code === "ControlLeft" || event.code === "ControlRight") return "Control";
    if (event.key === "Shift") return "Shift";
    if (event.key === "Alt" || event.key === "Option") return "Alt";
    if (event.key === "Meta") return "Command";
    return null;
}

export function formatShortcutKey(code: string): string | null {
    if (!code) return null;
    if (code.startsWith("Key") && code.length > 3) return code.slice(3).toUpperCase();
    if (code.startsWith("Digit") && code.length > 5) return code.slice(5);

    const namedKeys: Record<string, string> = {
        Space: "Space",
        Enter: "Enter",
        Tab: "Tab",
        Backspace: "Backspace",
        Escape: "Escape",
        Delete: "Delete",
        ArrowUp: "ArrowUp",
        ArrowDown: "ArrowDown",
        ArrowLeft: "ArrowLeft",
        ArrowRight: "ArrowRight",
        Backquote: "`",
        Minus: "-",
        Equal: "=",
        BracketLeft: "[",
        BracketRight: "]",
        Backslash: "\\",
        Semicolon: ";",
        Quote: "'",
        Comma: ",",
        Period: ".",
        Slash: "/",
    };

    return namedKeys[code] ?? code;
}

export function sortShortcutModifiers(modifiers: Iterable<string>): string[] {
    return Array.from(modifiers).sort((a, b) => {
        const aIndex = shortcutModifierOrder.indexOf(a as (typeof shortcutModifierOrder)[number]);
        const bIndex = shortcutModifierOrder.indexOf(b as (typeof shortcutModifierOrder)[number]);
        const normalizedAIndex = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
        const normalizedBIndex = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
        return normalizedAIndex - normalizedBIndex;
    });
}

export function buildShortcutString(modifiers: Iterable<string>, keyCode: string | null): string | null {
    const orderedModifiers = sortShortcutModifiers(modifiers);
    const formattedKey = keyCode ? formatShortcutKey(keyCode) : null;
    const parts = [...orderedModifiers, formattedKey].filter((part): part is string => Boolean(part));
    if (parts.length === 0) return null;
    return parts.join("+");
}

export function formatShortcutForDisplay(shortcut: string): string {
    return shortcut
        .split("+")
        .map((token) => displayTokenMap[token] ?? token)
        .join(" + ");
}
