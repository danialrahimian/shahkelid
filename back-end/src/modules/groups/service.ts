import type {
  GroupHostView,
  GroupHostsView,
  GroupView,
  groupHostInput,
  groupInput,
  groupOrderInput,
  groupSourcesInput,
  hostOrderInput,
} from "@shah-kelid/contracts";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { planGroups, plans } from "../catalog/schema";
import { panels } from "../infrastructure/schema";
import { findPanel, panelFailure } from "../infrastructure/service";
import { subscriptionGroups, subscriptions } from "../subscriptions/schema";
import type { ProbeHost } from "../subscriptions/configs";
import { readGroups, readProbe } from "./catalog";
import { groupHosts, groupSources, groups } from "./schema";

/**
 * Our groups (see contracts: GroupView). A group takes groups from any of
 * the connected panels, and from each all its hosts or the ones picked;
 * hosts may be shown under names of our own, and hosts and groups are in an
 * order of our own. Plans are sold with groups; a customer's link carries
 * the configs of their groups, in that order and under those names.
 *
 * Changing a group reaches the customers who have it: names, picks and
 * order at once (they are read when the link is served), and a new panel
 * group at the next sync (the panel users are given it then).
 */

const LIVE = ["provisioning", "on_hold", "active", "limited", "expired", "disabled"] as const;

// ----------------------------------------------------------------- reading

const sourcesOf = async (executor: Executor, groupIds: string[]) =>
  groupIds.length === 0
    ? []
    : executor
        .select({ source: groupSources, panelName: panels.name })
        .from(groupSources)
        .innerJoin(panels, eq(panels.id, groupSources.panelId))
        .where(inArray(groupSources.groupId, groupIds))
        .orderBy(asc(groupSources.sortOrder), asc(panels.name), asc(groupSources.panelGroupId));

export const listGroups = async (executor: Executor, ids?: string[]): Promise<GroupView[]> => {
  const rows = await executor
    .select()
    .from(groups)
    .where(ids ? inArray(groups.id, ids) : undefined)
    .orderBy(asc(groups.sortOrder), asc(groups.name));
  const groupIds = rows.map((row) => row.id);
  if (groupIds.length === 0) return [];
  const sources = await sourcesOf(executor, groupIds);
  const sold = await executor
    .select({ groupId: planGroups.groupId, id: plans.id, name: plans.name })
    .from(planGroups)
    .innerJoin(plans, eq(plans.id, planGroups.planId))
    .where(inArray(planGroups.groupId, groupIds))
    .orderBy(asc(plans.sortOrder), asc(plans.name));
  const counts = await executor
    .select({ groupId: subscriptionGroups.groupId, live: sql<number>`count(*)::int` })
    .from(subscriptionGroups)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionGroups.subscriptionId))
    .where(and(inArray(subscriptionGroups.groupId, groupIds), inArray(subscriptions.status, [...LIVE])))
    .groupBy(subscriptionGroups.groupId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    sources: sources
      .filter(({ source }) => source.groupId === row.id)
      .map(({ source, panelName }) => ({
        panelId: source.panelId,
        panelName,
        panelGroupId: source.panelGroupId,
        panelGroupName: source.panelGroupName,
        allHosts: source.allHosts,
      })),
    plans: sold.filter((plan) => plan.groupId === row.id).map(({ id, name }) => ({ id, name })),
    subscriptions: Number(counts.find((count) => count.groupId === row.id)?.live ?? 0),
  }));
};

export const findGroup = async (executor: Executor, id: string) => {
  const [view] = await listGroups(executor, [id]);
  if (!view) throw notFound("No such group");
  return view;
};

// ------------------------------------------------------------------ hosts

type HostRow = typeof groupHosts.$inferSelect;

