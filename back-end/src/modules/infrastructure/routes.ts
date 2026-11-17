import { panelInput, panelUpdateInput } from "@shah-kelid/contracts";
import { Router } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { parseBody, parseId } from "../../platform/http/validate";
import { checkPanel, createPanel, listPanelGroups, listPanels, updatePanel } from "./service";

/**
 * /api/v1/staff: the panels. All need servers:manage.
 *
 *   GET  /panels                  POST /panels           PUT /panels/:id
 *   POST /panels/:id/check        ask the panel how it is
 *   GET  /panels/:id/groups       the panel's groups, to put in our groups
 */
export const infrastructureRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use("/panels", requirePermission("servers:manage"));

  router.get("/panels", async (_req, res) => {
    res.json(await listPanels(db));
  });
  router.post("/panels", async (req, res) => {
    res.status(201).json(await createPanel(db, staffActor(req), parseBody(panelInput, req.body)));
  });
  router.put("/panels/:id", async (req, res) => {
    const id = parseId(req.params.id);
    res.json(await updatePanel(db, staffActor(req), id, parseBody(panelUpdateInput, req.body)));
  });
  router.post("/panels/:id/check", async (req, res) => {
    res.json(await checkPanel(db, parseId(req.params.id)));
  });
  router.get("/panels/:id/groups", async (req, res) => {
    res.json(await listPanelGroups(db, parseId(req.params.id)));
  });

  return router;
};
