import { randomBytes } from "node:crypto";

import type {
  SubscriptionEventView,
  SubscriptionStatus,
  SubscriptionView,
} from "@shah-kelid/contracts";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { writeAudit } from "../access/audit";
import { subscriptionBase } from "../infrastructure/domains";
import { plans } from "../catalog/schema";
import { groupIdsOfPlan, panelsOfGroups } from "../groups/service";
import { groups } from "../groups/schema";
import { accountLabel, optionalAccountLabel, users } from "../identity/schema";
import { base32Encode } from "../identity/totp";
import { panels } from "../infrastructure/schema";
import type { PanelUser } from "../provisioning/driver";
import { subscriptionEvents, subscriptionGroups, subscriptionPanels, subscriptions } from "./schema";

/**
 * Subscriptions: made here, put on a panel by the worker (provisioning.ts),
 * kept in step with the panel by the sync (sync.ts).
 *
 * Making one is a single transaction: the row, its history, the audit entry
 * and the outbox event that asks for it to be put on the panel. The request
 * returns at once; the worker does the slow part and retries it.
 */

export const PROVISION_TOPIC = "subscription.provision_requested";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * The username on the panel: fixed by the subscription id, never random.
 * A retried provisioning finds the user a lost attempt made, by this name.
 * "sk_" and 26 base32 characters: within every panel's username rules.
 */
export const panelUsernameFor = (subscriptionId: string) =>
  `sk_${base32Encode(Buffer.from(subscriptionId.replaceAll("-", ""), "hex")).toLowerCase()}`;

/** The customer's link: on our domain, so the panel can move without the link changing. */
/** A customer's link: on its panel's subscription domain, else the shop's, else the site's address. */
export const linkFor = (accessToken: string, subscriptionBaseUrl: string | null) =>
  `${subscriptionBaseUrl ?? subscriptionBase() ?? config.provisioning.publicUrl}/s/${accessToken}`;

const newAccessToken = () => randomBytes(24).toString("base64url");

const iso = (date: Date | null) => date?.toISOString() ?? null;

// ---------------------------------------------------------------- reading

/**
 * When a subscription's usage was last read. The panel service writes a row
 * only when something in it changed, not "checked just now" every few
 * minutes; so a subscription on its panel was read at least as recently
 * as its panel was.
 */
export const checkedAt = (
  row: { status: string; panelUserId: number | null; lastSyncedAt: Date | null },
  panelLastOkAt: Date | null,
) => {
  const onPanel = row.panelUserId !== null && ["on_hold", "active", "limited", "expired", "disabled"].includes(row.status);
  const read = onPanel ? panelLastOkAt : null;
  if (!row.lastSyncedAt) return read;
  if (!read) return row.lastSyncedAt;
  return read > row.lastSyncedAt ? read : row.lastSyncedAt;
};

const viewColumns = {
  subscription: subscriptions,
  panelLastOkAt: panels.lastOkAt,
  userEmail: accountLabel(),
  planName: plans.name,
  panelName: panels.name,
  subscriptionBaseUrl: panels.subscriptionBaseUrl,
};

type PanelsOf = Map<string, Pick<SubscriptionView, "panels" | "groups">>;

/** Each subscription's panels, in one query for the whole list. */
const panelsOf = async (executor: Executor, ids: string[]): Promise<PanelsOf> => {
  const byId: PanelsOf = new Map();
  if (ids.length === 0) return byId;
  const rows = await executor
    .select({ member: subscriptionPanels, panelName: panels.name, panelLastOkAt: panels.lastOkAt })
    .from(subscriptionPanels)
    .innerJoin(panels, eq(panels.id, subscriptionPanels.panelId))
    .where(inArray(subscriptionPanels.subscriptionId, ids))
    .orderBy(asc(subscriptionPanels.createdAt), asc(panels.name));
  const carried = await executor
    .select({ subscriptionId: subscriptionGroups.subscriptionId, id: groups.id, name: groups.name })
    .from(subscriptionGroups)
    .innerJoin(groups, eq(groups.id, subscriptionGroups.groupId))
    .where(inArray(subscriptionGroups.subscriptionId, ids))
    .orderBy(asc(groups.sortOrder), asc(groups.name));
  for (const id of ids) {
    byId.set(id, {
      panels: [],
      groups: carried.filter((row) => row.subscriptionId === id).map(({ id: groupId, name }) => ({ id: groupId, name })),
    });
  }
  for (const { member, panelName, panelLastOkAt } of rows) {
    byId.get(member.subscriptionId)!.panels.push({
      id: member.panelId,
      name: panelName,
      onPanel: member.panelUserId !== null,
      status: member.panelStatus,
      usedBytes: member.usedBytes,
      lastSyncedAt: iso(
        member.panelUserId !== null && panelLastOkAt && (!member.lastSyncedAt || panelLastOkAt > member.lastSyncedAt)
          ? panelLastOkAt
          : member.lastSyncedAt,
      ),
      lastError: member.lastError,
    });
  }
  return byId;
};

