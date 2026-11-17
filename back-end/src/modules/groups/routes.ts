import {
  groupHostInput,
  groupInput,
  groupOrderInput,
  groupSourcesInput,
  hostOrderInput,
} from "@shah-kelid/contracts";
import { Router, type Request } from "express";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError } from "../../platform/http/api-error";
import { parseBody, parseId } from "../../platform/http/validate";
import {
  createGroup,
  deleteGroup,
  findGroup,
  groupHostsOf,
  listGroups,
  orderGroups,
  orderHosts,
  renameGroup,
  setSources,
  updateHost,
} from "./service";

/**
 * /api/v1/staff/groups: our groups. All need servers:manage.
 *
 *   GET    /groups                      every group, in order
 *   POST   /groups                      a new one { name }
 *   PUT    /groups/order                { ids } as dragged
 *   GET    /groups/:id                  PUT { name }        DELETE
 *   PUT    /groups/:id/sources          { sources: [{ panelId, panelGroupId, allHosts }] }
 *   GET    /groups/:id/hosts            its hosts, read from the panels now
 *   PUT    /groups/:id/hosts/order      { hosts: [{ panelId, hostId }] } as dragged
 *   PATCH  /groups/:id/hosts/:panelId/:hostId   { selected?, name? }
 */

const hostIdOf = (req: Request) => {
  const parsed = z.coerce.number().int().min(0).max(2_147_483_647).safeParse(req.params.hostId);
  if (!parsed.success) throw new ApiError(404, "NOT_FOUND", "No such host");
  return parsed.data;
};

export const groupsRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use("/groups", requirePermission("servers:manage"));

  router.get("/groups", async (_req, res) => {
    res.json(await listGroups(db));
  });
  router.post("/groups", async (req, res) => {
    res.status(201).json(await createGroup(db, staffActor(req), parseBody(groupInput, req.body)));
  });
  // Before /groups/:id, which would read "order" as an id.
  router.put("/groups/order", async (req, res) => {
    res.json(await orderGroups(db, staffActor(req), parseBody(groupOrderInput, req.body)));
  });
  router.get("/groups/:id", async (req, res) => {
    res.json(await findGroup(db, parseId(req.params.id)));
  });
  router.put("/groups/:id", async (req, res) => {
    res.json(await renameGroup(db, staffActor(req), parseId(req.params.id), parseBody(groupInput, req.body)));
  });
  router.delete("/groups/:id", async (req, res) => {
    await deleteGroup(db, staffActor(req), parseId(req.params.id));
    res.status(204).end();
  });
  router.put("/groups/:id/sources", async (req, res) => {
    res.json(await setSources(db, staffActor(req), parseId(req.params.id), parseBody(groupSourcesInput, req.body)));
  });
  router.get("/groups/:id/hosts", async (req, res) => {
    res.json(await groupHostsOf(db, parseId(req.params.id)));
  });
  router.put("/groups/:id/hosts/order", async (req, res) => {
    res.json(await orderHosts(db, staffActor(req), parseId(req.params.id), parseBody(hostOrderInput, req.body)));
  });
  router.patch("/groups/:id/hosts/:panelId/:hostId", async (req, res) => {
    res.json(
      await updateHost(
        db,
        staffActor(req),
        parseId(req.params.id),
        parseId(req.params.panelId),
        hostIdOf(req),
        parseBody(groupHostInput, req.body),
      ),
    );
  });

  return router;
};
