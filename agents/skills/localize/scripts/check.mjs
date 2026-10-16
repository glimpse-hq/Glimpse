import { readFileSync } from "node:fs";
import { parsePoFile } from "@lingui/format-po";
import { parse } from "@messageformat/parser";

const sorted = (values) => [...new Set(values)].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

function contract(message, locale, warnings) {
  const categories = (type) =>
    new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
  const tokens = parse(message, {
    cardinal: categories("cardinal"),
    ordinal: categories("ordinal"),
  });
  const args = [];
  const selectors = [];
  function visit(nodes) {
    for (const node of nodes) {
      if (node.arg) {
        args.push(`${node.arg}:${node.type}:${node.key ?? ""}`);
      }
      if (node.param) visit(node.param);
      if (!node.cases) continue;
      const keys = node.cases.map((entry) => entry.key);
      if (!keys.includes("other"))
        throw new Error(`${node.arg}: missing other`);
      if (new Set(keys).size !== keys.length)
        throw new Error(`${node.arg}: duplicate selector case`);
      const fixed =
        node.type === "select"
          ? keys
          : keys.filter((key) => key.startsWith("="));
      selectors.push(
        JSON.stringify([
          node.arg,
          node.type,
          node.pluralOffset ?? 0,
          sorted(fixed),
        ]),
      );
      if (node.type !== "select") {
        const missing = categories(
          node.type === "selectordinal" ? "ordinal" : "cardinal",
        ).filter((key) => !keys.includes(key));
        if (missing.length)
          warnings.push(
            `${node.arg}: review missing plural categories ${missing.join(", ")}`,
          );
      }
      for (const entry of node.cases) visit(entry.tokens);
    }
  }
  visit(tokens);
  return { args, selectors };
}

export function checkMessage(source, translation, locale) {
  const errors = [];
  const warnings = [];
  if (!translation.trim()) return { errors: ["empty translation"], warnings };
  try {
    const original = contract(source, "en", []);
    const translated = contract(translation, locale, warnings);
    if (!same(original.args, translated.args))
      errors.push("argument names, types, or formatting functions changed");
    else if (
      !original.selectors.length &&
      !translated.selectors.length &&
      JSON.stringify(original.args.sort()) !==
        JSON.stringify(translated.args.sort())
    )
      warnings.push(
        "placeholder occurrence counts changed; verify no value was lost or duplicated",
      );
    if (!same(original.selectors, translated.selectors))
      errors.push("select keys, exact-number cases, or plural offsets changed");
  } catch (error) {
    errors.push(`ICU: ${error.message}`);
  }
  if (source === translation)
    warnings.push("identical to English; verify intentional");
  if (translation.includes("—"))
    errors.push("em dash is prohibited by app copy rules");
  return { errors, warnings };
}

export function checkCatalogs(english, target, ids, locale) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id)
  )
    throw new Error("Scope must be a non-empty JSON array of PO msgid strings");
  if (new Set(ids).size !== ids.length)
    throw new Error("Scope contains duplicate IDs");
  const sourceItems = parsePoFile(english).items.filter(
    (item) => !item.obsolete,
  );
  const targetItems = parsePoFile(target).items.filter(
    (item) => !item.obsolete,
  );
  return ids.map((id) => {
    const sources = sourceItems.filter((item) => item.msgid === id);
    const targets = targetItems.filter((item) => item.msgid === id);
    if (sources.length !== 1 || targets.length !== 1)
      return {
        id,
        errors: ["expected exactly one active entry in each catalog"],
        warnings: [],
      };
    const [source] = sources;
    const [translation] = targets;
    const explicit = (item) =>
      item.extractedComments.includes("js-lingui-explicit-id");
    if (
      source.msgctxt !== translation.msgctxt ||
      explicit(source) !== explicit(translation) ||
      source.msgid_plural ||
      translation.msgid_plural
    )
      return {
        id,
        errors: [
          "context/ID-mode mismatch or unsupported gettext plural; inspect manually",
        ],
        warnings: [],
      };
    const text = source.msgstr[0] || (explicit(source) ? "" : source.msgid);
    if (!text)
      return {
        id,
        errors: ["English source is empty; resolve it from the call site"],
        warnings: [],
      };
    const result = checkMessage(text, translation.msgstr[0] ?? "", locale);
    if (translation.flags.fuzzy)
      result.warnings.push("fuzzy flag requires review");
    return { id, ...result };
  });
}

if (import.meta.main) {
  try {
    const [locale, scope, targetPath, ...extra] = process.argv.slice(2);
    const locales = JSON.parse(
      readFileSync("supported-app-locales.json", "utf8"),
    );
    if (!scope || extra.length || locale === "en" || !locales.includes(locale))
      throw new Error(
        "Usage: bun agents/skills/localize/scripts/check.mjs <shipped non-English locale> <scope.json> [target.po]",
      );
    const results = checkCatalogs(
      readFileSync("src/locales/en/messages.po", "utf8"),
      readFileSync(targetPath ?? `src/locales/${locale}/messages.po`, "utf8"),
      JSON.parse(readFileSync(scope, "utf8")),
      locale,
    );
    let errors = 0;
    let warnings = 0;
    for (const result of results) {
      for (const error of result.errors)
        console.error(`ERROR ${result.id}: ${error}`);
      for (const warning of result.warnings)
        console.warn(`WARN ${result.id}: ${warning}`);
      errors += result.errors.length;
      warnings += result.warnings.length;
    }
    console.log(
      `${locale}: ${results.length} entries checked, ${errors} errors, ${warnings} warnings`,
    );
    process.exitCode = errors ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