const toView = (row: {
  subscription: SubscriptionRow;
  panelLastOkAt: Date | null;
  userEmail: string;
  planName: string;
  panelName: string;
  subscriptionBaseUrl: string | null;
}, on: PanelsOf): SubscriptionView => {
  const s = row.subscription;
  return {
    id: s.id,
    userId: s.userId,
    userEmail: row.userEmail,
    plan: { id: s.planId, name: row.planName },
    panel: { id: s.panelId, name: row.panelName },
    panels: on.get(s.id)?.panels ?? [],
    groups: on.get(s.id)?.groups ?? [],
    status: s.status,
    dataLimitBytes: s.dataLimitBytes,
    usedBytes: s.usedBytes,
    lifetimeUsedBytes: s.lifetimeUsedBytes,
    deviceLimit: s.deviceLimit,
    expiresAt: iso(s.expiresAt),
    startsOnFirstUse: s.startsOnFirstUse,
    onlineAt: iso(s.onlineAt),
    lastSyncedAt: iso(checkedAt(s, row.panelLastOkAt)),
    link: linkFor(s.accessToken, row.subscriptionBaseUrl),
    provisionedAt: iso(s.provisionedAt),
    lastError: s.lastError,
    createdAt: s.createdAt.toISOString(),
  };
};

const viewQuery = (executor: Executor) =>
  executor
    .select(viewColumns)
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(panels, eq(panels.id, subscriptions.panelId));

export const findSubscriptionView = async (executor: Executor, id: string) => {
  const [row] = await viewQuery(executor).where(eq(subscriptions.id, id));
  if (!row) throw notFound("No such subscription");
  return toView(row, await panelsOf(executor, [id]));
};

export const listSubscriptions = async (
  db: Db,
  filter: { status?: SubscriptionStatus; userId?: string; limit: number; offset: number },
) => {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(subscriptions.status, filter.status));
  if (filter.userId) conditions.push(eq(subscriptions.userId, filter.userId));
  const rows = await viewQuery(db)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(subscriptions.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const on = await panelsOf(db, rows.map((row) => row.subscription.id));
  return rows.map((row) => toView(row, on));
};

export const subscriptionHistory = async (db: Db, id: string): Promise<SubscriptionEventView[]> => {
  const rows = await db
    .select({ event: subscriptionEvents, actorEmail: optionalAccountLabel(users) })
    .from(subscriptionEvents)
    .leftJoin(users, eq(users.id, subscriptionEvents.actorUserId))
    .where(eq(subscriptionEvents.subscriptionId, id))
    .orderBy(desc(subscriptionEvents.id))
    .limit(200);
  return rows.map(({ event, actorEmail }) => ({
    id: event.id,
    kind: event.kind,
    actorKind: event.actorKind,
    actorEmail: actorEmail ?? null,
    details: event.details as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  }));
};

// Customers, with their CRM facts, are listed by src/modules/crm.

// ---------------------------------------------------------------- history

export const recordHistory = (
  executor: Executor,
  subscriptionId: string,
  kind: string,
  actor: StaffActor | "system",
  details: Record<string, unknown> = {},
  orderId?: string,
) =>
  executor.insert(subscriptionEvents).values({
    subscriptionId,
    kind,
    actorKind: actor === "system" ? "system" : "staff",
    actorUserId: actor === "system" ? null : actor.userId,
    orderId: orderId ?? null,
    details,
  });

// ------------------------------------------------------- the panel's copy

/** Our status for the panel's. Ours alone ("deleted", "provisioning…") stay ours. */
const STATUS_FROM_PANEL: Record<PanelUser["status"], SubscriptionStatus> = {
  active: "active",
  on_hold: "on_hold",
  disabled: "disabled",
  limited: "limited",
  expired: "expired",
};

