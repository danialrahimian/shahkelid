import { randomUUID } from "node:crypto";

import type {
  StaffTicketSummary,
  StaffTicketView,
  TicketAttachmentView,
  TicketCategoryView,
  TicketMessageView,
  TicketStatus,
  TicketSummary,
  TicketView,
  newTicketInput,
  ticketCategoryInput,
  updateTicketInput,
} from "@shah-kelid/contracts";
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { writeAudit } from "../access/audit";
import { rolePermissions, userRoles } from "../access/schema";
import { savePrivateImage } from "../files/storage";
import { files } from "../files/schema";
import { accountLabel, optionalAccountLabel, users } from "../identity/schema";
import { deliverEmail } from "../notifications/email";
import { notifyCustomer } from "../notifications/notify";
import { plans } from "../catalog/schema";
import { subscriptions } from "../subscriptions/schema";
import { ticketCategories, ticketMessageFiles, ticketMessages, tickets } from "./schema";

/**
 * Support tickets.
 *
 * A ticket says who it is waiting on. A customer's message puts it back with
 * staff; a staff reply puts it with the customer and emails them. A note
 * marked internal is for staff only: it changes nothing, notifies nobody,
 * and never appears in anything a customer can read (the customer's views
 * filter it out in the query itself, not in the screen).
 */

export const TICKET_ALERT_TOPIC = "support.ticket_alert";
const QUIET_DAYS = 7;

export type Upload = { bytes: Buffer; originalName: string };

type TicketRow = typeof tickets.$inferSelect;

// --------------------------------------------------------------- categories

const categoryView = (row: typeof ticketCategories.$inferSelect): TicketCategoryView => ({
  id: row.id,
  nameFa: row.nameFa,
  nameEn: row.nameEn,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});

export const listCategories = async (db: Db, { activeOnly }: { activeOnly: boolean }) =>
  (
    await db
      .select()
      .from(ticketCategories)
      .where(activeOnly ? eq(ticketCategories.isActive, true) : undefined)
      .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.nameFa))
  ).map(categoryView);

export const saveCategory = async (
  db: Db,
  actor: StaffActor,
  id: string | null,
  input: z.output<typeof ticketCategoryInput>,
) =>
  db.transaction(async (tx) => {
    const [before] = id ? await tx.select().from(ticketCategories).where(eq(ticketCategories.id, id)) : [];
    if (id && !before) throw notFound("No such category");
    const [row] = id
      ? await tx.update(ticketCategories).set(input).where(eq(ticketCategories.id, id)).returning()
      : await tx.insert(ticketCategories).values(input).returning();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: id ? "ticket_category.updated" : "ticket_category.created",
      entityType: "ticket_category",
      entityId: row!.id,
      before: before ?? null,
      after: row,
    });
    return categoryView(row!);
  });

// ------------------------------------------------------------------ agents

