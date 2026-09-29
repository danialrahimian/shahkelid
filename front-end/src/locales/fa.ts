/**
 * Persian: the site's language, and the source of truth for every key.
 *
 * The shape of this object is the shape every other language must match: the
 * type of `en` is derived from it, so a key added here and forgotten there is
 * a type error, not a blank label in production.
 */
export const fa = {
  app: {
    name: "شاه‌کلید",
  },
  common: {
    loading: "در حال بارگذاری…",
    retry: "تلاش دوباره",
    save: "ذخیره",
    cancel: "انصراف",
    close: "بستن",
    back: "بازگشت",
  },
  errors: {
    generic: "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
    offline: "اتصال اینترنت برقرار نیست.",
  },
  language: {
    fa: "فارسی",
    en: "English",
  },
} as const;
