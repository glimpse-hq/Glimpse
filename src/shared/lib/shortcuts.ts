const platform = typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent || "" : "";
const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(platform);

const displayTokenMap: Record<string, string> = {
    Command: "Command",
    Option: "Option",
    Meta: isMacPlatform ? "Command" : "Meta",
    Super: isMacPlatform ? "Command" : "Super",
    Alt: isMacPlatform ? "Option" : "Alt",
    Control: "Ctrl",
    Ctrl: "Ctrl",
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

const legacyDisplayAliasMap: Record<string, string> = {
    leftcommand: "Command",
    rightcommand: "Command",
    leftoption: "Option",
    rightoption: "Option",
    leftalt: "Alt",
    rightalt: "Alt",
    leftshift: "Shift",
    rightshift: "Shift",
    leftcontrol: "Control",
    rightcontrol: "Control",
};

const modifierPriorityMap: Record<string, number> = {
    Command: 0,
    Meta: 0,
    Super: 0,
    Alt: 1,
    Control: 2,
    Ctrl: 2,
    Shift: 3,
};

function canonicalizeModifierToken(modifier: string): string {
    if (modifier === "Option") return "Alt";
    if (modifier === "Ctrl") return "Control";
    return modifier;
}

function orderShortcutModifiers(modifiers: Iterable<string>): string[] {
    const canonicalModifiers = Array.from(new Set(Array.from(modifiers, canonicalizeModifierToken)));
    return canonicalModifiers.sort((a, b) => {
        const priorityA = modifierPriorityMap[a] ?? Number.MAX_SAFE_INTEGER;
        const priorityB = modifierPriorityMap[b] ?? Number.MAX_SAFE_INTEGER;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.localeCompare(b);
    });
}

export function normalizeShortcutModifier(event: KeyboardEvent): string | null {
    if (
        event.code === "MetaLeft" ||
        event.code === "MetaRight" ||
        event.code === "OSLeft" ||
        event.code === "OSRight" ||
        event.key === "Meta" ||
        event.key === "Command" ||
        event.key === "Super"
    ) {
        return isMacPlatform ? "Command" : event.key === "Super" ? "Super" : "Meta";
    }
    if (
        event.code === "AltLeft" ||
        event.code === "AltRight" ||
        event.key === "Alt" ||
        event.key === "Option"
    ) {
        return "Alt";
    }
    if (event.code === "ControlLeft" || event.code === "ControlRight" || event.key === "Control" || event.key === "Ctrl") {
        return "Control";
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.key === "Shift") {
        return "Shift";
    }
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

export function buildShortcutString(modifiers: Iterable<string>, keyCode: string | null): string | null {
    const orderedModifiers = orderShortcutModifiers(modifiers);
    const formattedKey = keyCode ? formatShortcutKey(keyCode) : null;
    if (!formattedKey) return null;
    const parts = [...orderedModifiers, formattedKey].filter((part): part is string => Boolean(part));
    if (parts.length === 0) return null;
    return parts.join("+");
}

export function buildShortcutPreviewString(modifiers: Iterable<string>, keyCode: string | null): string {
    const orderedModifiers = orderShortcutModifiers(modifiers);
    const formattedKey = keyCode ? formatShortcutKey(keyCode) : null;
    const parts = [...orderedModifiers, formattedKey].filter((part): part is string => Boolean(part));
    return parts.join("+");
}

export function formatShortcutForDisplay(shortcut: string): string {
    return shortcut
        .split("+")
        .map((raw) => {
            const token = raw.trim();
            const canonical = legacyDisplayAliasMap[token.toLowerCase()] ?? token;
            return displayTokenMap[canonical] ?? canonical;
        })
        .join(" + ");
}
