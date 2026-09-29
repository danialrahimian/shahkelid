import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "../identity/schema";
import { at, createdAt, id, updatedAt } from "../../platform/db/columns";

// SMS is left out: email and Telegram are enough (the owner's decision).
// Adding it later is one enum value and one channel adapter.
export const notificationChannel = pgEnum("notification_channel", ["email", "telegram"]);
export const notificationStatus = pgEnum("notification_status", [
  "queued",
  "sent",
  "failed",
  "skipped",
]);

/** Editable from the dashboard. Variables look like {{plan_name}}. */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: id(),
    key: text("key").notNull(), // expiry_3d, usage_80, subscription_ready, ...
    channel: notificationChannel("channel").notNull(),
    locale: text("locale").notNull().default("fa"),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("notification_templates_locale", sql`${t.locale} in ('fa', 'en')`),
    unique("notification_templates_key_channel_locale_key").on(t.key, t.channel, t.locale),
  ],
);

/**
 * Every message sent, or not sent and why. Shown on the customer's profile.
 * (campaign_id arrives with campaigns in phase 6.)
 */
export const notifications = pgTable(
  "notifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: notificationChannel("channel").notNull(),
    templateKey: text("template_key").notNull(),
    recipient: text("recipient").notNull(),
    status: notificationStatus("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: at("sent_at"),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
    index("notifications_queued_idx").on(t.createdAt).where(sql`${t.status} = 'queued'`),
  ],
);
