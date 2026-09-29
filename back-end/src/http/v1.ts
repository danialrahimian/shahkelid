import { Router } from "express";

import config from "../config";
import { accessRouter } from "../modules/access/routes";
import { identityRouter } from "../modules/identity/routes";
import { getDb } from "../platform/db/client";
import { accountSession, loadAccount } from "../platform/http/account-session";
import { v1ErrorHandler, v1NotFound } from "../platform/http/error-handler";
import { requireSameOrigin } from "../platform/http/same-origin";
import { getAppRedis } from "../platform/redis";

/**
 * /api/v1: the rebuilt API, on PostgreSQL.
 *
 * Mounted beside the old routes rather than inside them. It has its own
 * session (Redis, cookie "sk.sid") and its own error shape, and it never
 * touches MongoDB, so each old module can be retired without disturbing it.
 */
export const createV1Router = () => {
  const db = getDb();
  const redis = getAppRedis();
  const router = Router();

  router.use(requireSameOrigin([config.cors.origin]));
  router.use(accountSession(redis));
  router.use(loadAccount(db));

  router.use("/auth", identityRouter({ db, redis }));
  router.use("/staff", accessRouter({ db }));

  router.use(v1NotFound);
  router.use(v1ErrorHandler);
  return router;
};
