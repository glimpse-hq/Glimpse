import { i18n, type Messages } from "@lingui/core";
import type { AppLocaleSetting } from "./types";
import { messages as enMessages } from "./locales/en/messages.po";
import { messages as frMessages } from "./locales/fr/messages.po";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE, "fr"] as const;
export const DEFAULT_APP_LOCALE: AppLocaleSetting = "system";

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const catalogs: Record<AppLocale, Messages> = {
  en: enMessages,
  fr: frMessages,
};

function normalizeLocale(locale?: string | null): AppLocale {
  const baseLocale = locale?.toLowerCase().split("-")[0];
  if (baseLocale === "fr") return "fr";
  return DEFAULT_LOCALE;
}

function resolveRequestedLocale(
  localeSetting?: AppLocaleSetting | string | null,
): string | null {
  if (!localeSetting || localeSetting === DEFAULT_APP_LOCALE) {
    return typeof navigator !== "undefined" ? navigator.language : DEFAULT_LOCALE;
  }
  return localeSetting;
}

export function activateLocale(
  localeSetting?: AppLocaleSetting | string | null,
): AppLocale {
  const nextLocale = normalizeLocale(resolveRequestedLocale(localeSetting));

  i18n.loadAndActivate({
    locale: nextLocale,
    messages: catalogs[nextLocale],
  });

  if (typeof document !== "undefined") {
    document.documentElement.lang = nextLocale;
  }

  return nextLocale;
}

activateLocale(DEFAULT_APP_LOCALE);

export { i18n };
