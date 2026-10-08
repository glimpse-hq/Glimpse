import { describe, expect, test } from "bun:test";
import { mockLingui } from "./support/lingui";

mockLingui();

const personalization =
  await import("../../src/features/personalization/components/personalization-utils");
const {
  buildActiveTranscriptionLanguageOptions,
  collectAllTranscriptionLanguages,
  languageSupportedByModel,
} = await import("../../src/shared/lib/transcriptionLanguages");
const {
  DEFAULT_LOCALE,
  SUPPORTED_APP_LOCALES,
  buildAppLocaleOptions,
  matchSupportedAppLocale,
  normalizeSupportedAppLocale,
} = await import("../../src/shared/lib/appLocales");
const { parseTextSizeMode, resolveTextScale } =
  await import("../../src/shared/lib/textSize");
const { getExpandedTextSegments } =
  await import("../../src/shared/lib/wordReveal");
const {
  deriveModelStats,
  formatModelSize,
  formatQuantLabel,
  isBuiltInModel,
  modelSizeMb,
  sortInstalledModels,
} = await import("../../src/shared/lib/modelStats");
const { getDefaultShortcuts } =
  await import("../../src/features/onboarding/platform");

type Model = Parameters<typeof deriveModelStats>[0];

const model = (overrides: Partial<Model>): Model =>
  ({
    key: "m",
    label: "Model",
    description: "",
    size_mb: 100,
    engine_id: "whisper",
    family: "",
    variant: "",
    category: "standard",
    downloadable: true,
    tags: [],
    capabilities: [],
    supported_languages: [],
    ane_size_mb: null,
    ...overrides,
  }) as Model;

const langs = (...codes: string[]) =>
  codes.map((code) => ({ code, name: code.toUpperCase() }));

describe("personalization helpers", () => {
  test("normalizes websites to a bare host", () => {
    const { normalizeWebsite } = personalization;
    expect(normalizeWebsite("  HTTPS://www.GitHub.com/glimpse/app ")).toBe(
      "github.com",
    );
    expect(normalizeWebsite("http://docs.example.org")).toBe(
      "docs.example.org",
    );
    expect(normalizeWebsite("   ")).toBe("");
  });

  test("validates domain labels", () => {
    const { isValidDomain } = personalization;
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("sub-domain.example.co.uk")).toBe(true);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("-bad.com")).toBe(false);
    expect(isValidDomain("bad-.com")).toBe(false);
    expect(isValidDomain("a..com")).toBe(false);
    expect(isValidDomain("under_score.com")).toBe(false);
    expect(isValidDomain(`${"a".repeat(64)}.com`)).toBe(false);
  });

  test("clamps instructions by code point, not UTF-16 unit", () => {
    const {
      MAX_INSTRUCTIONS_CHARS,
      clampInstructionsText,
      countInstructionsChars,
    } = personalization;
    const emoji = "\u{1F600}";
    expect(countInstructionsChars(emoji.repeat(3))).toBe(3);
    const long = emoji.repeat(MAX_INSTRUCTIONS_CHARS + 5);
    const clamped = clampInstructionsText(long);
    expect(countInstructionsChars(clamped)).toBe(MAX_INSTRUCTIONS_CHARS);
    expect(clamped.endsWith(emoji)).toBe(true);
    expect(clampInstructionsText("short")).toBe("short");
  });

  test("initials and website fallbacks", () => {
    const { getInitials, getWebsiteFallback, formatWebsitePreview } =
      personalization;
    expect(getInitials("  ada   lovelace king ")).toBe("AL");
    expect(getInitials("glimpse")).toBe("GL");
    expect(getInitials("   ")).toBe("?");
    expect(formatWebsitePreview("github.com")).toBe("github");
    expect(getWebsiteFallback("https://www.notion.so/page")).toBe("N");
    expect(getWebsiteFallback("   ")).toBe("•");
  });

  test("icon map keys by normalized site and skips missing icons", () => {
    expect(
      personalization.buildWebsiteIconMap([
        { site: "https://www.Figma.com/file", icon_path: "/icons/figma.png" },
        { site: "linear.app", icon_path: null },
        { site: "", icon_path: "/icons/empty.png" },
      ]),
    ).toEqual({ "figma.com": "/icons/figma.png" });
  });
});

