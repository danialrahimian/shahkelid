import "i18next";

import type { fa } from "@/locales/fa";

/**
 * Makes `t("common.save")` type-checked against the Persian table: a key that
 * does not exist is a compile error instead of the raw key on screen.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof fa };
  }
}
