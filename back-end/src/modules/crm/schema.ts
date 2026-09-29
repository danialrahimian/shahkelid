import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "../identity/schema";
import { citext, createdAt, id, updatedAt } from "../../platform/db/columns";

/**
 * Only what a person sets. Lifetime value, order counts and the derived
 * lifecycle stage are computed from orders on read, never stored.
 */
export const customerProfiles = pgTable(
  "customer_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    stageOverride: text("stage_override"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "customer_profiles_stage",
      sql`${t.stageOverride} in ('lead', 'active', 'at-risk', 'churned', 'vip', 'blocked')`,
    ),
  ],
);

export const customerNotes = pgTable(
  "customer_notes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(), // as it read when written
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("customer_notes_body_length", sql`char_length(${t.body}) between 1 and 2000`),
    index("customer_notes_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    name: citext("name").notNull().unique(),
    color: text("color"),
    createdAt: createdAt(),
  },
  (t) => [check("tags_name_length", sql`char_length(${t.name}) <= 40`)],
);

export const customerTags = pgTable(
  "customer_tags",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tagId] }),
    index("customer_tags_tag_idx").on(t.tagId),
  ],
);
