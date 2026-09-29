import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "../../modules/identity/schema";
import { at, createdAt, updatedAt } from "./columns";

/**
 * Transactional outbox.
 *
 * Written in the same transaction as the change it announces. A relay moves
 * unpublished rows onto the queue; if Redis is down, the rows wait here
 * instead of the work being lost. See src/platform/outbox.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topic: text("topic").notNull(), // 'subscription.provision'
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
    publishedAt: at("published_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    // the relay reads only what is waiting, however large the table grows
    index("outbox_unpublished_idx").on(t.id).where(sql`${t.publishedAt} is null`),
  ],
);

/** Contact details, domains, feature switches. Edited from the dashboard. */
export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});
