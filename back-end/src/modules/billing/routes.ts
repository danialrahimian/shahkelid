import {
  RECEIPT_MAX_BYTES,
  cardTransferInput,
  createOrderInput,
  paymentCardInput,
  reviewReceiptInput,
} from "@shah-kelid/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";
import multer from "multer";
import { z } from "zod";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { requirePermission, requireSignedIn } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { parseBody, parseId } from "../../platform/http/validate";
import { imageTypeOf, readPrivateFile } from "../files/storage";
import {
  activeCards,
  allCards,
  receiptFileId,
  receipts,
  reviewReceipt,
  saveCard,
  submitCardTransfer,
} from "./card-transfer";
import { createOrder, fulfilPaidOrder, myOrder, myOrders, plansOnSale, staffOrders } from "./orders";
import { startZarinpal, zarinpalCallback } from "./zarinpal-checkout";

/**
 * /api/v1/shop — buying, for signed-in customers (plans are public):
 *
 *   GET  /shop/plans                       plans on sale
 *   GET  /shop/cards                       cards to transfer to
 *   POST /shop/orders                      { planId }, Idempotency-Key header
 *   GET  /shop/orders   GET /shop/orders/:id
 *   POST /shop/orders/:id/pay/zarinpal     → { payUrl }
 *   POST /shop/orders/:id/pay/card         multipart: receipt (image) + fields
 *
 * /api/v1/payments/zarinpal/callback — where Zarinpal sends the customer back.
 *
 * /api/v1/staff:
 *   GET  /receipts?which=waiting|decided   payments:review
 *   GET  /receipts/:paymentId/image        payments:review
 *   POST /receipts/:paymentId/review       payments:review { decision, note }
 *   GET|POST /payment-cards, PUT /payment-cards/:id   settings:manage
 *   GET  /orders?userId=&status=           orders:read
 *   POST /orders/:id/fulfil                subscriptions:manage
 */

const idempotencyKey = z.string().trim().min(8).max(100).optional();

/** One image, held in memory only long enough to check and store it. */
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES, files: 1, fields: 10 },
}).single("receipt");

const withReceipt = (req: Request, res: Response, next: NextFunction) =>
  receiptUpload(req, res, (error: unknown) =>
    error ? next(new ApiError(400, "RECEIPT_INVALID", (error as Error).message)) : next(),
  );

export const shopRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();
  const perIp = limitPerIp({ redis, name: "shop", windowMs: 60_000, max: config.checkout.requestsPerMinute });

  router.get("/shop/plans", async (_req, res) => {
    res.json(await plansOnSale(db));
  });

  router.get("/shop/cards", requireSignedIn, async (_req, res) => {
    res.json(await activeCards(db));
  });

  router.post("/shop/orders", requireSignedIn, perIp, async (req, res) => {
    const { planId } = parseBody(createOrderInput, req.body);
    const key = idempotencyKey.safeParse(req.get("idempotency-key") ?? undefined);
    if (!key.success) throw new ApiError(400, "VALIDATION_FAILED", "Idempotency-Key must be 8 to 100 characters");
    res.status(201).json(await createOrder(db, req.account!.user.id, planId, key.data));
  });

  router.get("/shop/orders", requireSignedIn, async (req, res) => {
    res.json(await myOrders(db, req.account!.user.id));
  });

  router.get("/shop/orders/:id", requireSignedIn, async (req, res) => {
    res.json(await myOrder(db, req.account!.user.id, parseId(req.params.id)));
  });

  router.post("/shop/orders/:id/pay/zarinpal", requireSignedIn, perIp, async (req, res) => {
    res.json(await startZarinpal(db, req.account!.user.id, parseId(req.params.id)));
  });

  router.post("/shop/orders/:id/pay/card", requireSignedIn, perIp, withReceipt, async (req, res) => {
    const file = req.file;
    if (!file || !imageTypeOf(file.buffer)) {
      throw new ApiError(400, "RECEIPT_INVALID", "Attach a JPEG, PNG or WebP picture of the receipt", {
        fields: [{ path: "receipt", code: "RECEIPT_INVALID" }],
      });
    }
    const input = parseBody(cardTransferInput, req.body);
    const orderId = parseId(req.params.id);
    await submitCardTransfer(db, req.account!.user.id, orderId, input, {
      bytes: file.buffer,
      originalName: file.originalname,
    });
    res.status(201).json(await myOrder(db, req.account!.user.id, orderId));
  });

  // Zarinpal redirects the customer's browser here. No session is needed:
  // the payment is found by its authority and verified with Zarinpal.
  router.get("/payments/zarinpal/callback", async (req, res) => {
    const authority = String(req.query.Authority ?? "");
    const status = String(req.query.Status ?? "");
    const orderId = /^[A-Za-z0-9]{10,64}$/.test(authority)
      ? await zarinpalCallback(db, authority, status)
      : null;
    res.redirect(303, orderId ? `${config.cors.origin}/orders/${orderId}` : `${config.cors.origin}/pricing`);
  });

  return router;
};

export const billingStaffRouter = ({ db }: { db: Db }) => {
  const router = Router();

  router.get("/receipts", requirePermission("payments:review"), async (req, res) => {
    const which = req.query.which === "decided" ? "decided" : "waiting";
    res.json(await receipts(db, which));
  });

  router.get("/receipts/:paymentId/image", requirePermission("payments:review"), async (req, res) => {
    const fileId = await receiptFileId(db, parseId(req.params.paymentId));
    const file = fileId ? await readPrivateFile(db, fileId) : null;
    if (!file) throw notFound("No such receipt");
    res.setHeader("content-type", file.mimeType);
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.send(file.bytes);
  });

  router.post("/receipts/:paymentId/review", requirePermission("payments:review"), async (req, res) => {
    const input = parseBody(reviewReceiptInput, req.body);
    res.json(await reviewReceipt(db, staffActor(req), parseId(req.params.paymentId), input));
  });

  router.get("/payment-cards", requirePermission("settings:manage"), async (_req, res) => {
    res.json(await allCards(db));
  });
  router.post("/payment-cards", requirePermission("settings:manage"), async (req, res) => {
    res.status(201).json(await saveCard(db, staffActor(req), null, parseBody(paymentCardInput, req.body)));
  });
  router.put("/payment-cards/:id", requirePermission("settings:manage"), async (req, res) => {
    const id = parseId(req.params.id);
    res.json(await saveCard(db, staffActor(req), id, parseBody(paymentCardInput, req.body)));
  });

  const ordersQuery = z.object({
    userId: z.string().uuid().optional(),
    status: z.enum(["pending", "paid", "fulfilled", "failed", "cancelled", "expired", "refunded"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  router.get("/orders", requirePermission("orders:read"), async (req, res) => {
    const filter = ordersQuery.safeParse(req.query);
    if (!filter.success) throw new ApiError(400, "VALIDATION_FAILED", "Bad query parameters");
    res.json(await staffOrders(db, filter.data));
  });
  router.post("/orders/:id/fulfil", requirePermission("subscriptions:manage"), async (req, res) => {
    res.json(await fulfilPaidOrder(db, parseId(req.params.id)));
  });

  return router;
};
