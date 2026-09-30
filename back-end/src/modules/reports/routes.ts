import { reportRangeInput } from "@shah-kelid/contracts";
import { Router, type Request } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { parseBody } from "../../platform/http/validate";
import { breakdown, revenueByDay, summary, topCustomers } from "./service";

/**
 * /api/v1/staff/reports (analytics:read). Every report takes ?from=&to=,
 * two days (YYYY-MM-DD, Tehran), both included, at most a year apart.
 *
 *   GET /reports/summary      the headline figures, each against the range before
 *   GET /reports/revenue      one point per day
 *   GET /reports/breakdown    by plan, by payment method, new against renewal
 *   GET /reports/customers    the ten who paid most
 */

const rangeOf = (req: Request) => {
  const { from, to } = parseBody(reportRangeInput, req.query);
  return { from, to };
};

export const reportsRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use(requirePermission("analytics:read"));

  router.get("/summary", async (req, res) => {
    res.json(await summary(db, rangeOf(req)));
  });
  router.get("/revenue", async (req, res) => {
    res.json(await revenueByDay(db, rangeOf(req)));
  });
  router.get("/breakdown", async (req, res) => {
    res.json(await breakdown(db, rangeOf(req)));
  });
  router.get("/customers", async (req, res) => {
    res.json(await topCustomers(db, rangeOf(req)));
  });

  return router;
};
