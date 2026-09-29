import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "../identity/schema";
import { createdAt, id } from "../../platform/db/columns";

/**
 * Roles are data, so they can be edited. Permission strings
 * ("payments:approve") are defined in code, next to the routes that check them.
 */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // seeded roles cannot be deleted
    isSystem: boolean("is_system").notNull().default(false),
    requires2fa: boolean("requires_2fa").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check("roles_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    check("role_permissions_format", sql`${t.permission} ~ '^[a-z_]+:[a-z_]+$'`),
  ],
);

/** A customer has no rows here. Staff have one or more roles. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const actorKind = pgEnum("actor_kind", [
  "customer",
  "staff",
  "reseller",
  "system",
  "bot",
]);

/**
 * Append-only. A trigger (in the migrations) refuses updates and deletes, so
 * nobody working through the application can tidy away what they did.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorKind: actorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // 'subscription.reset_usage'
    entityType: text("entity_type").notNull(), // 'subscription'
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.occurredAt.desc().nullsFirst()),
    index("audit_logs_actor_idx").on(t.actorUserId, t.occurredAt.desc().nullsFirst()),
    index("audit_logs_time_idx").on(t.occurredAt),
  ],
);
