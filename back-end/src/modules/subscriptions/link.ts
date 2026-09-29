import { and, eq, notInArray } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { panels } from "../infrastructure/schema";
import { subscriptions } from "./schema";
import { linkFor } from "./service";

/**
 * GET|HEAD /s/:token — the customer's subscription link.
 *
 * The VPN app (v2rayNG, Hiddify, Streisand…) fetches this every few hours.
 * We pass the request to the panel's own link and hand back its answer, so:
 *
 * - the panel's address is never given to customers;
 * - a subscription can move to another panel without its link changing;
 * - revoking a link here stops it, whatever the panel does.
 *
 * The headers the panel reads to recognise a device (for the device limit)
 * and to choose a format (User-Agent) are passed on. Of the answer, only the
 * body and the headers apps read are returned: nothing that names the panel.
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

const TIMEOUT_MS = 10_000;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const GONE = ["deleted", "provisioning", "provisioning_failed"] as const;

const notFound = (res: Response) => res.status(404).type("text/plain").send("Not found");

export const subscriptionLinkRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();

  // Apps refresh every few hours; a few a minute is already generous.
  router.use(limitPerIp({ redis, name: "sub-link", windowMs: 60_000, max: 30 }));

  // Express answers HEAD with the GET route; the method is passed on as it came.
  router.get("/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token);
    if (!TOKEN.test(token)) return notFound(res);

    const [found] = await db
      .select({
        panelUrl: subscriptions.panelSubscriptionUrl,
        subscriptionBaseUrl: panels.subscriptionBaseUrl,
      })
      .from(subscriptions)
      .innerJoin(panels, eq(panels.id, subscriptions.panelId))
      .where(and(eq(subscriptions.accessToken, token), notInArray(subscriptions.status, [...GONE])));
    if (!found?.panelUrl) return notFound(res);

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.get(name);
      if (value) headers.set(name, value);
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(found.panelUrl, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      logger.warn({ err: error }, "Subscription link: the panel did not answer");
      return res.status(502).type("text/plain").send("The service is temporarily unavailable");
    }

    if (upstream.status === 404) return notFound(res);

    res.status(upstream.status);
    for (const name of RETURNED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    // The panel names its own address here; the customer's page is our link.
    res.setHeader("profile-web-page-url", linkFor(token, found.subscriptionBaseUrl));
    res.setHeader("cache-control", "no-store");

    if (req.method === "HEAD") return res.end();
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  // Apps read status codes, not JSON: answer in plain text.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ApiError) || error.status !== 429) return next(error);
    res.setHeader("retry-after", String(error.retryAfterSeconds ?? 60));
    res.status(429).type("text/plain").send("Too many requests");
  });

  return router;
};
