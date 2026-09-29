"use strict";

const mongoose = require("mongoose");

/**
 * What the business records about a customer, as opposed to what the customer
 * records about themselves.
 *
 * A separate collection from `User` on purpose. The user document is the
 * person's own account and is serialised out to them; this is internal, it is
 * written by staff, and none of it should ever reach the customer. Keeping the
 * two apart means a mistake in the profile serializer cannot leak a sales note.
 *
 * Everything measurable -- lifetime value, order count, when they last bought --
 * is computed from orders rather than stored here. A stored copy would be one
 * more thing to keep in step, and it would be wrong the moment a refund landed.
 */

const LIFECYCLE_STAGES = [
  "lead",
  "active",
  "at-risk",
  "churned",
  "vip",
  "blocked",
];

const noteSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    author: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true },
);

const customerRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    /**
     * A stage set by hand, which overrides the one worked out from orders.
     *
     * Null means "let the data decide". Staff knowledge beats a rule of thumb:
     * somebody who has not bought in a year might be a signed contract awaiting
     * a start date, and no amount of order history will say so.
     */
    stage: { type: String, enum: LIFECYCLE_STAGES, default: null },

    tags: { type: [String], default: [], index: true },

    notes: { type: [noteSchema], default: [] },

    /** Who on the team looks after this account. */
    owner: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String, trim: true },
    },
  },
  { timestamps: true },
);

const CustomerRecord = mongoose.model("CustomerRecord", customerRecordSchema);

module.exports = { CustomerRecord, LIFECYCLE_STAGES };
