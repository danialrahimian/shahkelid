import { and, asc, eq, isNotNull, notInArray } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { linkPlans } from "../groups/link-plan";
import { panels } from "../infrastructure/schema";
import { shapeConfigs } from "./configs";
import { subscriptionPanels, subscriptions } from "./schema";
import { pageApps, pageInfo, renderPage, wantsPage } from "./page";
import { linkFor } from "./service";

/**
 * GET|HEAD /s/:token — the customer's subscription link.
 *
 * The VPN app (v2rayNG, Hiddify, Streisand…) fetches this every few hours.
 * We pass the request to the panel's own link and hand back its answer, so:
 *
 * - the panel's address is never given to customers;
 * - a subscription on several panels has one link: every panel is asked,
 *   and their configs are given as one list;
 * - a subscription can move to another panel without its link changing;
 * - revoking a link here stops it, whatever the panel does.
 *
 * The headers the panel reads to recognise a device (for the device limit)
 * and to choose a format (User-Agent) are passed on. Of the answer, only the
 * body and the headers apps read are returned: nothing that names the panel.
 *
 * Opened in a browser, the link is the shop's own subscription page
 * (./page.ts: PGClock Pro with the shop's brand). The page reads the rest
 * from beside itself, as it would from PasarGuard: /s/:token/info and /apps
 * are answered here from our records; /links, /raw and /usage are the
 * panel's, passed through with its own subscription address (also
 * URL-encoded) replaced by ours.
 */

const FORWARDED_REQUEST_HEADERS = [
  "user-agent",
  "accept",
  "x-hwid",
  "x-device-os",
  "x-ver-os",
  "x-device-model",
];

const RETURNED_HEADERS = [
  "content-type",
  "content-disposition",
  "subscription-userinfo",
  "profile-title",
  "profile-update-interval",
  "support-url",
  "announce",
  "announce-url",
  "routing",
];

/** What the subscription page asks for beside itself (PasarGuard's endpoints). */
const PARTS = new Set(["info", "apps", "links", "raw", "usage"]);

/**
 * The page is one HTML file with inline script, a font and a QR code
 * library from public CDNs, and a logo from anywhere: allowed for it, and
 * nothing else. It still talks only to us.
 */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Our link in place of the panel's, plain and URL-encoded, with or without a trailing slash. */
