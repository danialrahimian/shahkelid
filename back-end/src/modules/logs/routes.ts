import { LOG_SOURCES } from "@shah-kelid/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { ApiError } from "../../platform/http/api-error";
import { logEntries } from "./service";

/**
 * The owner's log of everything (see ./service.ts).
 *
 *   GET /logs?source=&q=&problems=1&beforeAt=&beforeKey=&limit=
 *
 * logs:read is the owner's alone: no other system role has it.
 */

const logQuery = z
  .object({
    source: z.enum(LOG_SOURCES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    problems: z.enum(["1", "true"]).optional(),
    beforeAt: z.string().datetime().optional(),
    beforeKey: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((query) => (query.beforeAt === undefined) === (query.beforeKey === undefined), {
    message: "beforeAt and beforeKey go together",
  });

export const logsRouter = ({ db }: { db: Db }) => {
  const router = Router();

  router.get("/logs", requirePermission("logs:read"), async (req, res) => {
    const query = logQuery.safeParse(req.query);
    if (!query.success) throw new ApiError(400, "VALIDATION_FAILED", "Invalid log filter");
    const { source, q, problems, beforeAt, beforeKey, limit } = query.data;
    res.json(
      await logEntries(db, {
        source,
        q,
        problems: problems !== undefined,
        before: beforeAt && beforeKey ? { at: beforeAt, key: beforeKey } : undefined,
        limit,
      }),
    );
  });

  return router;
};