describe("transcription languages", () => {
  test("an empty language means auto and is always supported", () => {
    expect(languageSupportedByModel(undefined, "  ")).toBe(true);
    expect(languageSupportedByModel(undefined, "en")).toBe(false);
    expect(
      languageSupportedByModel(
        model({ supported_languages: langs("en") }),
        " en ",
      ),
    ).toBe(true);
  });

  test("collects unique languages sorted by name", () => {
    const all = collectAllTranscriptionLanguages([
      model({
        supported_languages: [
          { code: "fr", name: "French" },
          { code: "en", name: "English" },
        ],
      }),
      model({
        supported_languages: [
          { code: "en", name: "English (dup)" },
          { code: " ", name: "Blank" },
          { code: "de", name: "German" },
        ],
      }),
    ]);
    expect(all).toEqual([
      { code: "en", name: "English" },
      { code: "fr", name: "French" },
      { code: "de", name: "German" },
    ]);
  });

  test("locks languages the active model can't do behind a header", () => {
    const all = [
      { code: "en", name: "English" },
      { code: "ja", name: "Japanese" },
    ];
    const parakeet = model({ supported_languages: langs("en") });
    const options = buildActiveTranscriptionLanguageOptions(
      parakeet,
      all,
      false,
      "Auto",
      "Needs another model",
      "desc",
    );
    expect(options.map((o) => [o.code, o.locked ?? null])).toEqual([
      ["", null],
      ["en", false],
      ["__unsupported__", null],
      ["ja", true],
    ]);
    expect(options[2]).toMatchObject({ isHeader: true, prominentHeader: true });

    const remote = buildActiveTranscriptionLanguageOptions(
      parakeet,
      all,
      true,
      "Auto",
      "x",
      "y",
    );
    expect(remote.map((o) => o.code)).toEqual(["", "en", "ja"]);
  });
});

describe("app locales", () => {
  test("matches exact and base locales, case and underscore insensitive", () => {
    expect(SUPPORTED_APP_LOCALES).toContain(DEFAULT_LOCALE);
    expect(matchSupportedAppLocale("FR_ca")).toBe("fr");
    expect(matchSupportedAppLocale(" de-DE ")).toBe("de");
    expect(matchSupportedAppLocale("zz")).toBeNull();
    expect(matchSupportedAppLocale(null)).toBeNull();
    expect(normalizeSupportedAppLocale("zz-ZZ")).toBe("en");
  });

  test("options start with the system choice", () => {
    const options = buildAppLocaleOptions("System");
    expect(options[0]).toEqual({ value: "system", label: "System" });
    expect(options.slice(1).map((o) => o.value)).toEqual([
      ...SUPPORTED_APP_LOCALES,
    ]);
  });
});

describe("text size", () => {
  test("unknown stored values fall back to default", () => {
    expect(parseTextSizeMode("large")).toBe("large");
    expect(parseTextSizeMode("huge")).toBe("default");
    expect(parseTextSizeMode(null)).toBe("default");
  });

  test("Windows text runs a step larger", () => {
    expect(resolveTextScale("default")).toBe("1");
    expect(resolveTextScale("small", "macos")).toBe("0.94");
    expect(resolveTextScale("large", "macos")).toBe("1.08");
    expect(resolveTextScale("default", "windows")).toBe("1.0625");
    expect(resolveTextScale("small", "windows")).toBe("1");
    expect(resolveTextScale("large", "windows")).toBe("1.125");
  });
});

