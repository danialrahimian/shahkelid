import { bytesToGigabytes } from "@shah-kelid/contracts";

import i18n from "@/lib/i18n";

/**
 * Numbers, volumes, money and dates the way a Persian reader expects them:
 * Persian digits, the Solar Hijri calendar, toman.
 *
 * Built on Intl with the current language, so the same calls give Latin
 * digits and the Gregorian calendar in English.
 */

const locale = () => (i18n.language === "fa" ? "fa-IR" : i18n.language);

export const formatNumber = (value: number) => new Intl.NumberFormat(locale()).format(value);

/** 53687091200 → "۵۰ گیگ". Binary gigabytes, as the panel counts. */
export const formatGb = (bytes: number | null) =>
  bytes === null
    ? i18n.t("staff.common.unlimited")
    : i18n.t("staff.units.gb", { amount: formatNumber(bytesToGigabytes(bytes)) });

export const formatUsage = (used: number, limit: number | null) =>
  i18n.t("staff.units.usage", { used: formatGb(used), total: formatGb(limit) });

export const formatToman = (amount: number) =>
  i18n.t("staff.units.toman", { amount: formatNumber(amount) });

/** "۸ مهر ۱۴۰۵" */
export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(iso)) : "—";

/** "۸ مهر ۱۴۰۵، ۱۴:۰۵" */
export const formatDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      )
    : "—";

/** How full, 0 to 1, for a meter. Unlimited is never full. */
export const fullness = (used: number, limit: number | null) =>
  limit === null || limit <= 0 ? 0 : Math.min(1, used / limit);
