import { gigabytesToBytes, type PlanView, type planInput } from "@shah-kelid/contracts";
import { asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { groups } from "../groups/schema";
import { planGroups, plans } from "./schema";

/**
 * Plans: volume and time, a device limit, a price in toman, and the groups
 * they are sold with (which decide the panels and configs a buyer gets). A plan is never deleted once it exists (orders and
 * subscriptions point at it): it is archived.
 *
 * What a plan says is copied onto each subscription when it is made, so
 * editing a plan changes what is sold from then on, not what was sold.
 */

type PlanRow = typeof plans.$inferSelect;

const views = async (executor: Executor, rows: PlanRow[]): Promise<PlanView[]> => {
  if (rows.length === 0) return [];
  const settings = await executor
    .select({ planId: planGroups.planId, id: groups.id, name: groups.name })
    .from(planGroups)
    .innerJoin(groups, eq(groups.id, planGroups.groupId))
    .where(
      inArray(
        planGroups.planId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(groups.sortOrder), asc(groups.name));

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
    groups: settings.filter((setting) => setting.planId === row.id).map(({ id, name }) => ({ id, name })),
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
  const groupIds = [...new Set(input.groupIds)];
  const known = await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, groupIds));
  if (known.length !== groupIds.length) throw notFound("No such group");

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

      await tx.delete(planGroups).where(eq(planGroups.planId, row!.id));
      await tx.insert(planGroups).values(groupIds.map((groupId) => ({ planId: row!.id, groupId })));

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
