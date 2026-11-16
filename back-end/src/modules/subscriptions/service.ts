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
import { planPanelSettings, plans } from "../catalog/schema";
import { accountLabel, optionalAccountLabel, users } from "../identity/schema";
import { base32Encode } from "../identity/totp";
import { locations, panels, servers } from "../infrastructure/schema";
import type { PanelUser } from "../provisioning/driver";
import { subscriptionEvents, subscriptionPanels, subscriptions } from "./schema";

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
  userEmail: accountLabel(),
  planName: plans.name,
  panelName: panels.name,
  subscriptionBaseUrl: panels.subscriptionBaseUrl,
  serverName: servers.name,
  locationName: locations.nameFa,
};

type PanelsOf = Map<string, SubscriptionView["panels"]>;

/** Each subscription's panels, in one query for the whole list. */
const panelsOf = async (executor: Executor, ids: string[]): Promise<PanelsOf> => {
  const byId: PanelsOf = new Map();
  if (ids.length === 0) return byId;
  const rows = await executor
    .select({ member: subscriptionPanels, panelName: panels.name, serverName: servers.name })
    .from(subscriptionPanels)
    .innerJoin(panels, eq(panels.id, subscriptionPanels.panelId))
    .leftJoin(servers, eq(servers.id, subscriptionPanels.serverId))
    .where(inArray(subscriptionPanels.subscriptionId, ids))
    .orderBy(asc(subscriptionPanels.createdAt), asc(panels.name));
  for (const { member, panelName, serverName } of rows) {
    const list = byId.get(member.subscriptionId) ?? [];
    list.push({
      id: member.panelId,
      name: panelName,
      serverName,
      onPanel: member.panelUserId !== null,
      status: member.panelStatus,
      usedBytes: member.usedBytes,
      lastSyncedAt: iso(member.lastSyncedAt),
      lastError: member.lastError,
    });
    byId.set(member.subscriptionId, list);
  }
  return byId;
};

