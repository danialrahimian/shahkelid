import {
  CUSTOMER_SORTS,
  CUSTOMER_STAGES,
  customerNoteInput,
  customerStatusInput,
  customerStageInput,
  customerTagsInput,
} from "@shah-kelid/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError } from "../../platform/http/api-error";
import { parseBody, parseId } from "../../platform/http/validate";
import { deleteAccount, setAccountStatus } from "../identity/delete-account";
import { addNote, customerDetail, deleteNote, listCustomers, segments, setStage, setTags } from "./service";

/**
 * /api/v1/staff: customers, as the team sees them.
 *
 *   GET    /customers?search=&stage=&tagId=&sort=joined|value|recent&limit=&offset=   customers:read
 *   GET    /customers/segments                   customers:read — how many at each stage, and each tag
 *   GET    /customers/:id                        customers:read — with services and notes
 *   POST   /customers/:id/notes                  customers:manage { body }
 *   DELETE /customers/:id/notes/:noteId          customers:manage
 *   PUT    /customers/:id/stage                  customers:manage { stage | null }
 *   PUT    /customers/:id/tags                   customers:manage { tags: [names] }
 *   PUT    /customers/:id/status                 customers:manage { active | suspended }
 *   DELETE /customers/:id                        customers:manage — deletes the account (not a staff one)
 */

const listQuery = z.object({
  search: z.string().max(200).optional(),
  stage: z.enum(CUSTOMER_STAGES).optional(),
  tagId: z.string().uuid().optional(),
  sort: z.enum(CUSTOMER_SORTS).default("joined"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const crmRouter = ({ db }: { db: Db }) => {
  const router = Router();
  const read = requirePermission("customers:read");
  const manage = requirePermission("customers:manage");

  router.get("/customers", read, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_FAILED", "Bad query parameters");
    res.json(await listCustomers(db, parsed.data));
  });

  router.get("/customers/segments", read, async (_req, res) => {
    res.json(await segments(db));
  });

  router.get("/customers/:id", read, async (req, res) => {
    res.json(await customerDetail(db, parseId(req.params.id)));
  });

  router.post("/customers/:id/notes", manage, async (req, res) => {
    const { body } = parseBody(customerNoteInput, req.body);
    const userId = parseId(req.params.id);
    await addNote(db, staffActor(req), userId, body);
    res.status(201).json(await customerDetail(db, userId));
  });

  router.delete("/customers/:id/notes/:noteId", manage, async (req, res) => {
    const userId = parseId(req.params.id);
    await deleteNote(db, staffActor(req), userId, parseId(req.params.noteId));
    res.json(await customerDetail(db, userId));
  });

  router.put("/customers/:id/stage", manage, async (req, res) => {
    const { stage } = parseBody(customerStageInput, req.body);
    const userId = parseId(req.params.id);
    await setStage(db, staffActor(req), userId, stage);
    res.json(await customerDetail(db, userId));
  });

  router.put("/customers/:id/tags", manage, async (req, res) => {
    const { tags } = parseBody(customerTagsInput, req.body);
    const userId = parseId(req.params.id);
    await setTags(db, staffActor(req), userId, tags);
    res.json(await customerDetail(db, userId));
  });

  router.put("/customers/:id/status", manage, async (req, res) => {
    const { status } = parseBody(customerStatusInput, req.body);
    const userId = parseId(req.params.id);
    await setAccountStatus(db, staffActor(req), userId, status);
    res.json(await customerDetail(db, userId));
  });

  router.delete("/customers/:id", manage, async (req, res) => {
    res.json(await deleteAccount(db, parseId(req.params.id), staffActor(req)));
  });

  return router;
};
