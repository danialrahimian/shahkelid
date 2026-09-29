"use strict";

const mongoose = require("mongoose");

const { CustomerRecord, LIFECYCLE_STAGES } = require("./crm.model");
const { Order } = require("../orders/order.model");
const { User } = require("../users/user.model");
const { daysSince } = require("../../libraries/time/date-range");
const {
  badRequest,
  notFound,
} = require("../../libraries/errors/app-error");

/**
 * The customer view: who they are, what they have bought, and what the team
 * knows about them.
 *
 * Every measurable field is derived from orders at read time rather than kept
 * on the customer. A stored lifetime value is a number that starts drifting
 * the moment anything happens elsewhere, and there is no way to tell by looking
 * whether it is still true.
 */

const MAX_PAGE_SIZE = 100;

/** How long since the last purchase before an account is treated as slipping. */
const AT_RISK_AFTER_DAYS = 60;
const CHURNED_AFTER_DAYS = 180;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertValidId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest(`invalid ${label}`);
  }
};

const money = (value) => Math.round(value * 100) / 100;

/**
 * Where an account stands, worked out from what it has actually done.
 *
 * Deliberately simple and stated in the response, so a reader knows the rule
 * rather than trusting a label. A stage set by hand always wins.
 */
const derivedStage = ({ paidOrders, lastOrderAt }) => {
  if (paidOrders === 0) return "lead";

  const days = daysSince(lastOrderAt);
  if (days === null) return "active";
  if (days > CHURNED_AFTER_DAYS) return "churned";
  if (days > AT_RISK_AFTER_DAYS) return "at-risk";
  return "active";
};