const toView = (row: {
  subscription: SubscriptionRow;
  userEmail: string;
  planName: string;
  panelName: string;
  subscriptionBaseUrl: string | null;
  serverName: string | null;
  locationName: string | null;
}, on: PanelsOf): SubscriptionView => {
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
    panels: on.get(s.id) ?? [],
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

type Placement = { serverId: string; panelId: string; live: number; capacity: number };

/**
 * Why no server can take a plan, in words an operator can act on. Only asked
 * once placing has failed, so the sale path stays one query.
 */
const whyNoServer = async (executor: Executor, planId: string, full: { live: number; capacity: number }[]) => {
  if (full.length > 0) {
    const seats = full.map((server) => `${server.live}/${server.capacity}`).join(", ");
    return `Every server that sells this plan is full (customers/capacity: ${seats}). Raise a server's capacity or add a server.`;
  }
  const { rows } = await executor.execute<{ panels: number; active_panels: number; servers: number; open_servers: number }>(sql`
    select
      count(distinct pps.panel_id)::int as panels,
      count(distinct p.id) filter (where p.is_active)::int as active_panels,
      count(s.id) filter (where s.archived_at is null)::int as servers,
      count(s.id) filter (where s.archived_at is null and s.accepting_new and s.status = 'online')::int as open_servers
    from plan_panel_settings pps
    join panels p on p.id = pps.panel_id
    left join servers s on s.panel_id = pps.panel_id
    where pps.plan_id = ${planId}
  `);
  const counts = rows[0] ?? { panels: 0, active_panels: 0, servers: 0, open_servers: 0 };
  if (counts.panels === 0) return "This plan is not sold on any panel. Edit the plan and choose its panel.";
  if (counts.active_panels === 0) return "The plan's panel is switched off. Turn it on under Panels.";
  if (counts.servers === 0) return "The plan's panel has no server. Add a server on that panel under Servers.";
  return "The plan's servers are not online or not taking new customers. Check their status under Servers.";
};

/**
 * Where a new subscription goes: on every panel that sells its plan, one
 * server each (taking customers, online, with room; highest priority first,
 * then the emptiest). A panel with no room is left out; with room on none,
 * the sale is refused. The first of the list is the subscription's main
 * panel.
 *
 * The candidate servers are locked, so two purchases at the same moment
 * cannot both take the last place on a server.
 */
const placeOn = async (executor: Executor, planId: string): Promise<Placement[]> => {
  const locked = await executor.execute<{
    id: string;
    panel_id: string;
    priority: number;
    capacity_users: number;
  }>(sql`
    select s.id, s.panel_id, s.priority, s.capacity_users
    from servers s
    join plan_panel_settings pps on pps.panel_id = s.panel_id and pps.plan_id = ${planId}
    join panels p on p.id = s.panel_id and p.is_active
    where s.accepting_new and s.status = 'online' and s.archived_at is null
    -- Always locked in the same order: two purchases of different plans that
    -- share servers then queue behind each other instead of deadlocking.
    order by s.id
    for update of s
  `);
  if (locked.rows.length === 0) {
    throw new ApiError(409, "NO_SERVER_AVAILABLE", await whyNoServer(executor, planId, []));
  }

  // Counted only once the locks are held, in a statement of its own: one
  // that waited for a lock sees the place the purchase ahead of it took. A
  // count in the locking statement was read before the wait, so two
  // purchases at once could both take the last place.
  const counts = await executor.execute<{ server_id: string; live: number }>(sql`
    select m.server_id, count(*)::int as live
    from subscription_panels m
    join subscriptions x on x.id = m.subscription_id
    where m.server_id in (${sql.join(
      locked.rows.map((server) => sql`${server.id}`),
      sql`, `,
    )})
      and x.status in ('provisioning', 'on_hold', 'active', 'limited')
    group by m.server_id
  `);
  const live = new Map(counts.rows.map((row) => [row.server_id, row.live]));
  const candidates = locked.rows.map((server) => ({ ...server, live: live.get(server.id) ?? 0 }));

  const best = candidates
    .filter((server) => server.live < server.capacity_users)
    .sort(
      (a, b) =>
        b.priority - a.priority || a.live / a.capacity_users - b.live / b.capacity_users,
    );
  // The best server of each panel, the best panel first.
  const chosen = best.filter((server, index) => best.findIndex((other) => other.panel_id === server.panel_id) === index);
  if (chosen.length === 0) {
    const full = candidates.map((server) => ({ live: server.live, capacity: server.capacity_users }));
    throw new ApiError(409, "NO_SERVER_AVAILABLE", await whyNoServer(executor, planId, full));
  }
  return chosen.map((server) => ({
    serverId: server.id,
    panelId: server.panel_id,
    live: server.live,
    capacity: server.capacity_users,
  }));
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

  const places = await placeOn(executor, planId);
  const place = places[0]!;

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
  await executor.insert(subscriptionPanels).values(
    places.map((each) => ({ subscriptionId: id, panelId: each.panelId, serverId: each.serverId, dataLimitBytes: plan.dataLimitBytes })),
  );

  await recordHistory(executor, id, "created", actor, { planId, serverId: place.serverId, panels: places.length }, orderId);
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
export const groupsFor = async (
  executor: Executor,
  on: { planId: string; panelId: string; serverId: string | null },
) => {
  const [setting] = await executor
    .select({ groupIds: planPanelSettings.groupIds })
    .from(planPanelSettings)
    .where(and(eq(planPanelSettings.planId, on.planId), eq(planPanelSettings.panelId, on.panelId)));
  const [server] = on.serverId
    ? await executor.select({ groupId: servers.panelGroupId }).from(servers).where(eq(servers.id, on.serverId))
    : [];
  const groups = new Set<number>(setting?.groupIds ?? []);
  if (server?.groupId) groups.add(server.groupId);
  return [...groups].sort((a, b) => a - b);
};
