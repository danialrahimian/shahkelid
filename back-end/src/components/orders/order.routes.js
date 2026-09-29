"use strict";

const express = require("express");
const { body } = require("express-validator");
const { asyncHandler, requireAuth, validate } = require("../../middlewares");
const orderService = require("./order.service");

const router = express.Router();

// None of these endpoints checked for a session before. As with the admin
// router, the guard is per route: this router is mounted at "/", so router.use
// would answer 401 for every path the app does not define at all.

router.get(
  "/checkout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await orderService.previewOrder(req.user);
    return res.status(200).json(order);
  }),
);

/**
 * Opens a payment. The request body is deliberately ignored: the order is
 * rebuilt from the cart on the server.
 */
router.post(
  "/payment",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payment = await orderService.startPayment(req.user);
    return res.status(200).json(payment);
  }),
);

router.post(
  "/verify-payment",
  requireAuth,
  [
    body("Authority")
      .exists({ values: "falsy" })
      .withMessage("پارامتر نامعتبر"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const { Authority, Status } = req.body;
    const { alreadyPaid, order } = await orderService.confirmPayment(req.user, {
      authority: Authority,
      status: Status,
    });

    if (alreadyPaid) {
      return res
        .status(200)
        .json({ message: "قبلاً پرداخت شده", refId: order.refId });
    }
    return res.status(200).json(order);
  }),
);

router.get(
  "/get-invoices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const invoices = await orderService.listInvoices(req.user);
    return res.status(200).json(invoices);
  }),
);

module.exports = { orderRouter: router };
