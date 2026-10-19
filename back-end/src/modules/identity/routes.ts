import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import type { Redis } from "ioredis";

import {
  deleteAccountInput,
  passwordSignInInput,
  requestCodeInput,
  resetPasswordInput,
  secondFactorInput,
  setPasswordInput,
  updateProfileInput,
  verifyCodeInput,
} from "@shah-kelid/contracts";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import {
  endAccountSession,
  markSecondFactorPassed,
  requireSignedIn,
  sessionViewOf,
  startAccountSession,
} from "../../platform/http/account-session";
import { ApiError, signInRequired } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { parseBody } from "../../platform/http/validate";
import {
  requestPasswordReset,
  requestSignInCode,
  resetPassword,
  setFirstPassword,
  signInWithCode,
  signInWithPassword,
} from "./service";
import { deleteAccount } from "./delete-account";
import { users } from "./schema";
import { beginSetup, enableTwoFactor, verifySecondFactor } from "./two-factor";

/**
 * /api/v1/auth: signing in, out, and everything in between.
 *
 *   POST /code             send a sign-in code (also how an account is made)
 *   POST /code/verify      sign in with it
 *   POST /password         sign in with a password
 *   POST /password/forgot  send a reset code
 *   POST /password/reset   set a new password with it
 *   PUT  /password         set a first password (accounts made by code)
 *   PUT  /profile          the name shown on invoices and to staff
 *   GET  /session          where the session stands
 *   POST /sign-out
 *   POST /two-factor/setup    start authenticator setup
 *   POST /two-factor/enable   finish it; returns recovery codes, once
 *   POST /two-factor/verify   the second step of signing in
 */

const requestInfo = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
  requestId: (req as { id?: string }).id ?? null,
});

export const identityRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();
  const context = { db, redis };

  // Credential endpoints, per IP. Per-address limits (codes per hour, the
  // password lock) are in the services and apply on top.
  const perIp = limitPerIp({
    redis,
    name: "auth",
    windowMs: config.auth.rateLimitWindowMs,
    max: config.auth.rateLimitMax,
  });

  router.post("/code", perIp, async (req, res) => {
    const { email } = parseBody(requestCodeInput, req.body);
    await requestSignInCode(context, email);
    res.status(202).json({ status: "code_sent" });
  });

  router.post("/code/verify", perIp, async (req, res) => {
    const { email, code } = parseBody(verifyCodeInput, req.body);
    const user = await signInWithCode(context, email, code);
    await startAccountSession(req, user);
    res.json(await sessionViewOf(db, req));
  });

  router.post("/password", perIp, async (req, res) => {
    const { login, password } = parseBody(passwordSignInInput, req.body);
    const user = await signInWithPassword(context, login, password);
    await startAccountSession(req, user);
    res.json(await sessionViewOf(db, req));
  });

  router.post("/password/forgot", perIp, async (req, res) => {
    const { email } = parseBody(requestCodeInput, req.body);
    await requestPasswordReset(context, email);
    res.status(202).json({ status: "code_sent" });
  });

  router.post("/password/reset", perIp, async (req, res) => {
    const { email, code, newPassword } = parseBody(resetPasswordInput, req.body);
    await resetPassword(context, email, code, newPassword, requestInfo(req));
    res.json({ status: "password_reset" });
  });

  router.put("/password", requireSignedIn, async (req, res) => {
    const { newPassword } = parseBody(setPasswordInput, req.body);
    await setFirstPassword(db, req.account!.user, newPassword, requestInfo(req));
    res.status(204).end();
  });

  router.put("/profile", requireSignedIn, async (req, res) => {
    const { displayName } = parseBody(updateProfileInput, req.body);
    await db.update(users).set({ displayName }).where(eq(users.id, req.account!.user.id));
    res.json(await sessionViewOf(db, req));
  });

  /** Deleting one's own account; what is typed must be its email (or username). */
  router.post("/delete-account", requireSignedIn, async (req, res) => {
    const { email } = parseBody(deleteAccountInput, req.body);
    const user = req.account!.user;
    const confirmation = user.email ?? user.username ?? "";
    if (email.toLowerCase() !== confirmation.toLowerCase()) {
      throw new ApiError(400, "CONFIRMATION_MISMATCH", "Type the account's email to confirm", {
        fields: [{ path: "email", code: "CONFIRMATION_MISMATCH" }],
      });
    }
    await deleteAccount(db, user.id, "self");
    await endAccountSession(req, res);
    res.status(204).end();
  });

  router.get("/session", async (req, res) => {
    res.json(await sessionViewOf(db, req));
  });

  router.post("/sign-out", async (req, res) => {
    await endAccountSession(req, res);
    res.status(204).end();
  });

  // --------------------------------------------------------------- two-factor

  /** Setting up is allowed signed in, or when setup is the one thing left. */
  const accountForSetup = (req: Request) => {
    const account = req.account;
    if (!account) throw signInRequired();
    if (account.status === "two_factor_pending") {
      throw new ApiError(401, "TWO_FACTOR_REQUIRED", "Enter your authenticator code");
    }
    return account;
  };

  router.post("/two-factor/setup", perIp, async (req, res) => {
    const account = accountForSetup(req);
    res.json(await beginSetup(redis, account.user));
  });

  router.post("/two-factor/enable", perIp, async (req, res) => {
    const account = accountForSetup(req);
    const { code } = parseBody(secondFactorInput, req.body);
    const recoveryCodes = await enableTwoFactor(db, redis, account.user, code, requestInfo(req));
    // Proving the app works is proof of the second factor for this session.
    await markSecondFactorPassed(req);
    res.json({ recoveryCodes, session: await sessionViewOf(db, req) });
  });

  router.post("/two-factor/verify", perIp, async (req, res) => {
    const account = req.account;
    if (!account) throw signInRequired();
    if (account.status !== "two_factor_pending") {
      throw new ApiError(409, "CONFLICT", "No authenticator code is expected now");
    }
    const { code } = parseBody(secondFactorInput, req.body);
    await verifySecondFactor(db, redis, account.user, code, requestInfo(req));
    await markSecondFactorPassed(req);
    res.json(await sessionViewOf(db, req));
  });

  return router;
};
