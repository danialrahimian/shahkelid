import {
  SUBSCRIPTION_ACTIONS,
  SUBSCRIPTION_STATUSES,
  createSubscriptionInput,
} from "@shah-kelid/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError } from "../../platform/http/api-error";
import { parseBody, parseId } from "../../platform/http/validate";
import { performAction } from "./actions";
import {
  createSubscription,
  customerDetail,
  findSubscriptionView,
  listCustomers,
  listSubscriptions,
  subscriptionHistory,
} from "./service";

/**
 * /api/v1/staff: customers and their subscriptions.
 *
 *   GET  /customers?search=              customers:read
 *   GET  /customers/:id                  customers:read, with subscriptions and usage
 *   GET  /subscriptions?status=&userId=  customers:read
 *   GET  /subscriptions/:id              customers:read, with its history
 *   POST /subscriptions                  subscriptions:manage — make one from a plan
 *   POST /subscriptions/:id/actions/:action   subscriptions:manage
 *        sync | reset_usage | revoke_link | disable | enable | retry | delete
 */

const page = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const customersQuery = z.object({ search: z.string().max(200).optional(), ...page });
const subscriptionsQuery = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  ...page,
});

const query = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "VALIDATION_FAILED", "Bad query parameters");
  return result.data;
};

export const subscriptionsRouter = ({ db }: { db: Db }) => {
  const router = Router();

  router.get("/customers", requirePermission("customers:read"), async (req, res) => {
    res.json(await listCustomers(db, query(customersQuery, req.query)));
  });
  router.get("/customers/:id", requirePermission("customers:read"), async (req, res) => {
    res.json(await customerDetail(db, parseId(req.params.id)));
  });

  router.get("/subscriptions", requirePermission("customers:read"), async (req, res) => {
    res.json(await listSubscriptions(db, query(subscriptionsQuery, req.query)));
  });
  router.get("/subscriptions/:id", requirePermission("customers:read"), async (req, res) => {
    const id = parseId(req.params.id);
    res.json({
      subscription: await findSubscriptionView(db, id),
      history: await subscriptionHistory(db, id),
    });
  });

  router.post("/subscriptions", requirePermission("subscriptions:manage"), async (req, res) => {
    const input = parseBody(createSubscriptionInput, req.body);
    const actor = staffActor(req);
    const id = await db.transaction((tx) => createSubscription(tx, actor, input));
    res.status(201).json(await findSubscriptionView(db, id));
  });

  router.post(
    "/subscriptions/:id/actions/:action",
    requirePermission("subscriptions:manage"),
    async (req, res) => {
      const action = z.enum(SUBSCRIPTION_ACTIONS).safeParse(req.params.action);
      if (!action.success) throw new ApiError(404, "NOT_FOUND", "No such action");
      res.json(await performAction(db, staffActor(req), parseId(req.params.id), action.data));
    },
  );

  return router;
};