/** A group's hosts: from each panel group it takes, with what the group says about each. */
export const groupHostsOf = async (
  executor: Executor,
  id: string,
  read: (panel: typeof panels.$inferSelect, panelGroupId: number) => Promise<ProbeHost[] | null> = readProbe,
): Promise<GroupHostsView> => {
  const group = await findGroup(executor, id);
  const rows = await executor.select().from(groupHosts).where(eq(groupHosts.groupId, id));
  const byKey = new Map<string, HostRow>(rows.map((row) => [`${row.panelId}:${row.hostId}`, row]));

  const hosts: (GroupHostView & { place: number | null; panelOrder: number })[] = [];
  const unreachable: GroupHostsView["unreachable"] = [];
  const failed = new Set<string>();
  for (const [sourceIndex, source] of group.sources.entries()) {
    if (failed.has(source.panelId)) continue;
    const panel = await findPanel(executor, source.panelId);
    let configs: ProbeHost[] | null;
    try {
      configs = await read(panel, source.panelGroupId);
    } catch (error) {
      configs = null;
      failed.add(source.panelId);
      unreachable.push({ panelId: panel.id, panelName: panel.name, error: (error as Error).message.slice(0, 300) });
    }
    if (!configs) continue;
    for (const [hostIndex, config] of configs.entries()) {
      const seen = hosts.find((host) => host.panelId === panel.id && host.hostId === config.id);
      if (seen) {
        // In two of the group's panel groups: one host, "all" if either takes all.
        seen.panelGroupIds.push(source.panelGroupId);
        if (source.allHosts) seen.forced = seen.selected = true;
        continue;
      }
      const row = byKey.get(`${panel.id}:${config.id}`);
      hosts.push({
        panelId: panel.id,
        panelName: panel.name,
        hostId: config.id,
        remark: config.name,
        protocol: config.protocol,
        address: config.server,
        port: config.port,
        network: config.network,
        panelGroupIds: [source.panelGroupId],
        selected: source.allHosts || (row?.selected ?? false),
        forced: source.allHosts,
        name: row?.name ?? null,
        place: row?.sortOrder ?? null,
        panelOrder: sourceIndex * 1_000_000 + hostIndex,
      });
    }
  }

  // Placed by hand first, then the rest as the panels give them.
  hosts.sort((a, b) =>
    a.place !== null && b.place !== null
      ? a.place - b.place
      : a.place !== null
        ? -1
        : b.place !== null
          ? 1
          : a.panelOrder - b.panelOrder,
  );
  return { hosts: hosts.map(({ place: _place, panelOrder: _order, ...host }) => host), unreachable };
};

// ---------------------------------------------------------------- writing

const audit = (executor: Executor, actor: StaffActor, action: string, id: string, before: unknown, after: unknown) =>
  writeAudit(executor, { ...auditBy(actor), action, entityType: "group", entityId: id, before, after });

export const createGroup = async (db: Db, actor: StaffActor, input: z.output<typeof groupInput>) =>
  db.transaction(async (tx) => {
    const [last] = await tx.select({ value: max(groups.sortOrder) }).from(groups);
    const [row] = await tx
      .insert(groups)
      .values({ name: input.name, sortOrder: (last?.value ?? -1) + 1 })
      .returning();
    const view = await findGroup(tx, row!.id);
    await audit(tx, actor, "group.created", row!.id, null, view);
    return view;
  });

export const renameGroup = async (db: Db, actor: StaffActor, id: string, input: z.output<typeof groupInput>) =>
  db.transaction(async (tx) => {
    const before = await findGroup(tx, id);
    await tx.update(groups).set({ name: input.name }).where(eq(groups.id, id));
    const after = await findGroup(tx, id);
    await audit(tx, actor, "group.renamed", id, { name: before.name }, { name: after.name });
    return after;
  });

/** Refused while a plan is sold with it or a customer still has it: their configs come from it. */
export const deleteGroup = async (db: Db, actor: StaffActor, id: string) =>
  db.transaction(async (tx) => {
    const before = await findGroup(tx, id);
    if (before.plans.length > 0) {
      throw new ApiError(409, "CONFLICT", `Plans are sold with this group: ${before.plans.map((plan) => plan.name).join(", ")}`);
    }
    if (before.subscriptions > 0) {
      throw new ApiError(409, "CONFLICT", `${before.subscriptions} customers have this group`);
    }
    // Deleted subscriptions may still name it; they no longer need it.
    await tx.delete(subscriptionGroups).where(eq(subscriptionGroups.groupId, id));
    await tx.delete(groups).where(eq(groups.id, id));
    await audit(tx, actor, "group.deleted", id, before, null);
    return { deleted: true };
  });

