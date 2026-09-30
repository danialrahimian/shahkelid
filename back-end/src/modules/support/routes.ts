import {
  newTicketInput,
  staffTicketReplyInput,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENTS_PER_MESSAGE,
  TICKET_STATUSES,
  ticketCategoryInput,
  ticketReplyInput,
  updateTicketInput,
  type TicketStatus,
} from "@shah-kelid/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";
import multer from "multer";

import type { Db } from "../../platform/db/client";
import { requirePermission, requireSignedIn } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { parseBody, parseId } from "../../platform/http/validate";
import { imageTypeOf, readPrivateFile } from "../files/storage";
import {
  agents,
  attachmentFileId,
  closeOwnTicket,
  customerReply,
  listCategories,
  myTicket,
  myTickets,
  openTicket,
  saveCategory,
  staffReply,
  staffTicket,
  ticketQueue,
  updateTicket,
  type Upload,
} from "./service";

/**
 * /api/v1/support: the customer's tickets.
 *
 *   GET  /support/categories
 *   GET  /support/tickets
 *   POST /support/tickets              multipart: subject, categoryId, subscriptionId?, priority, body, attachments[]
 *   GET  /support/tickets/:id          without internal notes
 *   POST /support/tickets/:id/messages multipart: body, attachments[]
 *   POST /support/tickets/:id/close
 *   GET  /support/files/:id            an attachment, to its ticket's owner or an agent
 *
 * /api/v1/staff: answering them.
 *
 *   GET   /tickets?status=&assignee=me|none|all   tickets:reply
 *   GET   /tickets/:id                            tickets:reply
 *   POST  /tickets/:id/messages                   tickets:reply  multipart: body, internal, attachments[]
 *   PATCH /tickets/:id                            tickets:reply  { priority, assignedToUserId, status }
 *   GET   /ticket-agents                          tickets:reply
 *   GET   /ticket-categories                      tickets:reply
 *   POST  /ticket-categories, PUT /ticket-categories/:id   settings:manage
 */

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TICKET_ATTACHMENT_MAX_BYTES, files: TICKET_ATTACHMENTS_PER_MESSAGE, fields: 10 },
}).array("attachments", TICKET_ATTACHMENTS_PER_MESSAGE);

const invalidAttachment = (message: string) =>
  new ApiError(400, "ATTACHMENT_INVALID", message, { fields: [{ path: "attachments", code: "ATTACHMENT_INVALID" }] });

const withAttachments = (req: Request, res: Response, next: NextFunction) =>
  attachmentUpload(req, res, (error: unknown) => (error ? next(invalidAttachment((error as Error).message)) : next()));

/** The uploaded images, each checked by its first bytes rather than by what the browser said. */
const uploadsOf = (req: Request): Upload[] => {
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (uploaded.some((file) => !imageTypeOf(file.buffer))) {
    throw invalidAttachment("Attachments must be JPEG, PNG or WebP pictures");
  }
  return uploaded.map((file) => ({ bytes: file.buffer, originalName: file.originalname }));
};

const sendFile = async (db: Db, res: Response, fileId: string | null) => {
  const file = fileId ? await readPrivateFile(db, fileId) : null;
  if (!file) throw notFound("No such file");
  res.setHeader("content-type", file.mimeType);
  res.setHeader("cache-control", "private, no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.send(file.bytes);
};

export const supportRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();
  // Enough for a conversation, not for flooding the queue.
  const perIp = limitPerIp({ redis, name: "support", windowMs: 60_000, max: 20 });
  const userId = (req: Request) => req.account!.user.id;

  router.get("/categories", requireSignedIn, async (_req, res) => {
    res.json(await listCategories(db, { activeOnly: true }));
  });

  router.get("/tickets", requireSignedIn, async (req, res) => {
    res.json(await myTickets(db, userId(req)));
  });

  router.post("/tickets", requireSignedIn, perIp, withAttachments, async (req, res) => {
    const uploads = uploadsOf(req);
    const input = parseBody(newTicketInput, req.body);
    const ticketId = await openTicket(db, userId(req), input, uploads);
    res.status(201).json(await myTicket(db, userId(req), ticketId));
  });

  router.get("/tickets/:id", requireSignedIn, async (req, res) => {
    res.json(await myTicket(db, userId(req), parseId(req.params.id)));
  });

  router.post("/tickets/:id/messages", requireSignedIn, perIp, withAttachments, async (req, res) => {
    const uploads = uploadsOf(req);
    const { body } = parseBody(ticketReplyInput, req.body);
    const ticketId = parseId(req.params.id);
    await customerReply(db, userId(req), ticketId, body, uploads);
    res.status(201).json(await myTicket(db, userId(req), ticketId));
  });

  router.post("/tickets/:id/close", requireSignedIn, async (req, res) => {
    const ticketId = parseId(req.params.id);
    await closeOwnTicket(db, userId(req), ticketId);
    res.json(await myTicket(db, userId(req), ticketId));
  });

  router.get("/files/:id", requireSignedIn, async (req, res) => {
    const fileId = await attachmentFileId(db, parseId(req.params.id), {
      userId: userId(req),
      isAgent: req.account!.access.permissions.has("tickets:reply"),
    });
    await sendFile(db, res, fileId);
  });

  return router;
};

const statusParam = (value: unknown): TicketStatus | undefined =>
  (TICKET_STATUSES as readonly unknown[]).includes(value) ? (value as TicketStatus) : undefined;

export const supportStaffRouter = ({ db }: { db: Db }) => {
  const router = Router();
  const agent = requirePermission("tickets:reply");

  router.get("/tickets", agent, async (req, res) => {
    const assignee = req.query.assignee === "me" || req.query.assignee === "none" ? req.query.assignee : "all";
    res.json(
      await ticketQueue(db, { status: statusParam(req.query.status), assignee, actorId: req.account!.user.id }),
    );
  });

  router.get("/tickets/:id", agent, async (req, res) => {
    res.json(await staffTicket(db, parseId(req.params.id)));
  });

  router.post("/tickets/:id/messages", agent, withAttachments, async (req, res) => {
    const uploads = uploadsOf(req);
    const input = parseBody(staffTicketReplyInput, req.body);
    const ticketId = parseId(req.params.id);
    await staffReply(db, staffActor(req), ticketId, input, uploads);
    res.status(201).json(await staffTicket(db, ticketId));
  });

  router.patch("/tickets/:id", agent, async (req, res) => {
    const input = parseBody(updateTicketInput, req.body);
    res.json(await updateTicket(db, staffActor(req), parseId(req.params.id), input));
  });

  router.get("/ticket-agents", agent, async (_req, res) => {
    res.json(await agents(db));
  });

  router.get("/ticket-categories", agent, async (_req, res) => {
    res.json(await listCategories(db, { activeOnly: false }));
  });

  router.post("/ticket-categories", requirePermission("settings:manage"), async (req, res) => {
    const input = parseBody(ticketCategoryInput, req.body);
    res.status(201).json(await saveCategory(db, staffActor(req), null, input));
  });

  router.put("/ticket-categories/:id", requirePermission("settings:manage"), async (req, res) => {
    const input = parseBody(ticketCategoryInput, req.body);
    res.json(await saveCategory(db, staffActor(req), parseId(req.params.id), input));
  });

  return router;
};
