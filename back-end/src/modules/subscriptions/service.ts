import { randomBytes } from "node:crypto";

import type {
  CustomerDetail,
  CustomerSummary,
  SubscriptionEventView,
  SubscriptionStatus,
  SubscriptionView,
} from "@shah-kelid/contracts";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { writeAudit } from "../access/audit";
import { planPanelSettings, plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { base32Encode } from "../identity/totp";
import { locations, panels, servers } from "../infrastructure/schema";
import type { PanelUser } from "../provisioning/driver";
import { subscriptionEvents, subscriptions } from "./schema";

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
export const linkFor = (accessToken: string, subscriptionBaseUrl: string | null) =>
  `${subscriptionBaseUrl ?? config.provisioning.publicUrl}/s/${accessToken}`;

const newAccessToken = () => randomBytes(24).toString("base64url");

const iso = (date: Date | null) => date?.toISOString() ?? null;

// ---------------------------------------------------------------- reading

const viewColumns = {
  subscription: subscriptions,
  userEmail: users.email,
  planName: plans.name,
  panelName: panels.name,
  subscriptionBaseUrl: panels.subscriptionBaseUrl,
  serverName: servers.name,
  locationName: locations.nameFa,
};

const toView = (row: {
  subscription: SubscriptionRow;
  userEmail: string;
  planName: string;
  panelName: string;
  subscriptionBaseUrl: string | null;
  serverName: string | null;
  locationName: string | null;
}): SubscriptionView => {
  const s = row.subscription;
  return {
    id: s.id,
    userId: s.userId,
    userEmail: row.userEmail,
    plan: { id: s.planId, name: row.planName },
    panel: { id: s.panelId, name: row.panelName },
    server:
      s.serverId && row.serverName
        ? { id: s.serverId, name: row.serverName, locationName: row.locationName ?? "" }
        : null,
    status: s.status,
    dataLimitBytes: s.dataLimitBytes,
    usedBytes: s.usedBytes,
    lifetimeUsedBytes: s.lifetimeUsedBytes,
    deviceLimit: s.deviceLimit,
    expiresAt: iso(s.expiresAt),
    startsOnFirstUse: s.startsOnFirstUse,
    onlineAt: iso(s.onlineAt),
    lastSyncedAt: iso(s.lastSyncedAt),
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
    .innerJoin(panels, eq(panels.id, subscriptions.panelId))
    .leftJoin(servers, eq(servers.id, subscriptions.serverId))
    .leftJoin(locations, eq(locations.id, servers.locationId));

export const findSubscriptionView = async (executor: Executor, id: string) => {
  const [row] = await viewQuery(executor).where(eq(subscriptions.id, id));
  if (!row) throw notFound("No such subscription");
  return toView(row);
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
  return rows.map(toView);
};

export const subscriptionHistory = async (db: Db, id: string): Promise<SubscriptionEventView[]> => {
  const rows = await db
    .select({ event: subscriptionEvents, actorEmail: users.email })
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

// --------------------------------------------------------------- customers

// Written out with table names: interpolated columns lose their table inside
// a subquery, and "id" would then mean the subscription's id.
const liveSubscriptionCount = sql<number>`(
  select count(*)::int from subscriptions x
  where x.user_id = "users"."id"
    and x.status in ('provisioning', 'on_hold', 'active', 'limited')
)`;

const customerSummary = (row: {
  user: typeof users.$inferSelect;
  live: number;
}): CustomerSummary => ({
  id: row.user.id,
  email: row.user.email,
  displayName: row.user.displayName,
  status: row.user.status,
  createdAt: row.user.createdAt.toISOString(),
  lastLoginAt: iso(row.user.lastLoginAt),
  liveSubscriptions: Number(row.live),
});

export const listCustomers = async (
  db: Db,
  { search, limit, offset }: { search?: string; limit: number; offset: number },
) => {
  const term = search?.trim();
  const rows = await db
    .select({ user: users, live: liveSubscriptionCount })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        term ? or(ilike(users.email, `%${term}%`), ilike(users.displayName, `%${term}%`)) : undefined,
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(customerSummary);
};

export const customerDetail = async (db: Db, id: string): Promise<CustomerDetail> => {
  const [row] = await db
    .select({ user: users, live: liveSubscriptionCount })
    .from(users)
    .where(eq(users.id, id));
  if (!row) throw notFound("No such customer");
  return {
    ...customerSummary(row),
    subscriptions: await listSubscriptions(db, { userId: id, limit: 100, offset: 0 }),
  };
};

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

type Placement = { serverId: string; panelId: string; live: number; capacity: number };

/**
 * The server a new subscription goes on: one on a panel that sells this
 * plan, taking customers, online, with room; highest priority first, then
 * the emptiest.
 *
 * The candidate servers are locked, so two purchases at the same moment
 * cannot both take the last place on a server.
 */
const placeOn = async (executor: Executor, planId: string): Promise<Placement> => {
  const candidates = await executor.execute<{
    id: string;
    panel_id: string;
    priority: number;
    capacity_users: number;
    live: number;
  }>(sql`
    select s.id, s.panel_id, s.priority, s.capacity_users,
      (select count(*)::int from subscriptions x
        where x.server_id = s.id
          and x.status in ('provisioning', 'on_hold', 'active', 'limited')) as live
    from servers s
    join plan_panel_settings pps on pps.panel_id = s.panel_id and pps.plan_id = ${planId}
    join panels p on p.id = s.panel_id and p.is_active
    where s.accepting_new and s.status = 'online' and s.archived_at is null
    for update of s
  `);

  const [chosen] = candidates.rows
    .filter((server) => server.live < server.capacity_users)
    .sort(
      (a, b) =>
        b.priority - a.priority || a.live / a.capacity_users - b.live / b.capacity_users,
    );
  if (!chosen) {
    throw new ApiError(409, "NO_SERVER_AVAILABLE", "No server that sells this plan has room");
  }
  return {
    serverId: chosen.id,
    panelId: chosen.panel_id,
    live: chosen.live,
    capacity: chosen.capacity_users,
  };
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

  const place = await placeOn(executor, planId);

  // The id is taken first: the panel username is made from it.
  const minted = await executor.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = minted.rows[0]!.id;

  await executor.insert(subscriptions).values({
    id,
    userId,
    planId,
    panelId: place.panelId,
    serverId: place.serverId,
    panelUsername: panelUsernameFor(id),
    status: "provisioning",
    isTrial: plan.isTrial,
    dataLimitBytes: plan.dataLimitBytes,
    deviceLimit: plan.deviceLimit,
    startsOnFirstUse: true,
    accessToken: newAccessToken(),
  });

  await recordHistory(executor, id, "created", actor, { planId, serverId: place.serverId }, orderId);
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
      after: { userId, planId, serverId: place.serverId },
    });
  }
  return id;
};

/** The groups a subscription's panel user gets: its server's, and the plan's extras on that panel. */
export const groupsFor = async (executor: Executor, subscription: SubscriptionRow) => {
  const [setting] = await executor
    .select({ groupIds: planPanelSettings.groupIds })
    .from(planPanelSettings)
    .where(
      and(
        eq(planPanelSettings.planId, subscription.planId),
        eq(planPanelSettings.panelId, subscription.panelId),
      ),
    );
  const [server] = subscription.serverId
    ? await executor
        .select({ groupId: servers.panelGroupId })
        .from(servers)
        .where(eq(servers.id, subscription.serverId))
    : [];
  const groups = new Set<number>(setting?.groupIds ?? []);
  if (server?.groupId) groups.add(server.groupId);
  return [...groups].sort((a, b) => a - b);
};
