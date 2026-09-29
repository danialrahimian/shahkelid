import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { panels } from "../infrastructure/schema";
import { at, createdAt, id, updatedAt, wholeNumber } from "../../platform/db/columns";

export const trafficReset = pgEnum("traffic_reset", ["no_reset", "daily", "weekly", "monthly"]);

/**
 * Plans are volume and time. A null volume is an unlimited plan.
 * Never deleted once sold, because orders and subscriptions point at them:
 * archived instead.
 */
export const plans = pgTable(
  "plans",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    dataLimitBytes: wholeNumber("data_limit_bytes"),
    durationDays: integer("duration_days").notNull(),
    deviceLimit: integer("device_limit"),
    trafficReset: trafficReset("traffic_reset").notNull().default("no_reset"),
    priceToman: wholeNumber("price_toman").notNull(),
    isTrial: boolean("is_trial").notNull().default(false),
    // false: sold only by staff and resellers
    isPublic: boolean("is_public").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at("archived_at"),
  },
  (t) => [
    check("plans_slug_format", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
    check("plans_data_limit_positive", sql`${t.dataLimitBytes} is null or ${t.dataLimitBytes} > 0`),
    check("plans_duration_range", sql`${t.durationDays} between 1 and 3650`),
    check(
      "plans_device_limit_range",
      sql`${t.deviceLimit} is null or ${t.deviceLimit} between 1 and 100`,
    ),
    check("plans_price_not_negative", sql`${t.priceToman} >= 0`),
    check("plans_trial_is_free", sql`not ${t.isTrial} or ${t.priceToman} = 0`),
    // at most one free-trial plan on offer at a time
    uniqueIndex("plans_single_trial_idx")
      .on(t.isTrial)
      .where(sql`${t.isTrial} and ${t.isActive} and ${t.archivedAt} is null`),
  ],
);

/** How a plan is expressed on each panel: which groups (inbounds) it grants. */
export const planPanelSettings = pgTable(
  "plan_panel_settings",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panels.id, { onDelete: "cascade" }),
    groupIds: integer("group_ids").array().notNull().default(sql`'{}'`),
    userTemplateId: integer("user_template_id"),
  },
  (t) => [primaryKey({ columns: [t.planId, t.panelId] })],
);
