import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "@/locales/en";
import { fa } from "@/locales/fa";

/**
 * Languages and text direction.
 *
 * Persian is the default and the only language offered today. Direction
 * follows the language and is set on <html>, so every component can use
 * logical classes (`ms-*`, `pe-*`, `text-start`) and be right in both
 * directions without knowing which one it is in.
 */

export const LANGUAGES = {
  fa: { dir: "rtl" },
  en: { dir: "ltr" },
} as const;

export type Language = keyof typeof LANGUAGES;
export type Direction = (typeof LANGUAGES)[Language]["dir"];

export const DEFAULT_LANGUAGE: Language = "fa";

const isLanguage = (value: string): value is Language => value in LANGUAGES;

/** Unknown languages get the default's direction, never a guess. */
export const directionOf = (language: string): Direction =>
  LANGUAGES[isLanguage(language) ? language : DEFAULT_LANGUAGE].dir;

/**
 * Puts the language and its direction on the root element.
 *
 * Takes the element rather than reaching for `document`, so it can be tested
 * without a browser.
 */
export const applyDocumentLanguage = (root: { lang: string; dir: string }, language: string) => {
  const resolved = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  root.lang = resolved;
  root.dir = directionOf(resolved);
};

void i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  // React already escapes what it renders.
  interpolation: { escapeValue: false },
});

if (typeof document !== "undefined") {
  applyDocumentLanguage(document.documentElement, i18n.language);
  i18n.on("languageChanged", (language) =>
    applyDocumentLanguage(document.documentElement, language),
  );
}

export default i18n;
