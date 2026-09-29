"use strict";

const mongoose = require("mongoose");

/**
 * The only billing terms a plan may run for.
 *
 * This used to be free text, and the catalogue filled up with "/ mo",
 * "/ 6 mo", "/ yr" and "6 mounth" side by side. Every one of those had to be
 * parsed before a price per month could be shown, and a typo silently produced
 * a plan nobody could price. Three fixed values remove the guesswork: the
 * pricing page groups by them directly, and the admin form offers nothing else.
 *
 * The strings are what a person would write, so they read correctly wherever
 * they are shown without a lookup table.
 */
const BILLING_PERIODS = ["1 month", "1 year", "2 years"];

/** How many months each term covers. Used wherever a rate is worked out. */
const PERIOD_MONTHS = {
  "1 month": 1,
  "1 year": 12,
  "2 years": 24,
};

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    period: {
      type: String,
      required: true,
      trim: true,
      enum: {
        values: BILLING_PERIODS,
        message: `period must be one of: ${BILLING_PERIODS.join(", ")}`,
      },
      index: true,
    },
    price: { type: Number, required: true, min: 0 },
    perks: { type: [String], required: true, default: [] },
    image: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", productSchema);

module.exports = { Product, BILLING_PERIODS, PERIOD_MONTHS };
