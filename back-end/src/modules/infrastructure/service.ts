import type {
  LocationView,
  PanelGroup,
  PanelView,
  ServerView,
  locationInput,
  panelInput,
  panelUpdateInput,
  serverInput,
} from "@shah-kelid/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { PanelRejectedError, PanelUnavailableError } from "../provisioning/driver";
import {
  driverFor,
  openCredentials,
  sealCredentials,
  trialDriver,
  type PanelRow,
} from "../provisioning/drivers";
import { locations, panels, servers } from "./schema";

/**
 * Panels, locations and servers: where subscriptions are placed.
 *
 * A panel is only saved once it has answered with the credentials given, so
 * a typo in a password shows up while staff are still on the form, not at
 * the first customer's checkout.
 */

// -------------------------------------------------------------- the panel

/** A panel error, as the API says it. */
export const panelFailure = (error: unknown): ApiError => {
  if (error instanceof PanelRejectedError) {
    return new ApiError(502, "PANEL_REJECTED", error.message);
  }
  if (error instanceof PanelUnavailableError) {
    return new ApiError(503, "PANEL_UNREACHABLE", error.message);
  }
  throw error;
};

const iso = (date: Date | null) => date?.toISOString() ?? null;

export const panelView = (row: PanelRow): PanelView => {
  const credentials = openCredentials(row.credentialsEnc);
  return {
    id: row.id,
    name: row.name,
    driver: row.driver as PanelView["driver"],
    baseUrl: row.baseUrl,
    subscriptionBaseUrl: row.subscriptionBaseUrl,
    credentials:
      credentials.kind === "password"
        ? { kind: "password", username: credentials.username }
        : { kind: "api_key" },
    version: row.version,
    isActive: row.isActive,
    lastOkAt: iso(row.lastOkAt),
    lastError: row.lastError,
  };
};

export const findPanel = async (executor: Executor, id: string) => {
  const [row] = await executor.select().from(panels).where(eq(panels.id, id));
  if (!row) throw notFound("No such panel");
  return row;
};

export const listPanels = async (db: Db) =>
  (await db.select().from(panels).orderBy(asc(panels.name))).map(panelView);

/** Asks the panel how it is, and remembers the answer on its row. */
export const checkPanel = async (db: Db, id: string) => {
  const panel = await findPanel(db, id);
  try {
    const { version } = await driverFor(panel).health();
    const [row] = await db
      .update(panels)
      .set({ version, lastOkAt: new Date(), lastError: null })
      .where(eq(panels.id, id))
      .returning();
    return panelView(row!);
  } catch (error) {
    await db
      .update(panels)
      .set({ lastError: (error as Error).message.slice(0, 500) })
      .where(eq(panels.id, id));
    throw panelFailure(error);
  }
};

/** Tries the address and credentials before they are saved. */
const probe = async (candidate: Pick<PanelRow, "driver" | "baseUrl" | "credentialsEnc">) => {
  try {
    return (await trialDriver(candidate).health()).version;
  } catch (error) {
    throw panelFailure(error);
  }
};

export const createPanel = async (
  db: Db,
  actor: StaffActor,
  input: z.output<typeof panelInput>,
) => {
  const values = {
    name: input.name,
    driver: input.driver,
    baseUrl: input.baseUrl,
    subscriptionBaseUrl: input.subscriptionBaseUrl,
    credentialsEnc: sealCredentials(input.credentials),
    isActive: input.isActive,
    version: null,
    lastOkAt: null,
    lastError: null,
  };
  const version = await probe(values);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(panels)
      .values({ ...values, version, lastOkAt: new Date() })
      .returning();
    const view = panelView(row!);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "panel.created",
      entityType: "panel",
      entityId: row!.id,
      after: view,
    });
    return view;
  });
};

export const updatePanel = async (
  db: Db,
  actor: StaffActor,
  id: string,
  input: z.output<typeof panelUpdateInput>,
) => {
  const current = await findPanel(db, id);
  const credentialsEnc = input.credentials
    ? sealCredentials(input.credentials)
    : current.credentialsEnc;
  const values = {
    name: input.name,
    driver: input.driver,
    baseUrl: input.baseUrl,
    subscriptionBaseUrl: input.subscriptionBaseUrl,
    credentialsEnc,
    isActive: input.isActive,
  };

  // Only a new address or new credentials need the panel's word.
  const reachChanged = input.credentials !== undefined || input.baseUrl !== current.baseUrl;
  const version = reachChanged ? await probe({ ...current, ...values }) : current.version;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(panels)
      .set({ ...values, version, ...(reachChanged ? { lastOkAt: new Date(), lastError: null } : {}) })
      .where(eq(panels.id, id))
      .returning();
    const view = panelView(row!);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "panel.updated",
      entityType: "panel",
      entityId: id,
      before: panelView(current),
      // Credentials never enter the log, only whether they were replaced.
      after: { ...view, credentialsReplaced: input.credentials !== undefined },
    });
    return view;
  });
};

export const listPanelGroups = async (db: Db, id: string): Promise<PanelGroup[]> => {
  const panel = await findPanel(db, id);
  try {
    return await driverFor(panel).listGroups();
  } catch (error) {
    throw panelFailure(error);
  }
};

// ------------------------------------------------------------- locations

