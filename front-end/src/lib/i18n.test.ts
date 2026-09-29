import { describe, expect, it } from "vitest";

import i18n, { applyDocumentLanguage, directionOf } from "@/lib/i18n";
import { en } from "@/locales/en";
import { fa } from "@/locales/fa";

/**
 * Language and direction.
 *
 * The one thing that must never happen is a Persian page laid out left to
 * right, or an English one right to left: every logical class in the app
 * (`ms-*`, `text-start`) takes its meaning from the direction set here.
 */

describe("Direction", () => {
  it("When the language is Persian, then the page runs right to left", () => {
    expect(directionOf("fa")).toBe("rtl");
  });

  it("When the language is English, then the page runs left to right", () => {
    expect(directionOf("en")).toBe("ltr");
  });

  it("When the language is unknown, then it falls back to Persian's direction", () => {
    expect(directionOf("xx")).toBe("rtl");
  });

  it("When the language changes, then <html> gets both its lang and its dir", () => {
    const root = { lang: "", dir: "" };

    applyDocumentLanguage(root, "en");
    expect(root).toEqual({ lang: "en", dir: "ltr" });

    applyDocumentLanguage(root, "fa");
    expect(root).toEqual({ lang: "fa", dir: "rtl" });
  });
});

describe("Translations", () => {
  it("When nothing is chosen, then the site speaks Persian", () => {
    expect(i18n.language).toBe("fa");
    expect(i18n.t("common.save")).toBe("ذخیره");
  });

  it("When English is used, then the same key has its English text", () => {
    expect(i18n.getFixedT("en")("common.save")).toBe("Save");
  });

  it("When a key exists in Persian, then it exists in English too", () => {
    // The type already requires this; the test guards against a cast or an
    // `as any` quietly defeating it.
    const keys = (table: object, prefix = ""): string[] =>
      Object.entries(table).flatMap(([key, value]) =>
        typeof value === "string" ? [`${prefix}${key}`] : keys(value as object, `${prefix}${key}.`),
      );

    expect(keys(en).sort()).toEqual(keys(fa).sort());
  });
});
