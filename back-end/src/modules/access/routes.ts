import { addTeamMemberInput } from "@shah-kelid/contracts";
import { Router, type Request } from "express";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { ApiError } from "../../platform/http/api-error";
import { parseBody } from "../../platform/http/validate";
import { accessOf, grantRole, listRoles, revokeRole } from "./roles";
import { PERMISSIONS } from "./permissions";
import { addTeamMember, auditEntries, teamMembers } from "./team";

/**
 * /api/v1/staff: who may do what, and the record of what they did.
 *
 *   GET    /permissions                     every permission there is
 *   GET    /roles                           every role, with its permissions
 *   GET    /users/:userId/access            one person's roles and permissions
 *   POST   /users/:userId/roles/:roleKey    give a role
 *   DELETE /users/:userId/roles/:roleKey    take it away
 *   GET    /team                            everyone holding a role
 *   POST   /team { email, roleKey }         add someone (an account is made if needed)
 *   GET    /audit                           the audit log, newest first, with who did it
 */

const uuid = z.string().uuid();

const auditQuery = z.object({
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(64).optional(),
  actorUserId: uuid.optional(),
  /** Paging: entries older than this id. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const userIdOf = (req: Request) => {
  const result = uuid.safeParse(req.params.userId);
  if (!result.success) throw new ApiError(400, "VALIDATION_FAILED", "Not a valid user id");
  return result.data;
};

export const accessRouter = ({ db }: { db: Db }) => {
  const router = Router();

  const actorOf = (req: Request) => ({
    userId: req.account!.user.id,
    permissions: req.account!.access.permissions,
    roles: req.account!.access.roles,
    request: {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      requestId: (req as { id?: string }).id ?? null,
    },
  });

  router.get("/permissions", requirePermission("users:read"), (_req, res) => {
    res.json(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })));
  });

  router.get("/roles", requirePermission("users:read"), async (_req, res) => {
    res.json(await listRoles(db));
  });

  router.get("/users/:userId/access", requirePermission("users:read"), async (req, res) => {
    const access = await accessOf(db, userIdOf(req));
    res.json({ roles: access.roles, permissions: [...access.permissions].sort() });
  });

  router.post(
    "/users/:userId/roles/:roleKey",
    requirePermission("users:manage_roles"),
    async (req, res) => {
      const roles = await grantRole(db, actorOf(req), userIdOf(req), String(req.params.roleKey));
      res.json({ roles });
    },
  );

  router.delete(
    "/users/:userId/roles/:roleKey",
    requirePermission("users:manage_roles"),
    async (req, res) => {
      const roles = await revokeRole(db, actorOf(req), userIdOf(req), String(req.params.roleKey));
      res.json({ roles });
    },
  );

  router.get("/audit", requirePermission("audit:read"), async (req, res) => {
    const query = auditQuery.safeParse(req.query);
    if (!query.success) throw new ApiError(400, "VALIDATION_FAILED", "Invalid audit filter");
    res.json(await auditEntries(db, query.data));
  });

  router.get("/team", requirePermission("users:read"), async (_req, res) => {
    res.json(await teamMembers(db));
  });

  router.post("/team", requirePermission("users:manage_roles"), async (req, res) => {
    const { email, roleKey } = parseBody(addTeamMemberInput, req.body);
    await addTeamMember(db, actorOf(req), email, roleKey);
    res.status(201).json(await teamMembers(db));
  });

  return router;
};
