import { randomBytes } from "node:crypto";

import type { SubscriptionAction } from "@shah-kelid/contracts";
import { eq } from "drizzle-orm";

import type { Db } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { writeAudit } from "../access/audit";
import { findPanel, panelFailure } from "../infrastructure/service";
import type { PanelUser } from "../provisioning/driver";
import { driverFor } from "../provisioning/drivers";
import { syncSubscription } from "../provisioning/sync";
import { subscriptions } from "./schema";
import {
  PROVISION_TOPIC,
  findSubscriptionView,
  fromPanel,
  recordHistory,
  type SubscriptionRow,
} from "./service";

/**
 * What staff can do to a subscription.
 *
 * The panel is asked first. Only when it has done the thing is our copy
 * changed, with the history and audit entries in the same transaction; a
 * panel that is down or says no changes nothing here.
 */

const NOT_ON_PANEL = new Set(["provisioning", "provisioning_failed", "deleted"]);

const load = async (db: Db, id: string) => {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!row) throw notFound("No such subscription");
  return row;
};

const onPanel = (row: SubscriptionRow) => {
  if (NOT_ON_PANEL.has(row.status)) {
    throw new ApiError(409, "NOT_PROVISIONED", `The subscription is ${row.status}`);
  }
};

/** Runs one panel call, as an API error when the panel fails. */
const ask = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw panelFailure(error);
  }
};

const record = async (
  db: Db,
  actor: StaffActor,
  before: SubscriptionRow,
  action: SubscriptionAction,
  change: Partial<typeof subscriptions.$inferInsert>,
) => {
  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set(change).where(eq(subscriptions.id, before.id));
    await recordHistory(tx, before.id, action, actor);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: `subscription.${action}`,
      entityType: "subscription",
      entityId: before.id,
      before: { status: before.status, usedBytes: before.usedBytes },
      after: { status: change.status ?? before.status, usedBytes: change.usedBytes ?? before.usedBytes },
    });
  });
};

/**
 * Takes a service off its panel for good, after its owner's account was
 * deleted (an outbox job, so it is retried while the panel is down).
 */
export const removeFromPanel = async (db: Db, id: string) => {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!row || row.status === "deleted") return "not_needed";
  if (!NOT_ON_PANEL.has(row.status)) {
    await driverFor(await findPanel(db, row.panelId)).deleteUser(row.panelUsername);
  }
  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ status: "deleted", lastError: null }).where(eq(subscriptions.id, id));
    await recordHistory(tx, id, "account_deleted", "system");
  });
  return "removed";
};

export const performAction = async (
  db: Db,
  actor: StaffActor,
  id: string,
  action: SubscriptionAction,
) => {
  const row = await load(db, id);

  if (action === "retry") {
    if (row.status !== "provisioning_failed") {
      throw new ApiError(409, "CONFLICT", "Only a subscription that failed to be made can be retried");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({ status: "provisioning", lastError: null })
        .where(eq(subscriptions.id, id));
      await recordHistory(tx, id, "retry", actor);
      await recordEvent(tx, { topic: PROVISION_TOPIC, aggregateType: "subscription", aggregateId: id });
      await writeAudit(tx, {
        ...auditBy(actor),
        action: "subscription.retry",
        entityType: "subscription",
        entityId: id,
        before: { status: row.status },
        after: { status: "provisioning" },
      });
    });
    return findSubscriptionView(db, id);
  }

  onPanel(row);
  const driver = driverFor(await findPanel(db, row.panelId));
  const username = row.panelUsername;
  let user: PanelUser;

  switch (action) {
    case "sync":
      await ask(() => syncSubscription(db, row));
      return findSubscriptionView(db, id);

    case "reset_usage":
      user = await ask(() => driver.resetUsage(username));
      await record(db, actor, row, action, fromPanel(user));
      break;

    case "revoke_link":
      // The panel's link changes, and so does ours: the old /s/ link stops working.
      user = await ask(() => driver.revokeSubscription(username));
      await record(db, actor, row, action, {
        ...fromPanel(user),
        accessToken: randomBytes(24).toString("base64url"),
      });
      break;

    case "disable":
    case "enable":
      user = await ask(() => driver.setEnabled(username, action === "enable"));
      await record(db, actor, row, action, fromPanel(user));
      break;

    case "delete":
      await ask(() => driver.deleteUser(username));
      await record(db, actor, row, action, { status: "deleted", lastError: null });
      break;
  }
  return findSubscriptionView(db, id);
};