const swapLink = (body: string, panelUrl: string, ours: string) => {
  const bare = panelUrl.replace(/\/+$/, "");
  return body
    .split(`${bare}/`)
    .join(`${ours}/`)
    .split(bare)
    .join(ours)
    .split(encodeURIComponent(`${bare}/`))
    .join(encodeURIComponent(`${ours}/`))
    .split(encodeURIComponent(bare))
    .join(encodeURIComponent(ours));
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A base64 list of links (what most apps are given), decoded; or null. */
const fromBase64 = (text: string) => {
  const compact = text.replace(/\s+/g, "");
  if (compact === "" || !/^[A-Za-z0-9+/_-]+=*$/.test(compact)) return null;
  const decoded = Buffer.from(compact, "base64").toString("utf8");
  return decoded.includes("://") ? decoded : null;
};

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Several panels' configs as one answer, in the format they came in:
 * a list of links (plain or base64) is joined, a JSON list is joined. A
 * format that cannot be joined safely (Clash YAML, a sing-box profile) is
 * the main panel's alone.
 */
export const mergeConfigs = (bodies: string[]): string => {
  const json = bodies.map(parsed);
  if (json.every(Array.isArray)) return JSON.stringify((json as unknown[][]).flat());
  if (json.some((value) => value !== undefined && typeof value === "object")) return bodies[0]!;

  const decoded = bodies.map(fromBase64);
  const all = bodies.map((body, index) => decoded[index] ?? body);
  // Only link lists are joined: every line of every answer is a link.
  if (!all.every((text) => lines(text).length > 0 && lines(text).every((line) => /^[a-z][a-z0-9+.-]*:\/\//i.test(line)))) {
    return bodies[0]!;
  }
  const joined = [...new Set(all.flatMap(lines))].join("\n");
  return decoded[0] !== null ? Buffer.from(joined, "utf8").toString("base64") : joined;
};

/** Several panels' usage history as one list of points; the page adds up those of the same time. */
export const mergeUsage = (bodies: string[]): string => {
  const points: unknown[] = [];
  for (const body of bodies) {
    const json = parsed(body) as Record<string, unknown> | unknown[] | undefined;
    const stats = Array.isArray(json) ? json : json && ((json.stats ?? json.data ?? json.usage ?? json) as unknown);
    if (Array.isArray(stats)) points.push(...stats);
    else if (stats && typeof stats === "object") {
      for (const value of Object.values(stats)) if (Array.isArray(value)) points.push(...value);
    }
  }
  return JSON.stringify({ stats: points });
};

const TIMEOUT_MS = 10_000;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const GONE = ["deleted", "provisioning", "provisioning_failed"] as const;

const notFound = (res: Response) => res.status(404).type("text/plain").send("Not found");

export const subscriptionLinkRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();

  // Apps refresh every few hours. Opening the page asks for about six
  // things at once, so a few reloads a minute must still fit.
  router.use(limitPerIp({ redis, name: "sub-link", windowMs: 60_000, max: 120 }));

  // Express answers HEAD with the GET route; the method is passed on as it came.
  const serve = async (req: Request, res: Response, part: string | null) => {
    const token = String(req.params.token);
    if (!TOKEN.test(token)) return notFound(res);

    const [found] = await db
      .select({
        id: subscriptions.id,
        mainPanelId: subscriptions.panelId,
        panelUsername: subscriptions.panelUsername,
        status: subscriptions.status,
        onHoldDurationSeconds: subscriptions.onHoldDurationSeconds,
        usedBytes: subscriptions.usedBytes,
        dataLimitBytes: subscriptions.dataLimitBytes,
        expiresAt: subscriptions.expiresAt,
        subscriptionBaseUrl: panels.subscriptionBaseUrl,
      })
      .from(subscriptions)
      .innerJoin(panels, eq(panels.id, subscriptions.panelId))
      .where(and(eq(subscriptions.accessToken, token), notInArray(subscriptions.status, [...GONE])));
    if (!found) return notFound(res);
    // Every panel the subscription is on, the main one first.
    const members = (
      await db
        .select({ panelId: subscriptionPanels.panelId, url: subscriptionPanels.panelSubscriptionUrl })
        .from(subscriptionPanels)
        .where(and(eq(subscriptionPanels.subscriptionId, found.id), isNotNull(subscriptionPanels.panelSubscriptionUrl)))
        .orderBy(asc(subscriptionPanels.createdAt), asc(subscriptionPanels.panelId))
    )
      .sort((a, b) => Number(b.panelId === found.mainPanelId) - Number(a.panelId === found.mainPanelId))
      .map((row) => ({ panelId: row.panelId, url: row.url! }));
    const panelUrls = members.map((member) => member.url);
    if (panelUrls.length === 0) return notFound(res);
    const ours = linkFor(token, found.subscriptionBaseUrl);

    // The page and what it reads about the account: ours, not the panel's.
    if (part === null && req.method === "GET" && wantsPage(req)) {
      res.setHeader("content-security-policy", PAGE_CSP);
      res.setHeader("cache-control", "no-store");
      return res.type("html").send(renderPage());
    }
    if (part === "info") {
      const info = await pageInfo(db, token);
      return info ? res.setHeader("cache-control", "no-store").json(info) : notFound(res);
    }
    if (part === "apps") return res.setHeader("cache-control", "no-store").json(pageApps(ours));

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.get(name);
      if (value) headers.set(name, value);
    }

    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const ask = (panelUrl: string) =>
      fetch(`${panelUrl.replace(/\/+$/, "")}${part ? `/${part}` : ""}${query}`, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      }).catch((error: unknown) => {
        logger.warn({ err: error }, "Subscription link: a panel did not answer");
        return null;
      });

    // Every panel is asked at once. One that is down is left out: the
    // customer still gets the others' configs.
    const answers = (await Promise.all(panelUrls.map(ask))).map((response, index) => ({
      response,
      panelUrl: panelUrls[index]!,
      panelId: members[index]!.panelId,
    }));
    const reached = answers.filter(
      (answer): answer is { response: globalThis.Response; panelUrl: string; panelId: string } => answer.response !== null,
    );
    if (reached.length === 0) return res.status(502).type("text/plain").send("The service is temporarily unavailable");
    const good = reached.filter((answer) => answer.response.ok);
    const upstream = (good[0] ?? reached[0]!).response;

    if (upstream.status === 404) return notFound(res);

    res.status(upstream.status);
    for (const name of RETURNED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    // One volume across the panels: the app is told the whole, not one panel's share.
    if (panelUrls.length > 1) {
      const expire = found.expiresAt ? Math.floor(found.expiresAt.getTime() / 1000) : 0;
      res.setHeader("subscription-userinfo", `upload=0; download=${found.usedBytes}; total=${found.dataLimitBytes ?? 0}; expire=${expire}`);
    }
    // The panel names its own address here; the customer's page is our link.
    res.setHeader("profile-web-page-url", ours);
    res.setHeader("cache-control", "no-store");
    const type = upstream.headers.get("content-type") ?? "";

    if (req.method === "HEAD") return res.end();

    // The configs, as the customer's groups say: picked, named, in order.
    if ((part === null || part === "links") && good.length > 0) {
      const bodies = await Promise.all(good.map(async ({ response, panelUrl }) => swapLink(await response.text(), panelUrl, ours)));
      const plans = await linkPlans(db, found.id, good.map((answer) => answer.panelId)).catch((error: unknown) => {
        logger.warn({ err: error }, "Subscription link: the groups could not be read; the panels' answers are given as they are");
        return null;
      });
      const shaped = plans ? shapeConfigs(bodies, plans, { ...found, username: found.panelUsername }) : null;
      if (good.length > 1) res.removeHeader("content-disposition");
      return res.send(shaped ?? (good.length > 1 ? mergeConfigs(bodies) : bodies[0]!));
    }

    if (good.length <= 1) {
      const body = Buffer.from(await upstream.arrayBuffer());
      // JSON may carry the panel's address; the configs apps read (often
      // base64) are passed on byte for byte.
      if (type.includes("json")) return res.send(swapLink(body.toString("utf8"), (good[0] ?? reached[0]!).panelUrl, ours));
      return res.send(body);
    }

    const bodies = await Promise.all(good.map(async ({ response, panelUrl }) => swapLink(await response.text(), panelUrl, ours)));
    res.removeHeader("content-disposition");
    res.send(part === "usage" ? mergeUsage(bodies) : mergeConfigs(bodies));
  };

  router.get("/:token", (req, res) => serve(req, res, null));
  router.get("/:token/:part", (req, res) => {
    const part = String(req.params.part);
    return PARTS.has(part) ? serve(req, res, part) : notFound(res);
  });

  // Apps read status codes, not JSON: answer in plain text.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ApiError) || error.status !== 429) return next(error);
    res.setHeader("retry-after", String(error.retryAfterSeconds ?? 60));
    res.status(429).type("text/plain").send("Too many requests");
  });

  return router;
};