/**
 * The panel groups a group takes hosts from, in the order given: added,
 * removed, or switched between all hosts and the ones picked. Each must be
 * on its panel (asked of the panel, which also gives its name).
 */
export const setSources = async (db: Db, actor: StaffActor, id: string, input: z.output<typeof groupSourcesInput>) => {
  const seen = new Set<string>();
  for (const source of input.sources) {
    const key = `${source.panelId}:${source.panelGroupId}`;
    if (seen.has(key)) {
      throw new ApiError(400, "VALIDATION_FAILED", "A panel group is listed twice", {
        fields: [{ path: "sources", code: "CONFLICT" }],
      });
    }
    seen.add(key);
  }

  // Each panel is asked once for its groups: a typo would give customers nothing.
  const names = new Map<string, string>();
  for (const panelId of new Set(input.sources.map((source) => source.panelId))) {
    const panel = await findPanel(db, panelId);
    let onPanel;
    try {
      onPanel = await readGroups(panel);
    } catch (error) {
      throw panelFailure(error);
    }
    for (const [index, source] of input.sources.entries()) {
      if (source.panelId !== panelId) continue;
      const found = onPanel.find((group) => group.id === source.panelGroupId);
      if (!found) {
        throw new ApiError(400, "VALIDATION_FAILED", `Group ${source.panelGroupId} is not on ${panel.name}`, {
          fields: [{ path: `sources.${index}.panelGroupId`, code: "NUMBER_OUT_OF_RANGE" }],
        });
      }
      names.set(`${panelId}:${source.panelGroupId}`, found.name);
    }
  }

  return db.transaction(async (tx) => {
    const before = await findGroup(tx, id);
    await tx.delete(groupSources).where(eq(groupSources.groupId, id));
    if (input.sources.length > 0) {
      await tx.insert(groupSources).values(
        input.sources.map((source, index) => ({
          groupId: id,
          panelId: source.panelId,
          panelGroupId: source.panelGroupId,
          panelGroupName: names.get(`${source.panelId}:${source.panelGroupId}`) ?? "",
          allHosts: source.allHosts,
          sortOrder: index,
        })),
      );
    }
    await tx.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, id));
    const after = await findGroup(tx, id);
    await audit(tx, actor, "group.sources_changed", id, before.sources, after.sources);
    return after;
  });
};

/** One host: picked or left out, and our name for it ("" or null: the panel's remark). */
export const updateHost = async (
  db: Db,
  actor: StaffActor,
  id: string,
  panelId: string,
  hostId: string,
  input: z.output<typeof groupHostInput>,
) => {
  const { hosts } = await groupHostsOf(db, id);
  const host = hosts.find((candidate) => candidate.panelId === panelId && candidate.hostId === hostId);
  if (!host) throw notFound("That host is not in this group's panel groups");
  if (input.selected === false && host.forced) {
    throw new ApiError(409, "CONFLICT", "Its panel group gives all its hosts: pick hosts for it first");
  }

  const name = input.name === undefined ? undefined : input.name === null || input.name === "" ? null : input.name;
  await db.transaction(async (tx) => {
    await tx
      .insert(groupHosts)
      .values({ groupId: id, panelId, hostId, selected: input.selected ?? host.selected, name: name ?? host.name })
      .onConflictDoUpdate({
        target: [groupHosts.groupId, groupHosts.panelId, groupHosts.hostId],
        set: {
          ...(input.selected !== undefined ? { selected: input.selected } : {}),
          ...(name !== undefined ? { name } : {}),
        },
      });
    await audit(
      tx,
      actor,
      "group.host_changed",
      id,
      { panelId, hostId, selected: host.selected, name: host.name },
      { panelId, hostId, ...(input.selected !== undefined ? { selected: input.selected } : {}), ...(name !== undefined ? { name } : {}) },
    );
  });
  return groupHostsOf(db, id);
};

