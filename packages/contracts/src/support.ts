import { z } from "zod";

import type { SubscriptionStatus } from "./subscriptions.ts";

/**
 * Support tickets, shared by the customer's and staff's screens and the API.
 *
 * A ticket's status says who it is waiting on, not a vague "open": waiting
 * for staff, waiting for the customer, resolved, or closed.
 */

export const TICKET_STATUSES = ["awaiting_staff", "awaiting_customer", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Customers may ask for up to "high"; "urgent" is staff's call. */
export const CUSTOMER_PRIORITIES = ["low", "normal", "high"] as const;

/** Screenshots: images only, a few per message, small enough for a phone. */
export const TICKET_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TICKET_ATTACHMENTS_PER_MESSAGE = 3;

const body = z.string().trim().min(1, "REQUIRED").max(10_000, "TOO_LONG");

/** A new ticket (sent as multipart form fields, so all arrive as text). */
export const newTicketInput = z.object({
  subject: z.string().trim().min(3, "TOO_SHORT").max(160, "TOO_LONG"),
  categoryId: z.string().uuid("REQUIRED"),
  subscriptionId: z
    .string()
    .uuid()
    .or(z.literal(""))
    .optional()
    .transform((value) => value || undefined),
  priority: z.enum(CUSTOMER_PRIORITIES).default("normal"),
  body,
});
export type NewTicketInput = z.input<typeof newTicketInput>;

export const ticketReplyInput = z.object({ body });
export type TicketReplyInput = z.input<typeof ticketReplyInput>;

/** A staff reply, or a note only staff see. Multipart fields: "true" / "false". */
export const staffTicketReplyInput = z.object({
  body,
  internal: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(false)
    .transform((value) => value === true || value === "true"),
});
export type StaffTicketReplyInput = z.input<typeof staffTicketReplyInput>;

/** What staff change about a ticket: who has it, how urgent, where it stands. */
export const updateTicketInput = z.object({
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  status: z.enum(TICKET_STATUSES).optional(),
});
export type UpdateTicketInput = z.input<typeof updateTicketInput>;

export const ticketCategoryInput = z.object({
  nameFa: z.string().trim().min(1, "REQUIRED").max(80, "TOO_LONG"),
  nameEn: z.string().trim().min(1, "REQUIRED").max(80, "TOO_LONG"),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export type TicketCategoryInput = z.input<typeof ticketCategoryInput>;

export type TicketCategoryView = { id: string; nameFa: string; nameEn: string; sortOrder: number; isActive: boolean };

export type TicketAttachmentView = { id: string; name: string; sizeBytes: number };

export type TicketMessageView = {
  id: string;
  authorKind: "customer" | "staff" | "system";
  /** Staff are shown to customers by role, not by name. */
  authorName: string | null;
  body: string;
  /** Staff only: a note inside the thread the customer never sees. */
  isInternal: boolean;
  attachments: TicketAttachmentView[];
  createdAt: string;
};

export type TicketSummary = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: { id: string; name: string } | null;
  lastMessageAt: string;
  createdAt: string;
};

/** The customer's view of one ticket: no internal notes, ever. */
export type TicketView = TicketSummary & {
  subscription: { id: string; planName: string } | null;
  messages: TicketMessageView[];
};

/** A ticket in the staff queue. */
export type StaffTicketSummary = TicketSummary & {
  customer: { id: string; email: string };
  assignedTo: { id: string; email: string } | null;
  /** How long it has waited for staff, when it is waiting for staff. */
  waitingSince: string | null;
};

/** One ticket for staff: the whole thread, and what support needs beside it. */
export type StaffTicketView = StaffTicketSummary & {
  subscription: { id: string; planName: string; status: SubscriptionStatus } | null;
  messages: TicketMessageView[];
};
