import type { NextFunction, Request, RequestHandler, Response } from "express";
import session from "express-session";
import type { Redis } from "ioredis";

import type { SessionView } from "@shah-kelid/contracts";

import config from "../../config";
import { accessOf, type AccessProfile } from "../../modules/access/roles";
import type { Permission } from "../../modules/access/permissions";
import { accountView, findUserById, type User } from "../../modules/identity/service";
import type { Db } from "../db/client";
import { ApiError, forbidden, signInRequired } from "./api-error";
import { RedisSessionStore } from "./redis-session-store";

/**
 * The account session: who is signed in, and how far.
 *
 * Signing in has up to two steps. After a password or an emailed code, an
 * account with an authenticator is only half in ("two_factor_pending") and
 * can do nothing but finish. A staff account without an authenticator can do
 * nothing but set one up ("two_factor_setup_required"). Only "signed_in"
 * reaches anything else. The guards below are the only way routes check
 * this, so no route can forget a step.
 */

declare module "express-session" {
  interface SessionData {
    account?: {
      userId: string;
      /** "passed" once the authenticator code is accepted. */
      secondFactor: "pending" | "passed";
      signedInAt: number;
    };
  }
}

export type AccountContext = {
  user: User;
  access: AccessProfile;
  status: Exclude<SessionView["status"], "signed_out">;
};

declare module "express-serve-static-core" {
  interface Request {
    account?: AccountContext;
  }
}

export const accountSession = (redis: Redis) =>
  session({
    name: config.account.sessionName,
    secret: config.session.secret,
    store: new RedisSessionStore({ redis, prefix: "account-sess:" }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: config.account.sessionMaxAgeMs,
    },
  });

const statusOf = (user: User, access: AccessProfile, secondFactor: "pending" | "passed") => {
  if (access.requiresTwoFactor && !user.totpEnabledAt) return "two_factor_setup_required" as const;
  if (user.totpEnabledAt && secondFactor !== "passed") return "two_factor_pending" as const;
  return "signed_in" as const;
};

/**
 * Resolves the session to an account on every request.
 *
 * Read fresh each time rather than trusted from the session: a role removed,
 * or an account suspended, takes effect on the very next request, not when
 * the session happens to expire.
 */
/**
 * Whether a stored session still counts: the account exists and is active,
 * and the session began after the last time its sessions were revoked (a
 * password reset signs out every other device).
 */
const stillValid = (user: User | undefined, stored: { signedInAt: number }): user is User =>
  Boolean(user) &&
  user!.status === "active" &&
  (user!.sessionsRevokedAt === null || stored.signedInAt > user!.sessionsRevokedAt.getTime());

export const loadAccount =
  (db: Db): RequestHandler =>
  async (req, _res, next) => {
    const stored = req.session?.account;
    if (!stored) return next();

    const user = await findUserById(db, stored.userId);
    if (!stillValid(user, stored)) {
      delete req.session.account;
      return next();
    }

    const access = await accessOf(db, user.id);
    req.account = { user, access, status: statusOf(user, access, stored.secondFactor) };
    next();
  };

const promisify =
  (req: Request) =>
  (method: "regenerate" | "save" | "destroy") =>
    new Promise<void>((resolve, reject) =>
      req.session[method]((error: unknown) => (error ? reject(error) : resolve())),
    );

/**
 * Starts a signed-in session. The session id is replaced first, so an id
 * planted in someone's browser before they signed in is worthless after.
 */
export const startAccountSession = async (req: Request, user: User) => {
  await promisify(req)("regenerate");
  req.session.account = {
    userId: user.id,
    secondFactor: user.totpEnabledAt ? "pending" : "passed",
    signedInAt: Date.now(),
  };
  await promisify(req)("save");
};

export const markSecondFactorPassed = async (req: Request) => {
  if (!req.session.account) return;
  // A new id at the step that grants full access, for the same reason.
  const account = { ...req.session.account, secondFactor: "passed" as const };
  await promisify(req)("regenerate");
  req.session.account = account;
  await promisify(req)("save");
};

export const endAccountSession = async (req: Request, res: Response) => {
  await promisify(req)("destroy");
  res.clearCookie(config.account.sessionName);
};

export const sessionViewOf = async (db: Db, req: Request): Promise<SessionView> => {
  const stored = req.session?.account;
  if (!stored) return { status: "signed_out" };

  const user = await findUserById(db, stored.userId);
  if (!stillValid(user, stored)) return { status: "signed_out" };

  const access = await accessOf(db, user.id);
  const status = statusOf(user, access, stored.secondFactor);
  if (status === "two_factor_pending") return { status };
  return { status, account: accountView(user, access) };
};

// ------------------------------------------------------------------- guards

const fail = (next: NextFunction, error: ApiError) => next(error);

/** Fully signed in: every step done. */
export const requireSignedIn: RequestHandler = (req, _res, next) => {
  const account = req.account;
  if (!account) return fail(next, signInRequired());
  if (account.status === "two_factor_pending") {
    return fail(next, new ApiError(401, "TWO_FACTOR_REQUIRED", "Enter your authenticator code"));
  }
  if (account.status === "two_factor_setup_required") {
    return fail(
      next,
      new ApiError(403, "TWO_FACTOR_SETUP_REQUIRED", "Set up two-factor sign-in first"),
    );
  }
  next();
};

/** Fully signed in and holding the permission. */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, res, next) =>
    requireSignedIn(req, res, (error?: unknown) => {
      if (error) return next(error);
      if (!req.account!.access.permissions.has(permission)) {
        return next(forbidden(`This needs the ${permission} permission`));
      }
      next();
    });
