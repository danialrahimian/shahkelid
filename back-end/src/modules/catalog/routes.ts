import { planInput } from "@shah-kelid/contracts";
import { Router } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { parseBody, parseId } from "../../platform/http/validate";
import { archivePlan, findPlanView, listPlans, savePlan } from "./service";

/**
 * /api/v1/staff/plans. All need plans:manage.
 *
 *   GET  /plans            POST /plans            GET|PUT /plans/:id
 *   POST /plans/:id/archive    no longer sold
 */
export const catalogRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use("/plans", requirePermission("plans:manage"));

  router.get("/plans", async (_req, res) => {
    res.json(await listPlans(db));
  });
  router.post("/plans", async (req, res) => {
    res.status(201).json(await savePlan(db, staffActor(req), null, parseBody(planInput, req.body)));
  });
  router.get("/plans/:id", async (req, res) => {
    res.json(await findPlanView(db, parseId(req.params.id)));
  });
  router.put("/plans/:id", async (req, res) => {
    const id = parseId(req.params.id);
    res.json(await savePlan(db, staffActor(req), id, parseBody(planInput, req.body)));
  });
  router.post("/plans/:id/archive", async (req, res) => {
    res.json(await archivePlan(db, staffActor(req), parseId(req.params.id)));
  });

  return router;
};
