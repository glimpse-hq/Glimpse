import { expect, test } from "bun:test";
import { checkMessage, checkCatalogs } from "./check.mjs";

const errors = (source, translation, locale = "fr") =>
  checkMessage(source, translation, locale).errors;

test("allows reordered variables and target-language plural categories", () => {
  expect(errors("{name}: {count}", "{count} pour {name}")).toEqual([]);
  expect(
    errors(
      "{n, plural, one {# file} other {# files}}",
      "{n, plural, zero {لا ملفات} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}}",
      "ar",
    ),
  ).toEqual([]);
});

test("rejects missing, added, renamed, or quoted-away variables", () => {
  for (const translation of ["Bonjour", "{nom}", "{name} {extra}", "'{name}'"])
    expect(errors("Hello {name}", translation).length).toBeGreaterThan(0);
});

test("flags changed repetition without forbidding grammatical variation", () => {
  const result = checkMessage("{name} met {name}", "{name} se rencontre", "fr");
  expect(result.errors).toEqual([]);
  expect(
    result.warnings.some((warning) => warning.includes("occurrence counts")),
  ).toBe(true);
});

test("rejects malformed ICU, missing other, invalid and duplicate categories", () => {
  for (const translation of [
    "{n, plural, one {un}",
    "{n, plural, one {un}}",
    "{n, plural, few {peu} other {plusieurs}}",
    "{n, plural, other {a} other {b}}",
  ])
    expect(
      errors("{n, plural, one {one} other {many}}", translation).length,
    ).toBeGreaterThan(0);
});

test("preserves exact cases, select keys, offsets, and number formatting", () => {
  expect(
    errors(
      "{n, plural, =0 {None} other {# files}}",
      "{n, plural, other {# fichiers}}",
    ).length,
  ).toBeGreaterThan(0);
  expect(
    errors(
      "{n, plural, offset:1 other {# files}}",
      "{n, plural, other {# fichiers}}",
    ).length,
  ).toBeGreaterThan(0);
  expect(
    errors(
      "{s, select, on {On} other {Off}}",
      "{s, select, oui {Oui} other {Non}}",
    ).length,
  ).toBeGreaterThan(0);
  expect(errors("{n, number}", "{n}").length).toBeGreaterThan(0);
});

test("reports English-identical and incomplete plural coverage as review warnings", () => {
  expect(
    checkMessage("Glimpse", "Glimpse", "fr").warnings.length,
  ).toBeGreaterThan(0);
  expect(
    checkMessage(
      "{n, plural, one {file} other {files}}",
      "{n, plural, one {ملف} other {ملفات}}",
      "ar",
    ).warnings.length,
  ).toBeGreaterThan(0);
});

const po = (text) =>
  `#. js-lingui-explicit-id\nmsgid "greeting"\nmsgstr ${JSON.stringify(text)}\n`;

test("rejects changed ID mode so translations keep their runtime lookup key", () => {
  const en = po("Hello {name}");
  const target = po("Bonjour {name}").replace("#. js-lingui-explicit-id\n", "");
  expect(
    checkCatalogs(en, target, ["greeting"], "fr")[0].errors.length,
  ).toBeGreaterThan(0);
});

test("uses English msgstr, validates scope and ignores obsolete entries", () => {
  const en = po("Hello {name}");
  expect(
    checkCatalogs(en, po("Bonjour {name}"), ["greeting"], "fr")[0].errors,
  ).toEqual([]);
  expect(
    checkCatalogs(en, po("Bonjour"), ["greeting"], "fr")[0].errors.length,
  ).toBeGreaterThan(0);
  expect(
    checkCatalogs(
      en,
      '#~ msgid "greeting"\n#~ msgstr "Bonjour {name}"\n',
      ["greeting"],
      "fr",
    )[0].errors.length,
  ).toBeGreaterThan(0);
  expect(checkCatalogs(en, po(""), ["greeting"], "fr")[0].errors).toContain(
    "empty translation",
  );
  expect(() => checkCatalogs(en, po("x"), [], "fr")).toThrow();
  expect(() =>
    checkCatalogs(en, po("x"), ["greeting", "greeting"], "fr"),
  ).toThrow();
});
