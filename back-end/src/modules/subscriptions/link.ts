import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";

import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { panels } from "../infrastructure/schema";
import { subscriptionPanels, subscriptions } from "./schema";
import { pageApps, pageInfo, renderPage, wantsPage } from "./page";
import { linkFor } from "./service";

/**
 * GET /s/:token — what the customer's link serves from the shop's records.
 *
 * The link itself is the panel service's (panel/, in Go): it asks the
 * panels for the customer's configs and shapes them by the customer's
 * groups. What it passes here, as it came, is what the shop answers from
 * its own records:
 *
 * - the subscription page, for a browser (PGClock Pro with the shop's brand);
 * - /s/:token/info and /apps, which the page reads beside itself.
 *
 * Anything else here is a link asked for without the panel service in
 * front (Caddy sends /s/* to it): not found.
 */

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

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const GONE = ["deleted", "provisioning", "provisioning_failed"] as const;

const notFound = (res: Response) => res.status(404).type("text/plain").send("Not found");

export const subscriptionLinkRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();

  // Opening the page asks for about six things at once, so a few reloads a
  // minute must still fit.
  router.use(limitPerIp({ redis, name: "sub-link", windowMs: 60_000, max: 120 }));

  const serve = async (req: Request, res: Response, part: string | null) => {
    const token = String(req.params.token);
    if (!TOKEN.test(token)) return notFound(res);

    const [found] = await db
      .select({ id: subscriptions.id, subscriptionBaseUrl: panels.subscriptionBaseUrl })
      .from(subscriptions)
      .innerJoin(panels, eq(panels.id, subscriptions.panelId))
      .where(and(eq(subscriptions.accessToken, token), notInArray(subscriptions.status, [...GONE])));
    if (!found) return notFound(res);
    const [onPanel] = await db
      .select({ panelId: subscriptionPanels.panelId })
      .from(subscriptionPanels)
      .where(and(eq(subscriptionPanels.subscriptionId, found.id), isNotNull(subscriptionPanels.panelSubscriptionUrl)))
      .limit(1);
    if (!onPanel) return notFound(res);

    if (part === null && req.method === "GET" && wantsPage(req)) {
      res.setHeader("content-security-policy", PAGE_CSP);
      res.setHeader("cache-control", "no-store");
      return res.type("html").send(renderPage());
    }
    if (part === "info") {
      const info = await pageInfo(db, token);
      return info ? res.setHeader("cache-control", "no-store").json(info) : notFound(res);
    }
    if (part === "apps") return res.setHeader("cache-control", "no-store").json(pageApps(linkFor(token, found.subscriptionBaseUrl)));
    return notFound(res);
  };

  router.get("/:token", (req, res) => serve(req, res, null));
  router.get("/:token/:part", (req, res) => {
    const part = String(req.params.part);
    return part === "info" || part === "apps" ? serve(req, res, part) : notFound(res);
  });

  // Apps read status codes, not JSON: answer in plain text.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ApiError) || error.status !== 429) return next(error);
    res.setHeader("retry-after", String(error.retryAfterSeconds ?? 60));
    res.status(429).type("text/plain").send("Too many requests");
  });

  return router;
};