describe("word reveal", () => {
  test("keys segments by character offset", () => {
    const segments = getExpandedTextSegments("hi  there", new Set());
    expect(segments.map((s) => [s.key, s.text, s.isWhitespace])).toEqual([
      [0, "hi", false],
      [2, "  ", true],
      [4, "there", false],
    ]);
  });

  test("only new words get a staggered delay", () => {
    const segments = getExpandedTextSegments("one two three", new Set([0]));
    const delays = segments.map((s) => s.delay);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBe(0);
    expect(delays[2]).toBe(0);
    expect(delays[4]).toBeCloseTo(0.12);
  });

  test("a burst of words spreads within half a second", () => {
    const text = Array.from({ length: 10 }, (_, i) => `w${i}`).join(" ");
    const delays = getExpandedTextSegments(text, new Set())
      .filter((s) => !s.isWhitespace)
      .map((s) => s.delay);
    expect(delays[1]).toBeCloseTo(0.05);
    expect(delays[9]).toBeCloseTo(0.45);
  });

  test("the stagger never drops below 30 ms", () => {
    const text = Array.from({ length: 40 }, () => "w").join(" ");
    const delays = getExpandedTextSegments(text, new Set())
      .filter((s) => !s.isWhitespace)
      .map((s) => s.delay);
    expect(delays[1]).toBeCloseTo(0.03);
  });

  test("empty text yields nothing", () => {
    expect(getExpandedTextSegments("", new Set())).toEqual([]);
  });
});

describe("model stats", () => {
  test("formats sizes in MB below a gigabyte", () => {
    expect(formatModelSize(999.6)).toBe("1000 MB");
    expect(formatModelSize(1000)).toBe("1.0 GB");
    expect(formatModelSize(1650)).toBe("1.6 GB");
    expect(formatModelSize(42.4)).toBe("42 MB");
  });

  test("adds the ANE encoder size only when requested and present", () => {
    const base = { size_mb: 500, ane_size_mb: 200, ane_total_size_mb: null };
    expect(modelSizeMb(base, false)).toBe(500);
    expect(modelSizeMb(base, true)).toBe(700);
    expect(modelSizeMb({ ...base, ane_total_size_mb: 650 }, true)).toBe(650);
    expect(modelSizeMb({ ...base, ane_size_mb: null }, true)).toBe(500);
  });

  test("sorts legacy models last, then by label", () => {
    const sorted = sortInstalledModels([
      model({ key: "legacy", label: "Alpha", downloadable: false }),
      model({ key: "b", label: "Beta" }),
      model({ key: "a", label: "Aardvark" }),
    ]);
    expect(sorted.map((m) => m.key)).toEqual(["a", "b", "legacy"]);
  });

  test("English-only comes from tags first, then languages", () => {
    expect(
      deriveModelStats(
        model({ tags: ["English"], supported_languages: langs("en", "fr") }),
      ).englishOnly,
    ).toBe(true);
    expect(
      deriveModelStats(
        model({ tags: ["Multilingual"], supported_languages: [] }),
      ).englishOnly,
    ).toBe(false);
    expect(
      deriveModelStats(model({ supported_languages: langs("en", "en-gb") })),
    ).toEqual({ langCount: 2, englishOnly: true });
    expect(
      deriveModelStats(model({ supported_languages: langs("en", "de") }))
        .englishOnly,
    ).toBe(false);
    expect(
      deriveModelStats(model({ supported_languages: [] })).englishOnly,
    ).toBe(true);
  });

  test("variant and built-in labels", () => {
    expect(formatQuantLabel("")).toBeNull();
    expect(formatQuantLabel("Q5_1")).toBe("Q5_1");
    expect(formatQuantLabel("Full")).toBe("Full");
    expect(isBuiltInModel({ engine_id: "apple" })).toBe(true);
    expect(isBuiltInModel({ engine_id: "whisper" })).toBe(false);
  });
});

describe("onboarding default shortcuts", () => {
  test("Windows avoids Alt+Space, which opens the window menu", () => {
    const windows = getDefaultShortcuts("windows");
    expect(Object.values(windows)).not.toContain("Alt+Space");
    expect(getDefaultShortcuts("macos").smart).toBe("Alt+Space");
    expect(new Set(Object.values(windows)).size).toBe(3);
    expect(new Set(Object.values(getDefaultShortcuts("macos"))).size).toBe(3);
  });
});
