import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { at, bytea, createdAt, id, updatedAt } from "../../platform/db/columns";

export const panelDriver = pgEnum("panel_driver", ["pasarguard", "marzban", "x3ui", "hiddify"]);

/** One row per VPN panel instance. The system talks to several from day one. */
export const panels = pgTable("panels", {
  id: id(),
  name: text("name").notNull(),
  driver: panelDriver("driver").notNull(),
  baseUrl: text("base_url").notNull(),
  // {username, password} or {apiKey}, AES-GCM encrypted with the app key
  credentialsEnc: bytea("credentials_enc").notNull(),
  // our own public base for subscription links, e.g. https://sub.example.com
  subscriptionBaseUrl: text("subscription_base_url"),
  version: text("version"), // as reported by the panel
  isActive: boolean("is_active").notNull().default(true),
  lastOkAt: at("last_ok_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const locations = pgTable(
  "locations",
  {
    id: id(),
    code: text("code").notNull().unique(), // 'DE', 'DE-FRA'
    nameFa: text("name_fa").notNull(),
    nameEn: text("name_en").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [check("locations_code_format", sql`${t.code} ~ '^[A-Z]{2}(-[A-Z0-9]+)?$'`)],
);

export const serverStatus = pgEnum("server_status", ["online", "degraded", "offline", "maintenance"]);

/**
 * What customers are placed on, what costs money every month, and what profit
 * is attributed to. In PasarGuard: a node, reached through a group.
 */
export const servers = pgTable(
  "servers",
  {
    id: id(),
    panelId: uuid("panel_id")
      .notNull()
      .references(() => panels.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    panelNodeId: integer("panel_node_id"),
    panelGroupId: integer("panel_group_id"), // the group that grants access to it
    capacityUsers: integer("capacity_users").notNull(),
    priority: integer("priority").notNull().default(0),
    acceptingNew: boolean("accepting_new").notNull().default(true),
    status: serverStatus("status").notNull().default("online"),
    lastCheckedAt: at("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: at("archived_at"),
  },
  (t) => [
    check("servers_capacity_positive", sql`${t.capacityUsers} > 0`),
    index("servers_panel_idx").on(t.panelId),
    index("servers_placement_idx")
      .on(t.priority.desc().nullsFirst())
      .where(sql`${t.acceptingNew} and ${t.status} = 'online' and ${t.archivedAt} is null`),
  ],
);
