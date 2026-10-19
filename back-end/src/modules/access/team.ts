import type { AuditEntryView, TeamMember } from "@shah-kelid/contracts";
import { and, desc, eq, isNull, lt, type SQL } from "drizzle-orm";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { createVerifiedAccount, findUserByEmail } from "../identity/service";
import { users } from "../identity/schema";
import { sendEmail } from "../notifications/email";
import { grantRole, type Actor } from "./roles";
import { auditLogs, roles, userRoles } from "./schema";

/**
 * The team page: everyone holding a role, and adding someone by email.
 *
 * A new member is emailed where to sign in. They sign in like anyone else
 * (a code by email), and a role that requires it makes them set up an
 * authenticator before they can open anything.
 */

export const teamMembers = async (db: Db): Promise<TeamMember[]> => {
  const rows = await db
    .select({ user: users, roleKey: roles.key })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(isNull(users.deletedAt))
    .orderBy(users.email, roles.key);
  const members = new Map<string, TeamMember>();
  for (const { user, roleKey } of rows) {
    const member = members.get(user.id) ?? {
      id: user.id,
      email: user.email ?? user.username ?? "",
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roles: [],
      twoFactorEnabled: user.totpEnabledAt !== null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
    member.roles.push(roleKey);
    members.set(user.id, member);
  }
  return [...members.values()];
};

export const addTeamMember = async (db: Db, actor: Actor, email: string, roleKey: string) => {
  const account = (await findUserByEmail(db, email)) ?? (await createVerifiedAccount(db, email));
  // grantRole checks the role exists and that this actor may give it.
  const before = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, account.id));
  const after = await grantRole(db, actor, account.id, roleKey);
  if (after.length > before.length) {
    await sendEmail({
      to: email,
      subject: "دسترسی کارمندی شاه‌کلید",
      text: [
        "شما به تیم شاه‌کلید اضافه شدید.",
        `برای ورود، ایمیل خود را اینجا وارد کنید و کدی را که می‌رسد بزنید: ${config.cors.origin}/account/sign-in`,
        "بعد از ورود، از شما خواسته می‌شود ورود دومرحله‌ای (Google Authenticator یا مشابه) را راه‌اندازی کنید.",
      ].join("\n\n"),
    });
  }
  return account.id;
};

export const auditEntries = async (
  db: Db,
  filters: { entityType?: string; entityId?: string; actorUserId?: string; before?: number; limit: number },
) => {
  const where: SQL[] = [];
  if (filters.entityType) where.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.entityId) where.push(eq(auditLogs.entityId, filters.entityId));
  if (filters.actorUserId) where.push(eq(auditLogs.actorUserId, filters.actorUserId));
  if (filters.before) where.push(lt(auditLogs.id, filters.before));
  const rows = await db
    .select({ entry: auditLogs, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(filters.limit);
  const entries = rows.map(
    ({ entry, actorEmail }): AuditEntryView => ({
      id: entry.id,
      occurredAt: entry.occurredAt.toISOString(),
      actorKind: entry.actorKind,
      actorUserId: entry.actorUserId,
      actorEmail,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
    }),
  );
  return { entries, nextBefore: entries.length === filters.limit ? entries.at(-1)!.id : null };
};