/** What the panel says about a user, as the columns to update. */
export const fromPanel = (user: PanelUser) => ({
  panelUserId: user.id,
  status: STATUS_FROM_PANEL[user.status],
  dataLimitBytes: user.dataLimitBytes,
  deviceLimit: user.deviceLimit,
  usedBytes: user.usedBytes,
  lifetimeUsedBytes: Math.max(user.lifetimeUsedBytes, user.usedBytes),
  expiresAt: user.expiresAt,
  onHoldDurationSeconds: user.onHoldDurationSeconds,
  onlineAt: user.onlineAt,
  panelSubscriptionUrl: user.subscriptionUrl,
  lastSyncedAt: new Date(),
  lastError: null,
});

// ------------------------------------------------------------------ making

/**
 * Why a plan cannot be sold, in words an operator can act on. Only asked once
 * placing has failed, so the sale path stays short.
 */
const whyNoPanel = async (executor: Executor, planId: string) => {
  const { rows } = await executor.execute<{ groups: number; sources: number; active: number }>(sql`
    select
      count(distinct pg.group_id)::int as groups,
      count(gs.panel_id)::int as sources,
      count(gs.panel_id) filter (where p.is_active)::int as active
    from plan_groups pg
    left join group_sources gs on gs.group_id = pg.group_id
    left join panels p on p.id = gs.panel_id
    where pg.plan_id = ${planId}
  `);
  const counts = rows[0] ?? { groups: 0, sources: 0, active: 0 };
  if (counts.groups === 0) return "This plan has no group. Edit the plan and choose its groups.";
  if (counts.sources === 0) return "The plan's groups take nothing from any panel. Add a panel's group to them under Groups.";
  return "Every panel the plan's groups take from is switched off. Turn one on under Panels.";
};

/**
 * Makes a subscription for a customer from a plan, and asks for it to be put
 * on the panel. Staff use this now; checkout (M4) calls it after payment,
 * inside the payment's own transaction.
 */
export const createSubscription = async (
  executor: Executor,
  actor: StaffActor | "system",
  {
    userId,
    planId,
    orderId,
  }: {
    userId: string;
    planId: string;
    /** A paid order: its plan is made even if it has since gone off sale. */
    orderId?: string;
  },
): Promise<string> => {
  const [customer] = await executor
    .select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!customer || customer.deletedAt) throw notFound("No such customer");
  if (customer.status !== "active") {
    throw new ApiError(409, "CONFLICT", "That customer's account is not active");
  }

  const [plan] = await executor.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw notFound("No such plan");
  if (!orderId && (plan.archivedAt || !plan.isActive)) throw notFound("No such plan on sale");

  // The panels its groups take from, in the groups' order: the first is the
  // subscription's main panel.
  const groupIds = await groupIdsOfPlan(executor, planId);
  const places = await panelsOfGroups(executor, groupIds);
  if (places.length === 0) throw new ApiError(409, "NO_SERVER_AVAILABLE", await whyNoPanel(executor, planId));
  const place = places[0]!;

  // The id is taken first: the panel username is made from it.
  const minted = await executor.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = minted.rows[0]!.id;

  await executor.insert(subscriptions).values({
    id,
    userId,
    planId,
    panelId: place.panelId,
    panelUsername: panelUsernameFor(id),
    status: "provisioning",
    isTrial: plan.isTrial,
    dataLimitBytes: plan.dataLimitBytes,
    deviceLimit: plan.deviceLimit,
    startsOnFirstUse: true,
    accessToken: newAccessToken(),
  });
  await executor.insert(subscriptionPanels).values(
    places.map((each) => ({
      subscriptionId: id,
      panelId: each.panelId,
      groupIds: each.panelGroupIds,
      dataLimitBytes: plan.dataLimitBytes,
    })),
  );
  await executor.insert(subscriptionGroups).values(groupIds.map((groupId) => ({ subscriptionId: id, groupId })));

  await recordHistory(executor, id, "created", actor, { planId, groupIds, panels: places.length }, orderId);
  await recordEvent(executor, {
    topic: PROVISION_TOPIC,
    aggregateType: "subscription",
    aggregateId: id,
  });
  if (actor !== "system") {
    await writeAudit(executor, {
      ...auditBy(actor),
      action: "subscription.created",
      entityType: "subscription",
      entityId: id,
      after: { userId, planId, groupIds },
    });
  }
  return id;
};

