import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq, notInArray } from "drizzle-orm";
import type { Request } from "express";

import config from "../../config";
import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { panels } from "../infrastructure/schema";
import { syncSubscription } from "../provisioning/sync";
import { subscriptions } from "./schema";
import { linkFor } from "./service";

/**
 * The page a customer sees when they open their subscription link in a
 * browser: PGClock Pro (./page/pgclock-pro.html, by Mr.Clock, used with
 * permission), with the shop's brand. It reads its data from beside itself,
 * as it would from PasarGuard; /info and /apps are answered here from the
 * shop's own records, so it shows the customer's name and plan rather than
 * the panel's internal username, and its "add to app" buttons carry the
 * shop's link. /links, /raw and /usage still come from the panel (link.ts).
 */

/** A browser asking for a page, as opposed to a VPN app asking for configs. */
export const wantsPage = (req: Request) =>
  /\btext\/html\b/.test(req.get("accept") ?? "") && /^Mozilla\//.test(req.get("user-agent") ?? "");

const TEMPLATE = readFileSync(path.join(__dirname, "page", "pgclock-pro.html"), "utf8");

/** JSON for an inline script: nothing in it can close the tag. */
const inline = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const supportUrl = () => `${config.cors.origin}/support`;

/** The page, with the shop's brand and support link set before its script runs. */
export const renderPage = () => {
  const settings = `<script>
    window.MRCLOCK_BRAND = ${inline({
      name: "شاه‌کلید",
      subtitle: { fa: "اشتراک شما", en: "Your subscription" },
      logoUrl: "",
    })};
    window.PASARGUARD_CONFIG = ${inline({ supportUrl: supportUrl() })};
  </script>
  `;
  // Before the template's own (first) script, which reads both at once.
  const at = TEMPLATE.indexOf("<script>");
  return at < 0 ? TEMPLATE : `${TEMPLATE.slice(0, at)}${settings}${TEMPLATE.slice(at)}`;
};

const FRESH_MS = 60_000;
const WAIT_MS = 3_000;
const SHOWN = ["on_hold", "active", "limited", "expired", "disabled"] as const;

const read = (db: Db, token: string) =>
  db
    .select({
      subscription: subscriptions,
      planName: plans.name,
      displayName: users.displayName,
      username: users.username,
      email: users.email,
      subscriptionBaseUrl: panels.subscriptionBaseUrl,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .innerJoin(panels, eq(panels.id, subscriptions.panelId))
    .where(
      and(
        eq(subscriptions.accessToken, token),
        notInArray(subscriptions.status, ["deleted", "provisioning", "provisioning_failed"]),
      ),
    );

/**
 * The account as the page reads it (PasarGuard's field names), from our
 * records. Usage is read from the panel first when the last read is over a
 * minute old, waiting at most three seconds for it.
 */
export const pageInfo = async (db: Db, token: string) => {
  let [row] = await read(db, token);
  if (!row) return null;
  const synced = row.subscription.lastSyncedAt?.getTime() ?? 0;
  if ((SHOWN as readonly string[]).includes(row.subscription.status) && Date.now() - synced > FRESH_MS) {
    const work = syncSubscription(db, row.subscription).catch((error: unknown) =>
      logger.debug({ err: error }, "Subscription page: the panel was not read; showing the last usage"),
    );
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
    [row] = await read(db, token);
    if (!row) return null;
  }

  const s = row.subscription;
  const onHold = s.status === "on_hold" && s.onHoldDurationSeconds !== null;
  return {
    username: row.displayName || row.username || row.email?.split("@")[0] || "—",
    plan: row.planName,
    status: s.status,
    used_traffic: s.usedBytes,
    lifetime_used_traffic: s.lifetimeUsedBytes,
    // 0 is "unlimited" to the page.
    data_limit: s.dataLimitBytes ?? 0,
    expire: s.expiresAt?.toISOString() ?? null,
    // Its time starts at first use: shown as the whole duration still to come.
    on_hold_timeout: onHold ? new Date(Date.now() + s.onHoldDurationSeconds! * 1000).toISOString() : null,
    online_at: s.onlineAt?.toISOString() ?? null,
    device_limit: s.deviceLimit,
    created_at: s.createdAt.toISOString(),
    edit_at: s.updatedAt.toISOString(),
    subscription_url: linkFor(s.accessToken, row.subscriptionBaseUrl),
    support_url: supportUrl(),
  };
};

/**
 * The apps the page offers, each with where to get it and, where the app
 * has one, a button that adds this link to it. v2rayN (Windows) has no such
 * scheme: its card says where to paste the link.
 *
 * The page shows a download only in the language it is shown in, falling
 * back to "fa" for English: each is marked "fa", with both names in it.
 */
export const pageApps = (link: string) => {
  const encoded = encodeURIComponent(link);
  const named = (scheme: string) => `${scheme}#${encodeURIComponent("Shah Kelid")}`;
  return [
    {
      name: "v2rayN",
      platform: "windows",
      recommended: true,
      description: {
        fa: "لینک اشتراک را کپی کنید؛ در v2rayN از منوی Subscription group آن را اضافه کنید و Update subscription را بزنید.",
        en: "Copy the subscription link; in v2rayN add it under Subscription group, then press Update subscription.",
      },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/2dust/v2rayN/releases/latest", language: "fa" }],
    },
    {
      name: "Hiddify",
      platform: "windows",
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/hiddify/hiddify-app/releases/latest", language: "fa" }],
      import_url: named(`hiddify://import/${link}`),
    },
    {
      name: "v2rayNG",
      platform: "android",
      recommended: true,
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/2dust/v2rayNG/releases/latest", language: "fa" }],
      import_url: `v2rayng://install-config?url=${encoded}`,
    },
    {
      name: "Hiddify",
      platform: "android",
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/hiddify/hiddify-app/releases/latest", language: "fa" }],
      import_url: named(`hiddify://import/${link}`),
    },
    {
      name: "Streisand",
      platform: "ios",
      recommended: true,
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "اپ استور", en: "App Store" }, url: "https://apps.apple.com/app/streisand/id6450534064", language: "fa" }],
      import_url: `streisand://import/${link}`,
    },
    {
      name: "Hiddify",
      platform: "macos",
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/hiddify/hiddify-app/releases/latest", language: "fa" }],
      import_url: named(`hiddify://import/${link}`),
    },
    {
      name: "Hiddify",
      platform: "linux",
      description: { fa: "با دکمه‌ی افزودن، لینک خودکار اضافه می‌شود.", en: "The add button puts the link in the app." },
      download_links: [{ name: { fa: "دانلود", en: "Download" }, url: "https://github.com/hiddify/hiddify-app/releases/latest", language: "fa" }],
      import_url: named(`hiddify://import/${link}`),
    },
  ];
};
