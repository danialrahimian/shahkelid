import { gigabytesToBytes, type PlanView, type planInput } from "@shah-kelid/contracts";
import { asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { panels } from "../infrastructure/schema";
import { planPanelSettings, plans } from "./schema";

/**
 * Plans: volume and time, a device limit, a price in toman, and the panels
 * they are sold on. A plan is never deleted once it exists (orders and
 * subscriptions point at it): it is archived.
 *
 * What a plan says is copied onto each subscription when it is made, so
 * editing a plan changes what is sold from then on, not what was sold.
 */

type PlanRow = typeof plans.$inferSelect;

const views = async (executor: Executor, rows: PlanRow[]): Promise<PlanView[]> => {
  if (rows.length === 0) return [];
  const settings = await executor
    .select({
      planId: planPanelSettings.planId,
      panelId: planPanelSettings.panelId,
      groupIds: planPanelSettings.groupIds,
      panelName: panels.name,
    })
    .from(planPanelSettings)
    .innerJoin(panels, eq(panels.id, planPanelSettings.panelId))
    .where(
      inArray(
        planPanelSettings.planId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(panels.name));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    dataLimitBytes: row.dataLimitBytes,
    durationDays: row.durationDays,
    deviceLimit: row.deviceLimit,
    trafficReset: row.trafficReset,
    priceToman: row.priceToman,
    isPublic: row.isPublic,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    panels: settings
      .filter((setting) => setting.planId === row.id)
      .map(({ panelId, panelName, groupIds }) => ({ panelId, panelName, groupIds })),
  }));
};

export const listPlans = async (db: Db) =>
  views(db, await db.select().from(plans).orderBy(asc(plans.archivedAt), asc(plans.sortOrder), asc(plans.name)));

export const findPlanView = async (executor: Executor, id: string) => {
  const [row] = await executor.select().from(plans).where(eq(plans.id, id));
  if (!row) throw notFound("No such plan");
  return (await views(executor, [row]))[0]!;
};

const slugTaken = (error: unknown): never => {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  if ((cause as { code?: string }).code === "23505") {
    throw new ApiError(409, "CONFLICT", "That slug is taken", {
      fields: [{ path: "slug", code: "CONFLICT" }],
    });
  }
  throw error;
};

export const savePlan = async (
  db: Db,
  actor: StaffActor,
  id: string | null,
  input: z.output<typeof planInput>,
): Promise<PlanView> => {
  const panelIds = [...new Set(input.panels.map((entry) => entry.panelId))];
  if (panelIds.length !== input.panels.length) {
    throw new ApiError(400, "VALIDATION_FAILED", "A panel is listed twice", {
      fields: [{ path: "panels", code: "GROUPS_REQUIRED" }],
    });
  }
  const known = await db.select({ id: panels.id }).from(panels).where(inArray(panels.id, panelIds));
  if (known.length !== panelIds.length) throw notFound("No such panel");

  const values = {
    slug: input.slug,
    name: input.name,
    description: input.description,
    dataLimitBytes: input.dataLimitGb === null ? null : gigabytesToBytes(input.dataLimitGb),
    durationDays: input.durationDays,
    deviceLimit: input.deviceLimit,
    trafficReset: input.trafficReset,
    priceToman: input.priceToman,
    isPublic: input.isPublic,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };

  return db
    .transaction(async (tx) => {
      const before = id ? await findPlanView(tx, id) : null;
      const [row] = id
        ? await tx.update(plans).set(values).where(eq(plans.id, id)).returning()
        : await tx.insert(plans).values(values).returning();

      await tx.delete(planPanelSettings).where(eq(planPanelSettings.planId, row!.id));
      await tx.insert(planPanelSettings).values(
        input.panels.map((entry) => ({
          planId: row!.id,
          panelId: entry.panelId,
          groupIds: [...new Set(entry.groupIds)],
        })),
      );

      const after = await findPlanView(tx, row!.id);
      await writeAudit(tx, {
        ...auditBy(actor),
        action: id ? "plan.updated" : "plan.created",
        entityType: "plan",
        entityId: row!.id,
        before,
        after,
      });
      return after;
    })
    .catch(slugTaken);
};

/** No longer sold. Subscriptions already made from it are untouched. */
export const archivePlan = async (db: Db, actor: StaffActor, id: string) =>
  db.transaction(async (tx) => {
    const before = await findPlanView(tx, id);
    await tx.update(plans).set({ archivedAt: new Date(), isActive: false }).where(eq(plans.id, id));
    const after = await findPlanView(tx, id);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "plan.archived",
      entityType: "plan",
      entityId: id,
      before,
      after,
    });
    return after;
  });