const locationView = (row: typeof locations.$inferSelect): LocationView => ({
  id: row.id,
  code: row.code,
  nameFa: row.nameFa,
  nameEn: row.nameEn,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});

export const listLocations = async (db: Db) =>
  (await db.select().from(locations).orderBy(asc(locations.sortOrder), asc(locations.code))).map(
    locationView,
  );

const uniqueCode = (error: unknown): never => {
  const cause = (error as { cause?: { code?: string } }).cause ?? error;
  if ((cause as { code?: string }).code === "23505") {
    throw new ApiError(409, "CONFLICT", "That location code is taken", {
      fields: [{ path: "code", code: "CONFLICT" }],
    });
  }
  throw error;
};

export const saveLocation = async (
  db: Db,
  actor: StaffActor,
  id: string | null,
  input: z.output<typeof locationInput>,
): Promise<LocationView> =>
  db
    .transaction(async (tx) => {
      const [before] = id ? await tx.select().from(locations).where(eq(locations.id, id)) : [];
      if (id && !before) throw notFound("No such location");

      const [row] = id
        ? await tx.update(locations).set(input).where(eq(locations.id, id)).returning()
        : await tx.insert(locations).values(input).returning();
      const view = locationView(row!);
      await writeAudit(tx, {
        ...auditBy(actor),
        action: id ? "location.updated" : "location.created",
        entityType: "location",
        entityId: row!.id,
        before: before ? locationView(before) : null,
        after: view,
      });
      return view;
    })
    .catch(uniqueCode);

// --------------------------------------------------------------- servers

/** Subscriptions that still hold a place on a server. */
export const LIVE_STATUSES = ["provisioning", "on_hold", "active", "limited"] as const;

// Table names written out: an interpolated column loses its table inside a
// subquery, and "id" would then be the subscription's own id.
const liveCount = sql<number>`(
  select count(*)::int from subscriptions x
  where x.server_id = "servers"."id"
    and x.status in ('provisioning', 'on_hold', 'active', 'limited')
)`;

export const listServers = async (executor: Executor, where = sql`true`): Promise<ServerView[]> => {
  const rows = await executor
    .select({
      server: servers,
      panelName: panels.name,
      locationName: locations.nameFa,
      live: liveCount,
    })
    .from(servers)
    .innerJoin(panels, eq(panels.id, servers.panelId))
    .innerJoin(locations, eq(locations.id, servers.locationId))
    .where(where)
    .orderBy(asc(servers.archivedAt), asc(locations.sortOrder), asc(servers.name));

  return rows.map(({ server, panelName, locationName, live }) => ({
    id: server.id,
    panelId: server.panelId,
    panelName,
    locationId: server.locationId,
    locationName,
    name: server.name,
    host: server.host,
    panelGroupId: server.panelGroupId,
    capacityUsers: server.capacityUsers,
    priority: server.priority,
    acceptingNew: server.acceptingNew,
    status: server.status,
    liveSubscriptions: Number(live),
    archivedAt: iso(server.archivedAt),
  }));
};

const oneServer = async (executor: Executor, id: string) => {
  const [view] = await listServers(executor, eq(servers.id, id));
  if (!view) throw notFound("No such server");
  return view;
};

/** The group must exist on the panel: a typo would make users with no access. */
const assertGroupOnPanel = async (db: Db, panelId: string, groupId: number) => {
  const groups = await listPanelGroups(db, panelId);
  if (!groups.some((group) => group.id === groupId)) {
    throw new ApiError(400, "VALIDATION_FAILED", `Group ${groupId} is not on that panel`, {
      fields: [{ path: "panelGroupId", code: "NUMBER_OUT_OF_RANGE" }],
    });
  }
};

export const saveServer = async (
  db: Db,
  actor: StaffActor,
  id: string | null,
  input: z.output<typeof serverInput>,
): Promise<ServerView> => {
  await findPanel(db, input.panelId);
  const [location] = await db.select().from(locations).where(eq(locations.id, input.locationId));
  if (!location) throw notFound("No such location");
  await assertGroupOnPanel(db, input.panelId, input.panelGroupId);

  return db.transaction(async (tx) => {
    const before = id ? await oneServer(tx, id) : null;
    if (before && before.panelId !== input.panelId && before.liveSubscriptions > 0) {
      throw new ApiError(409, "CONFLICT", "Customers are on this server: it cannot move to another panel");
    }

    const [row] = id
      ? await tx.update(servers).set(input).where(eq(servers.id, id)).returning()
      : await tx.insert(servers).values(input).returning();
    const view = await oneServer(tx, row!.id);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: id ? "server.updated" : "server.created",
      entityType: "server",
      entityId: row!.id,
      before,
      after: view,
    });
    return view;
  });
};

/**
 * Takes a server out of service for new customers. Existing ones stay where
 * they are; a server is never deleted, because subscriptions point at it.
 */
export const archiveServer = async (db: Db, actor: StaffActor, id: string) =>
  db.transaction(async (tx) => {
    const before = await oneServer(tx, id);
    await tx
      .update(servers)
      .set({ archivedAt: new Date(), acceptingNew: false })
      .where(eq(servers.id, id));
    const after = await oneServer(tx, id);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "server.archived",
      entityType: "server",
      entityId: id,
      before,
      after,
    });
    return after;
  });
