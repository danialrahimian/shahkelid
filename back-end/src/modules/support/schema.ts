import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { files } from "../files/schema";
import { users } from "../identity/schema";
import { subscriptions } from "../subscriptions/schema";
import { at, createdAt, id, updatedAt } from "../../platform/db/columns";

export const ticketCategories = pgTable("ticket_categories", {
  id: id(),
  nameFa: text("name_fa").notNull(),
  nameEn: text("name_en").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

// Who the ticket is waiting on, rather than a vague "open".
export const ticketStatus = pgEnum("ticket_status", [
  "awaiting_staff",
  "awaiting_customer",
  "resolved",
  "closed",
]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);
export const ticketChannel = pgEnum("ticket_channel", ["web", "telegram", "email"]);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    number: bigint("number", { mode: "number" })
      .notNull()
      .unique()
      .generatedAlwaysAsIdentity({ startWith: 1001 }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    categoryId: uuid("category_id").references(() => ticketCategories.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    status: ticketStatus("status").notNull().default("awaiting_staff"),
    priority: ticketPriority("priority").notNull().default("normal"),
    channel: ticketChannel("channel").notNull().default("web"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastMessageAt: at("last_message_at").notNull().defaultNow(),
    resolvedAt: at("resolved_at"),
    closedAt: at("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("tickets_subject_length", sql`char_length(${t.subject}) between 3 and 160`),
    // the staff queue: what is waiting, most urgent and oldest first
    index("tickets_queue_idx")
      .on(t.priority, t.lastMessageAt)
      .where(sql`${t.status} = 'awaiting_staff'`),
    index("tickets_assignee_idx")
      .on(t.assignedToUserId, t.status)
      .where(sql`${t.assignedToUserId} is not null`),
    index("tickets_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

export const messageAuthor = pgEnum("message_author", ["customer", "staff", "system"]);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorKind: messageAuthor("author_kind").notNull(),
    body: text("body").notNull(),
    // a staff-only note inside the thread; never shown to the customer
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check("ticket_messages_body_length", sql`char_length(${t.body}) between 1 and 10000`),
    check(
      "ticket_messages_internal_is_staff",
      sql`not ${t.isInternal} or ${t.authorKind} = 'staff'`,
    ),
    index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt),
  ],
);

export const ticketMessageFiles = pgTable(
  "ticket_message_files",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => ticketMessages.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileId] }),
    // serving an attachment starts from the file
    index("ticket_message_files_file_idx").on(t.fileId),
  ],
);
