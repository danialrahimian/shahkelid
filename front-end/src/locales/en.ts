import type { fa } from "./fa";

/** Turns every leaf string of the Persian table into `string`, keeping its shape. */
type SameShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : SameShape<T[K]> };

/**
 * English. Not offered to visitors yet (the site is Persian); kept complete so
 * adding it later is a switch, not a translation project.
 */
export const en: SameShape<typeof fa> = {
  app: {
    name: "Shah Kelid",
  },
  common: {
    loading: "Loading…",
    retry: "Try again",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    back: "Back",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    offline: "You are offline.",
  },
  language: {
    fa: "فارسی",
    en: "English",
  },
};