/** Everyone who may answer tickets: they are who a new ticket is announced to, and who it can be given to. */
export const agents = async (executor: Executor) =>
  executor
    .selectDistinct({ id: users.id, email: accountLabel(), address: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(
      and(eq(rolePermissions.permission, "tickets:reply"), eq(users.status, "active"), isNull(users.deletedAt)),
    )
    .orderBy(asc(accountLabel()));

/** Tells the agents about a ticket, through the outbox (sent by the worker). */
const alertAgents = (executor: Executor, ticket: TicketRow, what: "new" | "reply") =>
  recordEvent(executor, {
    topic: TICKET_ALERT_TOPIC,
    aggregateType: "ticket",
    aggregateId: ticket.id,
    payload: { ticketId: ticket.id, what, eventId: randomUUID() },
  });

/**
 * Sends a ticket alert: to whoever has the ticket, or to every agent when
 * nobody does yet.
 */
export const deliverTicketAlert = async (db: Db, payload: { ticketId: string; what: "new" | "reply" }) => {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, payload.ticketId));
  if (!ticket) return 0;
  const recipients = ticket.assignedToUserId
    ? await db.select({ address: users.email }).from(users).where(eq(users.id, ticket.assignedToUserId))
    : await agents(db);
  const link = `${config.cors.origin}/staff/tickets/${ticket.id}`;
  // One agent's mailbox failing does not keep the others from hearing; the
  // job is retried only when nobody was reached, so nobody is told twice.
  let delivered = 0;
  const failures: unknown[] = [];
  for (const { address } of recipients) {
    // A username-only agent has no mailbox to tell.
    if (!address) continue;
    try {
      await deliverEmail({
        to: address,
        subject:
          payload.what === "new"
            ? `[تیکت ${ticket.number}] تازه: ${ticket.subject}`
            : `[تیکت ${ticket.number}] پاسخ مشتری: ${ticket.subject}`,
        text: `تیکت ${ticket.number} (${ticket.priority}) منتظر پشتیبانی است:\n${link}`,
      });
      delivered += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (delivered === 0 && failures.length > 0) {
    throw new AggregateError(failures, "No agent could be emailed about the ticket");
  }
  return delivered;
};

// ----------------------------------------------------------------- reading

const author = alias(users, "author");

const messagesOf = async (executor: Executor, ticketId: string, { withInternal }: { withInternal: boolean }) => {
  const rows = await executor
    .select({ message: ticketMessages, authorEmail: optionalAccountLabel(author) })
    .from(ticketMessages)
    .leftJoin(author, eq(author.id, ticketMessages.authorUserId))
    .where(
      and(eq(ticketMessages.ticketId, ticketId), withInternal ? undefined : eq(ticketMessages.isInternal, false)),
    )
    .orderBy(asc(ticketMessages.createdAt));
  const attachments = rows.length
    ? await executor
        .select({ messageId: ticketMessageFiles.messageId, file: files })
        .from(ticketMessageFiles)
        .innerJoin(files, eq(files.id, ticketMessageFiles.fileId))
        .where(
          inArray(
            ticketMessageFiles.messageId,
            rows.map((row) => row.message.id),
          ),
        )
    : [];

  return rows.map(({ message, authorEmail }): TicketMessageView => ({
    id: message.id,
    authorKind: message.authorKind,
    // Customers see "support", not a colleague's address.
    authorName: withInternal ? (authorEmail ?? null) : null,
    body: message.body,
    isInternal: message.isInternal,
    attachments: attachments
      .filter((attachment) => attachment.messageId === message.id)
      .map(({ file }): TicketAttachmentView => ({ id: file.id, name: file.originalName, sizeBytes: file.sizeBytes })),
    createdAt: message.createdAt.toISOString(),
  }));
};

const summaryOf = (ticket: TicketRow, categoryName: string | null): TicketSummary => ({
  id: ticket.id,
  number: ticket.number,
  subject: ticket.subject,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.categoryId && categoryName ? { id: ticket.categoryId, name: categoryName } : null,
  lastMessageAt: ticket.lastMessageAt.toISOString(),
  createdAt: ticket.createdAt.toISOString(),
});

const ownTicket = async (executor: Executor, userId: string, ticketId: string) => {
  const [ticket] = await executor
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.userId, userId)));
  if (!ticket) throw notFound("No such ticket");
  return ticket;
};

export const myTickets = async (db: Db, userId: string) =>
  (
    await db
      .select({ ticket: tickets, categoryName: ticketCategories.nameFa })
      .from(tickets)
      .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
      .where(eq(tickets.userId, userId))
      .orderBy(desc(tickets.lastMessageAt))
  ).map(({ ticket, categoryName }) => summaryOf(ticket, categoryName));

export const myTicket = async (db: Db, userId: string, ticketId: string): Promise<TicketView> => {
  const ticket = await ownTicket(db, userId, ticketId);
  const [category] = ticket.categoryId
    ? await db.select().from(ticketCategories).where(eq(ticketCategories.id, ticket.categoryId))
    : [];
  const [subscription] = ticket.subscriptionId
    ? await db
        .select({ id: subscriptions.id, planName: plans.name })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.id, ticket.subscriptionId))
    : [];
  return {
    ...summaryOf(ticket, category?.nameFa ?? null),
    subscription: subscription ?? null,
    messages: await messagesOf(db, ticket.id, { withInternal: false }),
  };
};

// ---------------------------------------------------------------- writing

const attach = async (tx: Executor, messageId: string, uploads: Upload[], uploadedBy: string) => {
  for (const upload of uploads) {
    const file = await savePrivateImage(tx, {
      bytes: upload.bytes,
      purpose: "ticket_attachment",
      originalName: upload.originalName,
      uploadedBy,
    });
    await tx.insert(ticketMessageFiles).values({ messageId, fileId: file.id });
  }
};