/** Per-customer purchase metrics, in one pass over the orders. */
const metricsByCustomer = async (userIds) => {
  const rows = await Order.aggregate([
    {
      $match: {
        "user.userId": { $in: userIds },
      },
    },
    {
      $group: {
        _id: "$user.userId",
        // Only paid orders are money; the rest are counted separately so the
        // team can see somebody who keeps starting and abandoning checkouts.
        lifetimeValue: {
          $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$totalPrice", 0] },
        },
        paidOrders: {
          $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
        },
        failedOrders: {
          $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
        },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        firstOrderAt: {
          $min: { $cond: [{ $eq: ["$status", "paid"] }, "$paidAt", null] },
        },
        lastOrderAt: {
          $max: { $cond: [{ $eq: ["$status", "paid"] }, "$paidAt", null] },
        },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
};

/** Joins an account, its purchase history and the team's own record of it. */
const toCustomer = (user, metrics, record) => {
  const paidOrders = metrics?.paidOrders ?? 0;
  const lifetimeValue = money(metrics?.lifetimeValue ?? 0);
  const lastOrderAt = metrics?.lastOrderAt ?? null;

  const computed = derivedStage({ paidOrders, lastOrderAt });

  return {
    userId: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar ?? null,
    displayName: user.displayName ?? "",
    country: user.country ?? "",
    phone: user.phone ?? "",
    joinedAt: user.createdAt,

    lifetimeValue,
    paidOrders,
    failedOrders: metrics?.failedOrders ?? 0,
    pendingOrders: metrics?.pendingOrders ?? 0,
    averageOrderValue: paidOrders > 0 ? money(lifetimeValue / paidOrders) : 0,
    firstOrderAt: metrics?.firstOrderAt ?? null,
    lastOrderAt,
    daysSinceLastOrder: daysSince(lastOrderAt),
    cartItems: user.cart?.items?.length ?? 0,

    /** What the rule says, always present so the reason is visible. */
    computedStage: computed,
    /** What a person set, when they have. */
    stageOverride: record?.stage ?? null,
    /** What to show: the override if there is one. */
    stage: record?.stage ?? computed,

    tags: record?.tags ?? [],
    owner: record?.owner?.userId ? record.owner : null,
    noteCount: record?.notes?.length ?? 0,
  };
};

/**
 * The customer list.
 *
 * Searching, filtering by stage and sorting all happen after the join, because
 * the interesting fields -- lifetime value, last order, stage -- do not exist on
 * any single collection. The page is cut at the end for the same reason: a
 * database-side limit would page over the wrong set.
 */
const listCustomers = async (query = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || 20, 1),
    MAX_PAGE_SIZE,
  );

  const filter = {};
  if (query.search) {
    const pattern = escapeRegex(String(query.search));
    filter.$or = [
      { username: { $regex: pattern, $options: "i" } },
      { email: { $regex: pattern, $options: "i" } },
      { displayName: { $regex: pattern, $options: "i" } },
    ];
  }

  const users = await User.find(filter).lean();
  const userIds = users.map((user) => user._id);

  const [metrics, records] = await Promise.all([
    metricsByCustomer(userIds),
    CustomerRecord.find({ userId: { $in: userIds } }).lean(),
  ]);

  const recordsByUser = new Map(
    records.map((record) => [String(record.userId), record]),
  );

  let customers = users.map((user) =>
    toCustomer(user, metrics.get(String(user._id)), recordsByUser.get(String(user._id))),
  );

  if (query.stage) {
    const wanted = String(query.stage);
    if (!LIFECYCLE_STAGES.includes(wanted)) {
      throw badRequest(`stage must be one of: ${LIFECYCLE_STAGES.join(", ")}`);
    }
    customers = customers.filter((customer) => customer.stage === wanted);
  }

  if (query.tag) {
    const wanted = String(query.tag);
    customers = customers.filter((customer) => customer.tags.includes(wanted));
  }

  const sorters = {
    value: (a, b) => b.lifetimeValue - a.lifetimeValue,
    orders: (a, b) => b.paidOrders - a.paidOrders,
    recent: (a, b) =>
      new Date(b.lastOrderAt ?? 0).getTime() -
      new Date(a.lastOrderAt ?? 0).getTime(),
    joined: (a, b) =>
      new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime(),
    name: (a, b) => a.username.localeCompare(b.username),
  };

  customers.sort(sorters[query.sort] ?? sorters.value);

  const totalCustomersLength = customers.length;
  const start = (page - 1) * limit;

  return {
    customers: customers.slice(start, start + limit),
    totalCustomersLength,
    limit,
    page,
    /** The whole segment's worth, not just this page's. */
    segmentValue: money(
      customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0),
    ),
  };
};

/** Everything known about one customer, including their orders and notes. */
const getCustomer = async (userId) => {
  assertValidId(userId, "user id");

  const user = await User.findById(userId).lean();
  if (!user) throw notFound("That customer does not exist");

  const [metrics, record, orders] = await Promise.all([
    metricsByCustomer([user._id]),
    CustomerRecord.findOne({ userId: user._id }).lean(),
    Order.find({ "user.userId": user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  return {
    ...toCustomer(user, metrics.get(String(user._id)), record),
    notes: (record?.notes ?? [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    orders: orders.map((order) => ({
      _id: order._id,
      status: order.status,
      totalPrice: order.totalPrice,
      items: order.items,
      createdAt: order.createdAt,
      paidAt: order.paidAt ?? null,
      refId: order.refId ?? null,
    })),
  };
};

/** Creates the record on first write, so nothing has to exist up front. */
const recordFor = async (userId) => {
  const user = await User.findById(userId).select("_id");
  if (!user) throw notFound("That customer does not exist");

  return CustomerRecord.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: "after" },
  );
};

const updateCustomer = async (userId, { stage, tags, owner }) => {
  assertValidId(userId, "user id");
  await recordFor(userId);

  const updates = {};

  if (stage !== undefined) {
    // An empty value clears the override and hands the stage back to the data.
    if (stage === null || stage === "") {
      updates.stage = null;
    } else if (!LIFECYCLE_STAGES.includes(stage)) {
      throw badRequest(`stage must be one of: ${LIFECYCLE_STAGES.join(", ")}`);
    } else {
      updates.stage = stage;
    }
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags)) throw badRequest("tags must be a list");
    updates.tags = [
      ...new Set(
        tags
          .map((tag) => String(tag).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20),
      ),
    ];
  }

  if (owner !== undefined) {
    if (owner === null) {
      updates.owner = { userId: null, name: "" };
    } else {
      assertValidId(owner, "owner id");
      const staff = await User.findById(owner).select("username displayName");
      if (!staff) throw notFound("That team member does not exist");
      updates.owner = {
        userId: staff._id,
        name: staff.displayName || staff.username,
      };
    }
  }

  await CustomerRecord.updateOne({ userId }, { $set: updates });

  return getCustomer(userId);
};

const addNote = async (userId, author, body) => {
  assertValidId(userId, "user id");
  await recordFor(userId);

  await CustomerRecord.updateOne(
    { userId },
    {
      $push: {
        notes: {
          body,
          author: {
            userId: author._id,
            name: author.displayName || author.username,
          },
        },
      },
    },
  );

  return getCustomer(userId);
};

const deleteNote = async (userId, noteId) => {
  assertValidId(userId, "user id");
  assertValidId(noteId, "note id");

  const result = await CustomerRecord.updateOne(
    { userId },
    { $pull: { notes: { _id: noteId } } },
  );

  if (result.matchedCount === 0) {
    throw notFound("That customer has no record");
  }

  return getCustomer(userId);
};

/**
 * How the book splits by stage, and what each segment is worth.
 *
 * Counted over every account rather than a page of them, because the point of
 * a segment total is that it covers the segment.
 */
const getSegments = async () => {
  const users = await User.find().lean();
  const userIds = users.map((user) => user._id);

  const [metrics, records] = await Promise.all([
    metricsByCustomer(userIds),
    CustomerRecord.find({ userId: { $in: userIds } }).lean(),
  ]);

  const recordsByUser = new Map(
    records.map((record) => [String(record.userId), record]),
  );

  const buckets = new Map(
    LIFECYCLE_STAGES.map((stage) => [stage, { stage, customers: 0, value: 0 }]),
  );

  for (const user of users) {
    const customer = toCustomer(
      user,
      metrics.get(String(user._id)),
      recordsByUser.get(String(user._id)),
    );
    const bucket = buckets.get(customer.stage);
    if (!bucket) continue;
    bucket.customers += 1;
    bucket.value += customer.lifetimeValue;
  }

  return {
    totalCustomers: users.length,
    rules: {
      atRiskAfterDays: AT_RISK_AFTER_DAYS,
      churnedAfterDays: CHURNED_AFTER_DAYS,
    },
    segments: [...buckets.values()].map((bucket) => ({
      ...bucket,
      value: money(bucket.value),
    })),
  };
};

module.exports = {
  listCustomers,
  getCustomer,
  updateCustomer,
  addNote,
  deleteNote,
  getSegments,
  derivedStage,
  LIFECYCLE_STAGES,
};
