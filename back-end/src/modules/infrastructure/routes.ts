import { panelInput, panelUpdateInput, subscriptionDomainInput } from "@shah-kelid/contracts";
import { Router } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { parseBody, parseId } from "../../platform/http/validate";
import {
  addSubscriptionDomain,
  checkSubscriptionDomain,
  listSubscriptionDomains,
  makePrimarySubscriptionDomain,
  removeSubscriptionDomain,
} from "./domains";
import { checkPanel, createPanel, listPanelGroups, listPanels, updatePanel } from "./service";

/**
 * /api/v1/staff: the panels. All need servers:manage.
 *
 *   GET  /panels                  POST /panels           PUT /panels/:id
 *   POST /panels/:id/check        ask the panel how it is
 *   GET  /panels/:id/groups       the panel's groups, to put in our groups
 *
 *   GET  /subscription-domains                  POST /subscription-domains
 *   PUT  /subscription-domains/:domain/primary  DELETE /subscription-domains/:domain
 *   POST /subscription-domains/:domain/check    does it reach this server
 */
export const infrastructureRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use("/panels", requirePermission("servers:manage"));
  router.use("/subscription-domains", requirePermission("servers:manage"));

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

  router.get("/subscription-domains", async (_req, res) => {
    res.json(await listSubscriptionDomains(db));
  });
  router.post("/subscription-domains", async (req, res) => {
    res.status(201).json(await addSubscriptionDomain(db, staffActor(req), parseBody(subscriptionDomainInput, req.body)));
  });
  router.put("/subscription-domains/:domain/primary", async (req, res) => {
    res.json(await makePrimarySubscriptionDomain(db, staffActor(req), String(req.params.domain).toLowerCase()));
  });
  router.delete("/subscription-domains/:domain", async (req, res) => {
    res.json(await removeSubscriptionDomain(db, staffActor(req), String(req.params.domain).toLowerCase()));
  });
  router.post("/subscription-domains/:domain/check", async (req, res) => {
    res.json(await checkSubscriptionDomain(db, String(req.params.domain).toLowerCase()));
  });

  return router;
};
