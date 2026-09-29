import { locationInput, panelInput, panelUpdateInput, serverInput } from "@shah-kelid/contracts";
import { Router } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { parseBody, parseId } from "../../platform/http/validate";
import {
  archiveServer,
  checkPanel,
  createPanel,
  listLocations,
  listPanelGroups,
  listPanels,
  listServers,
  saveLocation,
  saveServer,
  updatePanel,
} from "./service";

/**
 * /api/v1/staff: where subscriptions are placed. All need servers:manage.
 *
 *   GET  /panels                  POST /panels           PUT /panels/:id
 *   POST /panels/:id/check        ask the panel how it is
 *   GET  /panels/:id/groups       the panel's groups, to pick one per server
 *   GET  /locations               POST /locations        PUT /locations/:id
 *   GET  /servers                 POST /servers          PUT /servers/:id
 *   POST /servers/:id/archive     no new customers; existing ones stay
 */
export const infrastructureRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use(["/panels", "/locations", "/servers"], requirePermission("servers:manage"));

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

  router.get("/locations", async (_req, res) => {
    res.json(await listLocations(db));
  });
  router.post("/locations", async (req, res) => {
    res.status(201).json(await saveLocation(db, staffActor(req), null, parseBody(locationInput, req.body)));
  });
  router.put("/locations/:id", async (req, res) => {
    const id = parseId(req.params.id);
    res.json(await saveLocation(db, staffActor(req), id, parseBody(locationInput, req.body)));
  });

  router.get("/servers", async (_req, res) => {
    res.json(await listServers(db));
  });
  router.post("/servers", async (req, res) => {
    res.status(201).json(await saveServer(db, staffActor(req), null, parseBody(serverInput, req.body)));
  });
  router.put("/servers/:id", async (req, res) => {
    const id = parseId(req.params.id);
    res.json(await saveServer(db, staffActor(req), id, parseBody(serverInput, req.body)));
  });
  router.post("/servers/:id/archive", async (req, res) => {
    res.json(await archiveServer(db, staffActor(req), parseId(req.params.id)));
  });

  return router;
};
