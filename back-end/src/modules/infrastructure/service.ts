import type { PanelGroup, PanelView, panelInput, panelUpdateInput } from "@shah-kelid/contracts";
import { asc, eq } from "drizzle-orm";
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
import { forgetCatalog } from "../groups/catalog";
import { panels } from "./schema";

/**
 * Panels: where our groups take their hosts from, and where customers'
 * users are made.
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
    // A new address or account may see other hosts: read them afresh.
    forgetCatalog(id);
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
