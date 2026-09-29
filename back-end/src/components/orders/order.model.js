"use strict";

const mongoose = require("mongoose");

const ORDER_STATUSES = ["pending", "paid", "failed", "shipped", "cancelled"];

const orderSchema = new mongoose.Schema(
  {
    user: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      username: { type: String, required: true },
      email: { type: String, required: true },
    },
    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        /**
         * The billing term as it stood when the sale was made.
         *
         * Copied rather than looked up, like the name and the price: the
         * catalogue can change or the plan can be withdrawn, and a report on
         * last year's revenue must still know that this line covered two years
         * rather than one month. Without it, recurring revenue cannot be
         * worked out at all.
         */
        period: { type: String },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        image: { type: String },
      },
    ],
    totalPrice: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    authority: { type: String, index: true, sparse: true },
    // Set once the provider confirms. The old code read `order.refId` without
    // ever storing it, so the field was always undefined.
    refId: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

const Order = mongoose.model("Order", orderSchema);

module.exports = { Order, ORDER_STATUSES };
