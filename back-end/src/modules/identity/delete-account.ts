import { randomUUID } from "node:crypto";

import { and, eq, notInArray } from "drizzle-orm";

import type { Db } from "../../platform/db/client";
import type { StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { writeAudit } from "../access/audit";
import { userRoles } from "../access/schema";
import { customerNotes, customerProfiles, customerTags } from "../crm/schema";
import { notifications } from "../notifications/schema";
import { recordHistory } from "../subscriptions/service";
import { subscriptions } from "../subscriptions/schema";
import { userRecoveryCodes, users } from "./schema";

/**
 * Deleting an account: by its owner from /account, or by staff.
 *
 * What identifies the person goes: the email (replaced by one that cannot
 * receive mail), the name, the password, the authenticator, the recovery
 * codes, staff's notes and tags. What the books need stays: orders,
 * payments and invoices keep pointing at the (now anonymous) account, as
 * the law and the ledger require.
 *
 * Their services stop too. One not yet on a panel is marked deleted here;
 * one on a panel is removed from it by the worker (an outbox event), so a
 * panel that is down delays the removal but never loses it.
 */

export const SUBSCRIPTION_REMOVE_TOPIC = "subscription.remove_requested";

const NOT_YET_ON_PANEL = ["provisioning", "provisioning_failed"] as const;

export const deleteAccount = async (db: Db, userId: string, by: "self" | StaffActor) =>
  db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.status === "deleted") throw notFound("No such account");

    const [role] = await tx.select().from(userRoles).where(eq(userRoles.userId, userId)).limit(1);
    if (role) {
      throw new ApiError(409, "CONFLICT", "A member of staff is removed from the team before their account is deleted");
    }

    const actor = by === "self" ? "system" : by;
    const services = await tx
      .select({ id: subscriptions.id, status: subscriptions.status })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), notInArray(subscriptions.status, ["deleted"])));
    for (const service of services) {
      if ((NOT_YET_ON_PANEL as readonly string[]).includes(service.status)) {
        await tx.update(subscriptions).set({ status: "deleted", lastError: null }).where(eq(subscriptions.id, service.id));
        await recordHistory(tx, service.id, "account_deleted", actor);
      } else {
        await recordEvent(tx, {
          topic: SUBSCRIPTION_REMOVE_TOPIC,
          aggregateType: "subscription",
          aggregateId: service.id,
        });
      }
    }

    const gone = `deleted-${randomUUID()}@deleted.invalid`;
    await tx
      .update(users)
      .set({
        email: gone,
        username: null,
        emailNormalized: gone,
        displayName: "",
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        telegramUserId: null,
        telegramUsername: null,
        avatarFileId: null,
        status: "deleted",
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await tx.delete(customerNotes).where(eq(customerNotes.userId, userId));
    await tx.delete(customerTags).where(eq(customerTags.userId, userId));
    await tx.delete(customerProfiles).where(eq(customerProfiles.userId, userId));
    await tx.update(notifications).set({ recipient: gone }).where(eq(notifications.userId, userId));

    await writeAudit(tx, {
      ...(by === "self"
        ? { actorKind: "customer" as const, actorUserId: userId }
        : { actorKind: "staff" as const, actorUserId: by.userId, ...by.request }),
      action: "account.deleted",
      entityType: "user",
      entityId: userId,
      // Not the address: the log would otherwise keep what deletion removed.
      after: { services: services.length },
    });
    return { services: services.length };
  });

/** A customer's account is suspended (cannot sign in) or restored; staff accounts are not. */
export const setAccountStatus = async (db: Db, actor: StaffActor, userId: string, status: "active" | "suspended") =>
  db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.status === "deleted") throw notFound("No such account");
    const [role] = await tx.select().from(userRoles).where(eq(userRoles.userId, userId)).limit(1);
    if (role) throw new ApiError(409, "CONFLICT", "Staff accounts are managed on the team page");
    if (user.status === status) return;
    await tx.update(users).set({ status }).where(eq(users.id, userId));
    await writeAudit(tx, {
      actorKind: "staff",
      actorUserId: actor.userId,
      ...actor.request,
      action: status === "suspended" ? "account.suspended" : "account.restored",
      entityType: "user",
      entityId: userId,
      before: { status: user.status },
      after: { status },
    });
  });