export const openTicket = async (
  db: Db,
  userId: string,
  input: z.output<typeof newTicketInput>,
  uploads: Upload[],
) => {
  const [category] = await db
    .select()
    .from(ticketCategories)
    .where(and(eq(ticketCategories.id, input.categoryId), eq(ticketCategories.isActive, true)));
  if (!category) throw notFound("No such category");
  if (input.subscriptionId) {
    const [own] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, input.subscriptionId), eq(subscriptions.userId, userId)));
    if (!own) throw notFound("No such subscription");
  }

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        userId,
        subject: input.subject,
        categoryId: category.id,
        subscriptionId: input.subscriptionId ?? null,
        priority: input.priority,
      })
      .returning();
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId: ticket!.id, authorUserId: userId, authorKind: "customer", body: input.body })
      .returning();
    await attach(tx, message!.id, uploads, userId);
    await alertAgents(tx, ticket!, "new");
    return ticket!.id;
  });
};

export const customerReply = async (db: Db, userId: string, ticketId: string, body: string, uploads: Upload[]) =>
  db.transaction(async (tx) => {
    const ticket = await ownTicket(tx, userId, ticketId);
    if (ticket.status === "closed") {
      throw new ApiError(409, "TICKET_CLOSED", "This ticket is closed; open a new one");
    }
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId, authorUserId: userId, authorKind: "customer", body })
      .returning();
    await attach(tx, message!.id, uploads, userId);
    // Back with staff, even if it had been marked resolved.
    const [updated] = await tx
      .update(tickets)
      .set({ status: "awaiting_staff", lastMessageAt: new Date(), resolvedAt: null })
      .where(eq(tickets.id, ticketId))
      .returning();
    await alertAgents(tx, updated!, "reply");
  });

export const closeOwnTicket = async (db: Db, userId: string, ticketId: string) => {
  await ownTicket(db, userId, ticketId);
  await db.update(tickets).set({ status: "closed", closedAt: new Date() }).where(eq(tickets.id, ticketId));
};

/** A file on a ticket: its owner may read it (unless it is on an internal note); agents may read any. */
export const attachmentFileId = async (
  db: Db,
  fileId: string,
  viewer: { userId: string; isAgent: boolean },
) => {
  const [row] = await db
    .select({ ownerId: tickets.userId, isInternal: ticketMessages.isInternal })
    .from(ticketMessageFiles)
    .innerJoin(ticketMessages, eq(ticketMessages.id, ticketMessageFiles.messageId))
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .where(eq(ticketMessageFiles.fileId, fileId));
  if (!row) return null;
  if (viewer.isAgent) return fileId;
  return row.ownerId === viewer.userId && !row.isInternal ? fileId : null;
};

// ------------------------------------------------------------------- staff

const customer = alias(users, "customer");
const assignee = alias(users, "assignee");

const staffRows = (db: Executor) =>
  db
    .select({
      ticket: tickets,
      categoryName: ticketCategories.nameFa,
      customerEmail: accountLabel(customer),
      assigneeEmail: optionalAccountLabel(assignee),
    })
    .from(tickets)
    .innerJoin(customer, eq(customer.id, tickets.userId))
    .leftJoin(assignee, eq(assignee.id, tickets.assignedToUserId))
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId));

type StaffRow = Awaited<ReturnType<ReturnType<typeof staffRows>["where"]>>[number];

const staffSummary = (row: StaffRow): StaffTicketSummary => ({
  ...summaryOf(row.ticket, row.categoryName),
  customer: { id: row.ticket.userId, email: row.customerEmail },
  assignedTo:
    row.ticket.assignedToUserId && row.assigneeEmail
      ? { id: row.ticket.assignedToUserId, email: row.assigneeEmail }
      : null,
  waitingSince: row.ticket.status === "awaiting_staff" ? row.ticket.lastMessageAt.toISOString() : null,
});

/**
 * The queue. Waiting for staff: the most urgent first, then the one that has
 * waited longest. Anything else: the most recently active first.
 */
