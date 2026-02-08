import type { ModelInfo, ModelStatus } from "../types";

export type TranscriptionEngineId = string;

export type LanguageSupportBadge = {
    engine: TranscriptionEngineId;
    label: string;
    highlighted: boolean;
};

export type TranscriptionLanguageOption = {
    code: string;
    name: string;
    badges: LanguageSupportBadge[];
};

export type LanguageBadgeColumn = {
    engine: TranscriptionEngineId;
    label: string;
};

export type TranscriptionLanguageView = {
    options: TranscriptionLanguageOption[];
    badgeColumns: LanguageBadgeColumn[];
};

type EngineSupport = {
    badge: string;
    languages: Map<string, string>;
};

const KNOWN_ENGINE_BADGES: Record<string, string> = {
    whisper: "WS",
    moonshine: "MS",
    parakeet_v3: "P3",
};

function normalizeEngineId(value: string | null | undefined): TranscriptionEngineId | null {
    if (!value) return null;
    const normalized = value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return normalized.length > 0 ? normalized : null;
}

function badgeForEngine(engineId: string, engineLabel: string): string {
    const known = KNOWN_ENGINE_BADGES[engineId];
    if (known) return known;

    const parts = engineLabel
        .split(/[^a-zA-Z0-9]+/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length >= 2) {
        const versionLike = parts[1].match(/^v?(\d+)$/i);
        if (versionLike) {
            return `${parts[0][0]}${versionLike[1]}`.toUpperCase();
        }
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }

    return engineId.slice(0, 2).toUpperCase();
}

function resolveModelEngine(model: ModelInfo): TranscriptionEngineId | null {
    return getTranscriptionEngineId(model.engine_id) ?? getTranscriptionEngineId(model.engine) ?? getTranscriptionEngineId(model.key);
}

function collectEngineSupport(modelCatalog: ModelInfo[]): Map<TranscriptionEngineId, EngineSupport> {
    const byEngine = new Map<TranscriptionEngineId, EngineSupport>();

    for (const model of modelCatalog) {
        const engineId = resolveModelEngine(model);
        if (!engineId) continue;

        if (!byEngine.has(engineId)) {
            byEngine.set(engineId, {
                badge: badgeForEngine(engineId, model.engine),
                languages: new Map(),
            });
        }

        const engineSupport = byEngine.get(engineId);
        if (!engineSupport) continue;

        for (const language of model.supported_languages) {
            if (!engineSupport.languages.has(language.code)) {
                engineSupport.languages.set(language.code, language.name);
            }
        }
    }

    return byEngine;
}

function getTranscriptionEngineId(value: string | null | undefined): TranscriptionEngineId | null {
    const normalized = normalizeEngineId(value);
    if (!normalized) return null;

    if (KNOWN_ENGINE_BADGES[normalized]) return normalized;

    // Preserve explicit version IDs (e.g. parakeet_v3, whisper_v4) when present.
    const versioned = normalized.match(/^(whisper|moonshine|parakeet)(?:_[a-z0-9]+)*_v(\d+)$/);
    if (versioned) {
        return `${versioned[1]}_v${versioned[2]}`;
    }

    if (normalized.includes("whisper")) return "whisper";
    if (normalized.includes("moonshine")) return "moonshine";
    if (normalized.includes("parakeet_v3")) return "parakeet_v3";
    if (normalized.includes("parakeet")) return "parakeet_v3";

    return normalized;
}

function collectOrderedEngines(
    modelCatalog: ModelInfo[],
    include: (model: ModelInfo) => boolean
): TranscriptionEngineId[] {
    const ordered: TranscriptionEngineId[] = [];
    const seen = new Set<TranscriptionEngineId>();

    for (const model of modelCatalog) {
        if (!include(model)) continue;
        const engineId = resolveModelEngine(model);
        if (!engineId || seen.has(engineId)) continue;
        seen.add(engineId);
        ordered.push(engineId);
    }

    return ordered;
}

export function getCatalogTranscriptionEngines(modelCatalog: ModelInfo[]): TranscriptionEngineId[] {
    return collectOrderedEngines(modelCatalog, () => true);
}

export function getActiveTranscriptionEngine(
    modelCatalog: ModelInfo[],
    localModel: string
): TranscriptionEngineId | null {
    const model = modelCatalog.find((entry) => entry.key === localModel);
    if (model) return resolveModelEngine(model);
    return getTranscriptionEngineId(localModel);
}

export function getInstalledTranscriptionEngines(
    modelCatalog: ModelInfo[],
    modelStatus: Record<string, ModelStatus | undefined>
): TranscriptionEngineId[] {
    return collectOrderedEngines(modelCatalog, (model) => Boolean(modelStatus[model.key]?.installed));
}

export function buildTranscriptionLanguageView(
    modelCatalog: ModelInfo[],
    activeEngine: TranscriptionEngineId | null,
    visibleEngines: TranscriptionEngineId[]
): TranscriptionLanguageView {
    const engineSupport = collectEngineSupport(modelCatalog);
    const orderedVisibleEngines = visibleEngines.filter((engineId) => engineSupport.has(engineId));
    const badgeColumns: LanguageBadgeColumn[] = orderedVisibleEngines.map((engineId) => ({
        engine: engineId,
        label: engineSupport.get(engineId)?.badge ?? engineId.slice(0, 2).toUpperCase(),
    }));
    const badgeLabelByEngine = new Map(badgeColumns.map((column) => [column.engine, column.label]));

    const orderedCodes: string[] = [];
    const languageNames = new Map<string, string>();

    for (const engineId of orderedVisibleEngines) {
        const languages = engineSupport.get(engineId)?.languages;
        if (!languages) continue;

        for (const [code, name] of languages.entries()) {
            if (!languageNames.has(code)) {
                languageNames.set(code, name);
                orderedCodes.push(code);
            }
        }
    }

    const options: TranscriptionLanguageOption[] = orderedCodes.map((code) => ({
        code,
        name: languageNames.get(code) ?? code,
        badges: orderedVisibleEngines
            .filter((engineId) => engineSupport.get(engineId)?.languages.has(code))
            .map((engineId) => ({
                engine: engineId,
                label: badgeLabelByEngine.get(engineId) ?? engineId.slice(0, 2).toUpperCase(),
                highlighted: engineId === activeEngine,
            })),
    }));

    return {
        options: [{ code: "", name: "Auto", badges: [] }, ...options],
        badgeColumns,
    };
}
