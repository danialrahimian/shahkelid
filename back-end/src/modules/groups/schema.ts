import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { panels } from "../infrastructure/schema";
import { createdAt, id, updatedAt } from "../../platform/db/columns";

/**
 * Our groups: what plans are sold with, and what a customer's link carries.
 * See service.ts.
 */
export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  // dragged into place; the customer's configs come in this order too
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The panel groups a group takes its hosts from. */
export const groupSources = pgTable(
  "group_sources",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panels.id, { onDelete: "restrict" }),
    panelGroupId: integer("panel_group_id").notNull(),
    // as the panel last named it, for showing; the id is what counts
    panelGroupName: text("panel_group_name").notNull().default(""),
    // every host of the panel group, now and later; false: only the hosts picked
    allHosts: boolean("all_hosts").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.panelId, t.panelGroupId] }),
    check("group_sources_panel_group_positive", sql`${t.panelGroupId} > 0`),
    index("group_sources_panel_idx").on(t.panelId),
  ],
);

/**
 * What our group says about one of its hosts (a host is one config on a
 * panel, addressed by the panel's own id): picked or not, our name for it,
 * and its place. A host with no row is in its source's default (all hosts,
 * or not picked), under the panel's remark, after the ordered ones.
 */
export const groupHosts = pgTable(
  "group_hosts",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panels.id, { onDelete: "restrict" }),
    hostId: integer("host_id").notNull(),
    selected: boolean("selected").notNull().default(false),
    // null: the panel's remark
    name: text("name"),
    // null: not placed by hand
    sortOrder: integer("sort_order"),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.panelId, t.hostId] })],
);
