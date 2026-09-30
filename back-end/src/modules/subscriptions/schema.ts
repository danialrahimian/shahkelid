import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { actorKind } from "../access/schema";
import { orders } from "../billing/schema";
import { plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { panels, servers } from "../infrastructure/schema";
import { at, createdAt, id, updatedAt, wholeNumber } from "../../platform/db/columns";

export const subscriptionStatus = pgEnum("subscription_status", [
  "provisioning", // paid, not yet on the panel
  "provisioning_failed", // retries exhausted: staff alerted, money kept
  "on_hold", // created, the clock starts on first connection
  "active",
  "limited", // volume used up
  "expired",
  "disabled", // turned off by staff
  "deleted",
]);

/** The statuses that still occupy a place on a server. */
const LIVE = sql`('provisioning', 'on_hold', 'active', 'limited')`;

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resellerUserId: uuid("reseller_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panels.id, { onDelete: "restrict" }),
    serverId: uuid("server_id").references(() => servers.id, { onDelete: "restrict" }),
    // Derived from the subscription id, never random: a retried create finds
    // the user a lost attempt made instead of making a second one.
    panelUsername: text("panel_username").notNull(),
    panelUserId: integer("panel_user_id"),
    status: subscriptionStatus("status").notNull().default("provisioning"),
    isTrial: boolean("is_trial").notNull().default(false),
    // the limits currently in force; renewals and top-ups change them
    dataLimitBytes: wholeNumber("data_limit_bytes"),
    deviceLimit: integer("device_limit"),
    expiresAt: at("expires_at"),
    startsOnFirstUse: boolean("starts_on_first_use").notNull().default(false),
    // While on hold: how long it runs once it starts (a renewal adds to it).
    onHoldDurationSeconds: integer("on_hold_duration_seconds"),
    // A copy from the panel. The panel stays the source of truth for usage.
    usedBytes: wholeNumber("used_bytes").notNull().default(0),
    lifetimeUsedBytes: wholeNumber("lifetime_used_bytes").notNull().default(0),
    onlineAt: at("online_at"),
    lastSyncedAt: at("last_synced_at"),
    // The customer's link is /s/{access_token} on our domain, proxied to the panel.
    accessToken: text("access_token").notNull().unique(),
    panelSubscriptionUrl: text("panel_subscription_url"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    provisionedAt: at("provisioned_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("subscriptions_panel_username_key").on(t.panelId, t.panelUsername),
    unique("subscriptions_panel_user_id_key").on(t.panelId, t.panelUserId),
    check(
      "subscriptions_data_limit_positive",
      sql`${t.dataLimitBytes} is null or ${t.dataLimitBytes} > 0`,
    ),
    check("subscriptions_used_not_negative", sql`${t.usedBytes} >= 0`),
    check("subscriptions_lifetime_not_negative", sql`${t.lifetimeUsedBytes} >= 0`),
    index("subscriptions_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
    index("subscriptions_reseller_idx")
      .on(t.resellerUserId)
      .where(sql`${t.resellerUserId} is not null`),
    // the reminder scan: live subscriptions ordered by expiry
    index("subscriptions_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} in ('active', 'on_hold', 'limited')`),
    // the placement count: how many live subscriptions each server carries
    index("subscriptions_server_idx").on(t.serverId).where(sql`${t.status} in ${LIVE}`),
    index("subscriptions_status_idx")
      .on(t.status)
      .where(sql`${t.status} in ('provisioning', 'provisioning_failed')`),
  ],
);

/**
 * Everything that ever happened to a subscription, including what the system
 * did on its own. Support reads this next to a ticket.
 */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // created, renewed, reset_usage, ...
    actorKind: actorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references((): AnyPgColumn => orders.id, {
      onDelete: "set null",
    }),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("subscription_events_idx").on(t.subscriptionId, t.id.desc().nullsFirst())],
);

/**
 * "Each reminder once per cycle." A renewal starts a new cycle (a new expiry),
 * so the same reminder can fire again for the new term.
 */
export const subscriptionAlertsSent = pgTable(
  "subscription_alerts_sent",
  {
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    alert: text("alert").notNull(),
    cycleKey: text("cycle_key").notNull(),
    sentAt: at("sent_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subscriptionId, t.alert, t.cycleKey] }),
    check(
      "subscription_alerts_sent_alert",
      sql`${t.alert} in ('expiry_3d', 'expiry_1d', 'usage_80', 'usage_100')`,
    ),
  ],
);
