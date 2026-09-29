import type { RequestHandler } from "express";

import { ApiError } from "./api-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery protection for the cookie-authenticated API.
 *
 * A forged request comes from another site in the victim's own browser, and
 * browsers always send an Origin header on such a request. So: a request that
 * changes something and carries an Origin must carry ours, or it is refused.
 *
 * A request with no Origin at all did not come from a web page (the Telegram
 * bot, a test, curl). Those clients authenticate with their own tokens, not
 * with a browser's cookies, so there is nothing to forge. The session cookie
 * is also SameSite=Lax, a second line of defence behind this one.
 */
export const requireSameOrigin =
  (allowedOrigins: readonly string[]): RequestHandler =>
  (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin === undefined || allowedOrigins.includes(origin)) return next();

    next(new ApiError(403, "CROSS_ORIGIN", `Requests from ${origin} are not accepted`));
  };