export const ticketQueue = async (
  db: Db,
  { status, assignee: who, actorId }: { status?: TicketStatus; assignee: "me" | "none" | "all"; actorId: string },
) => {
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(tickets.status, status));
  if (who === "me") conditions.push(eq(tickets.assignedToUserId, actorId));
  if (who === "none") conditions.push(sql`${tickets.assignedToUserId} is null`);
  const rows = await staffRows(db)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      ...(status === "awaiting_staff"
        ? [desc(tickets.priority), asc(tickets.lastMessageAt)]
        : [desc(tickets.lastMessageAt)]),
    )
    .limit(200);
  return rows.map(staffSummary);
};

export const staffTicket = async (db: Executor, ticketId: string): Promise<StaffTicketView> => {
  const [row] = await staffRows(db).where(eq(tickets.id, ticketId));
  if (!row) throw notFound("No such ticket");
  const [subscription] = row.ticket.subscriptionId
    ? await db
        .select({ id: subscriptions.id, planName: plans.name, status: subscriptions.status })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.id, row.ticket.subscriptionId))
    : [];
  return {
    ...staffSummary(row),
    subscription: subscription ?? null,
    messages: await messagesOf(db, ticketId, { withInternal: true }),
  };
};

export const staffReply = async (
  db: Db,
  actor: StaffActor,
  ticketId: string,
  { body, internal }: { body: string; internal: boolean },
  uploads: Upload[],
) =>
  db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (!ticket) throw notFound("No such ticket");
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId, authorUserId: actor.userId, authorKind: "staff", body, isInternal: internal })
      .returning();
    await attach(tx, message!.id, uploads, actor.userId);
    if (internal) return; // a note among staff: nothing moves, nobody is told

    await tx
      .update(tickets)
      .set({
        status: "awaiting_customer",
        lastMessageAt: new Date(),
        // Whoever answers an unassigned ticket has it from now on.
        assignedToUserId: ticket.assignedToUserId ?? actor.userId,
      })
      .where(eq(tickets.id, ticketId));
    await notifyCustomer(tx, ticket.userId, "ticket_reply", {
      ticket_subject: ticket.subject,
      ticket_url: `${config.cors.origin}/support/${ticket.id}`,
    });
  });

export const updateTicket = async (
  db: Db,
  actor: StaffActor,
  ticketId: string,
  input: z.output<typeof updateTicketInput>,
) =>
  db.transaction(async (tx) => {
    const [before] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (!before) throw notFound("No such ticket");
    if (input.assignedToUserId) {
      const allowed = await agents(tx);
      if (!allowed.some((agent) => agent.id === input.assignedToUserId)) {
        throw new ApiError(400, "VALIDATION_FAILED", "That person cannot answer tickets", {
          fields: [{ path: "assignedToUserId", code: "REQUIRED" }],
        });
      }
    }
    const change: Partial<typeof tickets.$inferInsert> = {};
    if (input.priority) change.priority = input.priority;
    if (input.assignedToUserId !== undefined) change.assignedToUserId = input.assignedToUserId;
    if (input.status) {
      change.status = input.status;
      change.resolvedAt = input.status === "resolved" ? new Date() : before.resolvedAt;
      change.closedAt = input.status === "closed" ? new Date() : null;
    }
    await tx.update(tickets).set(change).where(eq(tickets.id, ticketId));
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "ticket.updated",
      entityType: "ticket",
      entityId: ticketId,
      before: { priority: before.priority, assignedToUserId: before.assignedToUserId, status: before.status },
      after: input,
    });
    return staffTicket(tx, ticketId);
  });

/**
 * Tickets waiting on the customer for a week are marked resolved, with a
 * note in the thread. The customer can still reply, which reopens it.
 */
export const resolveQuietTickets = async (db: Db, now = new Date()) => {
  const quiet = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.status, "awaiting_customer"),
        lt(tickets.lastMessageAt, new Date(now.getTime() - QUIET_DAYS * 86_400_000)),
      ),
    );
  for (const ticket of quiet) {
    await db.transaction(async (tx) => {
      await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        authorKind: "system",
        body: "این تیکت یک هفته منتظر پاسخ شما بود و حل‌شده علامت خورد. اگر هنوز مشکلی هست، همین‌جا بنویسید تا دوباره باز شود.",
      });
      await tx
        .update(tickets)
        .set({ status: "resolved", resolvedAt: now })
        .where(and(eq(tickets.id, ticket.id), eq(tickets.status, "awaiting_customer")));
    });
  }
  return quiet.length;
};
