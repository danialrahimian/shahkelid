import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db, Executor } from "../../platform/db/client";
import { ApiError, forbidden, notFound } from "../../platform/http/api-error";
import { users } from "../identity/schema";
import { writeAudit, type AuditEntry } from "./audit";
import { isPermission, SYSTEM_ROLES, type Permission } from "./permissions";
import { rolePermissions, roles, userRoles } from "./schema";

/**
 * Makes the stored system roles match SYSTEM_ROLES exactly.
 *
 * Runs on every start. Idempotent, and in one transaction, so a crash half way
 * leaves the roles as they were rather than half-updated.
 */
export const syncSystemRoles = async (db: Db) => {
  await db.transaction(async (tx) => {
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      const [row] = await tx
        .insert(roles)
        .values({ key, name: role.name, description: role.description, isSystem: true })
        .onConflictDoUpdate({
          target: roles.key,
          set: { name: role.name, description: role.description, isSystem: true },
        })
        .returning({ id: roles.id });

      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, row!.id));
      if (role.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(role.permissions.map((permission) => ({ roleId: row!.id, permission })));
      }
    }
  });
};

export type AccessProfile = {
  roles: string[];
  permissions: Set<Permission>;
  /** Any of the roles demands a second factor. Every staff role does. */
  requiresTwoFactor: boolean;
};

/** What a user may do: the union of their roles' permissions. */
export const accessOf = async (executor: Executor, userId: string): Promise<AccessProfile> => {
  const rows = await executor
    .select({
      key: roles.key,
      requires2fa: roles.requires2fa,
      permission: rolePermissions.permission,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const permissions = new Set<Permission>();
  for (const row of rows) {
    if (row.permission && isPermission(row.permission)) permissions.add(row.permission);
  }

  return {
    roles: [...new Set(rows.map((row) => row.key))].sort(),
    permissions,
    requiresTwoFactor: rows.some((row) => row.requires2fa),
  };
};

const roleByKey = async (executor: Executor, key: string) => {
  const [role] = await executor.select().from(roles).where(eq(roles.key, key));
  if (!role) throw notFound(`No role "${key}"`);

  const granted = await executor
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, role.id));

  return { ...role, permissions: granted.map((row) => row.permission) };
};

export type Actor = {
  userId: string;
  permissions: Set<Permission>;
  roles: string[];
  request?: Pick<AuditEntry, "ip" | "userAgent" | "requestId">;
};

/**
 * The rules for changing someone's roles. They hold whatever the UI offers:
 *
 * - Only someone with users:manage_roles changes roles at all.
 * - Nobody grants a role carrying permissions they do not have themselves,
 *   so a role manager cannot make anyone more powerful than they are.
 * - Only an owner grants or removes the owner role.
 * - The last owner cannot be removed, so the store always has someone who can
 *   manage everything.
 */
const assertMayChange = (actor: Actor, role: { key: string; permissions: string[] }) => {
  if (!actor.permissions.has("users:manage_roles")) {
    throw forbidden("Changing roles needs users:manage_roles");
  }
  if (role.key === "owner" && !actor.roles.includes("owner")) {
    throw forbidden("Only an owner can give or take away the owner role");
  }
  const beyond = role.permissions.filter((p) => !isPermission(p) || !actor.permissions.has(p));
  if (beyond.length > 0) {
    throw forbidden(`That role grants permissions you do not have: ${beyond.join(", ")}`);
  }
};

export const rolesOf = async (executor: Executor, userId: string) =>
  (
    await executor
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
  )
    .map((row) => row.key)
    .sort();

export const grantRole = async (db: Db, actor: Actor, userId: string, roleKey: string) =>
  db.transaction(async (tx) => {
    const role = await roleByKey(tx, roleKey);
    assertMayChange(actor, role);

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw notFound("No such account");

    const before = await rolesOf(tx, userId);
    if (before.includes(roleKey)) return before; // already has it: nothing to log

    await tx.insert(userRoles).values({ userId, roleId: role.id, grantedBy: actor.userId });
    const after = await rolesOf(tx, userId);

    await writeAudit(tx, {
      actorKind: "staff",
      actorUserId: actor.userId,
      action: "access.role_granted",
      entityType: "user",
      entityId: userId,
      before: { roles: before },
      after: { roles: after },
      ...actor.request,
    });
    return after;
  });

export const revokeRole = async (db: Db, actor: Actor, userId: string, roleKey: string) =>
  db.transaction(async (tx) => {
    const role = await roleByKey(tx, roleKey);
    assertMayChange(actor, role);

    const before = await rolesOf(tx, userId);
    if (!before.includes(roleKey)) return before;

    if (roleKey === "owner") {
      // Locked, so two owners removing each other at the same moment cannot
      // both succeed and leave the store with none.
      const owners = await tx.execute<{ user_id: string }>(
        sql`select ur.user_id from user_roles ur join roles r on r.id = ur.role_id
            where r.key = 'owner' for update of ur`,
      );
      if (owners.rows.length <= 1) {
        throw new ApiError(409, "CONFLICT", "The last owner cannot be removed");
      }
    }

    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
    const after = await rolesOf(tx, userId);

    await writeAudit(tx, {
      actorKind: "staff",
      actorUserId: actor.userId,
      action: "access.role_revoked",
      entityType: "user",
      entityId: userId,
      before: { roles: before },
      after: { roles: after },
      ...actor.request,
    });
    return after;
  });

/** Every role with its permissions, for the staff screens. */
export const listRoles = async (executor: Executor) => {
  const all = await executor.select().from(roles).orderBy(roles.key);
  const grants = all.length
    ? await executor
        .select()
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, all.map((role) => role.id)))
    : [];
  return all.map((role) => ({
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    requires2fa: role.requires2fa,
    permissions: grants.filter((g) => g.roleId === role.id).map((g) => g.permission).sort(),
  }));
};