/** The hosts in the order they were dragged into; the ones not named go after them. */
export const orderHosts = async (db: Db, actor: StaffActor, id: string, input: z.output<typeof hostOrderInput>) => {
  await findGroup(db, id);
  const keys = input.hosts.map((host) => `${host.panelId}:${host.hostId}`);
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(400, "VALIDATION_FAILED", "A host is listed twice", { fields: [{ path: "hosts", code: "CONFLICT" }] });
  }
  await db.transaction(async (tx) => {
    await tx.update(groupHosts).set({ sortOrder: null }).where(eq(groupHosts.groupId, id));
    for (const [index, host] of input.hosts.entries()) {
      await tx
        .insert(groupHosts)
        .values({ groupId: id, panelId: host.panelId, hostId: host.hostId, sortOrder: index })
        .onConflictDoUpdate({
          target: [groupHosts.groupId, groupHosts.panelId, groupHosts.hostId],
          set: { sortOrder: index },
        });
    }
    await audit(tx, actor, "group.hosts_reordered", id, null, { hosts: input.hosts });
  });
  return groupHostsOf(db, id);
};

/** The groups in the order they were dragged into; the ones not named keep their place after them. */
export const orderGroups = async (db: Db, actor: StaffActor, input: z.output<typeof groupOrderInput>) => {
  if (new Set(input.ids).size !== input.ids.length) {
    throw new ApiError(400, "VALIDATION_FAILED", "A group is listed twice", { fields: [{ path: "ids", code: "CONFLICT" }] });
  }
  return db.transaction(async (tx) => {
    const all = await tx.select({ id: groups.id }).from(groups).orderBy(asc(groups.sortOrder), asc(groups.name));
    const known = new Set(all.map((row) => row.id));
    const missing = input.ids.find((groupId) => !known.has(groupId));
    if (missing) throw notFound("No such group");
    const order = [...input.ids, ...all.map((row) => row.id).filter((groupId) => !input.ids.includes(groupId))];
    for (const [index, groupId] of order.entries()) {
      await tx.update(groups).set({ sortOrder: index }).where(eq(groups.id, groupId));
    }
    await writeAudit(tx, { ...auditBy(actor), action: "group.reordered", entityType: "group", entityId: null, after: { ids: order } });
    return listGroups(tx);
  });
};

// ------------------------------------------------- for plans and customers

/**
 * The panels a set of our groups puts a customer on, each with the panel
 * groups they get there; in the groups' order (the first is the main panel).
 * Only panels switched on.
 */
export const panelsOfGroups = async (executor: Executor, groupIds: string[]) => {
  if (groupIds.length === 0) return [];
  const rows = await executor
    .select({ panelId: groupSources.panelId, panelGroupId: groupSources.panelGroupId })
    .from(groupSources)
    .innerJoin(groups, eq(groups.id, groupSources.groupId))
    .innerJoin(panels, eq(panels.id, groupSources.panelId))
    .where(and(inArray(groupSources.groupId, groupIds), eq(panels.isActive, true)))
    .orderBy(asc(groups.sortOrder), asc(groups.name), asc(groupSources.sortOrder));
  const byPanel = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!byPanel.has(row.panelId)) byPanel.set(row.panelId, new Set());
    byPanel.get(row.panelId)!.add(row.panelGroupId);
  }
  return [...byPanel].map(([panelId, ids]) => ({ panelId, panelGroupIds: [...ids].sort((a, b) => a - b) }));
};

export const groupIdsOfPlan = async (executor: Executor, planId: string) =>
  (
    await executor
      .select({ id: planGroups.groupId })
      .from(planGroups)
      .innerJoin(groups, eq(groups.id, planGroups.groupId))
      .where(eq(planGroups.planId, planId))
      .orderBy(asc(groups.sortOrder), asc(groups.name))
  ).map((row) => row.id);

export const groupIdsOfSubscription = async (executor: Executor, subscriptionId: string) =>
  (
    await executor
      .select({ id: subscriptionGroups.groupId })
      .from(subscriptionGroups)
      .innerJoin(groups, eq(groups.id, subscriptionGroups.groupId))
      .where(eq(subscriptionGroups.subscriptionId, subscriptionId))
      .orderBy(asc(groups.sortOrder), asc(groups.name))
  ).map((row) => row.id);

/** The panel groups a subscription's user should have on one panel. */
export const panelGroupIdsFor = async (executor: Executor, subscriptionId: string, panelId: string) =>
  (await panelsOfGroups(executor, await groupIdsOfSubscription(executor, subscriptionId))).find(
    (entry) => entry.panelId === panelId,
  )?.panelGroupIds ?? [];
