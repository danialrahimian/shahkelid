"use strict";

const { Order } = require("./order.model");
const paymentGateway = require("../../libraries/payment");
const { badRequest, notFound } = require("../../libraries/errors/app-error");

/**
 * Builds the order lines from the user's stored cart and current product
 * prices.
 *
 * This is the single source of truth for what an order contains. The old
 * /payment handler saved `req.body.order` straight from the client, so a
 * caller could post any items and any totalPrice and have it persisted, then
 * pay whatever amount they chose.
 */
const buildCartSnapshot = async (user) => {
  const populated = await user.populate("cart.items.productId");

  const items = populated.cart.items
    .filter((item) => item.productId)
    .map((item) => ({
      productId: item.productId._id,
      name: item.productId.name,
      // The term is part of what was bought, so it is captured with the price.
      period: item.productId.period,
      price: item.productId.price,
      image: item.productId.image,
      quantity: item.quantity,
    }));

  const totalPrice = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  return { items, totalPrice };
};

/** A preview of the order the user is about to pay for. Persists nothing. */
const previewOrder = async (user) => {
  const { items, totalPrice } = await buildCartSnapshot(user);

  if (items.length === 0) {
    throw badRequest("Your cart is empty");
  }

  return {
    user: { userId: user._id, username: user.username, email: user.email },
    items,
    totalPrice,
    status: "pending",
  };
};

/**
 * Persists a pending order from the server-side cart and opens a payment.
 * Returns the provider's redirect details.
 */
const startPayment = async (user) => {
  const { items, totalPrice } = await buildCartSnapshot(user);

  if (items.length === 0) {
    throw badRequest("Your cart is empty");
  }

  /**
   * The order is written before the payment is opened, not after.
   *
   * The other way round is a way to lose money: if the write failed after the
   * provider had already issued an authority, the customer would be holding a
   * live payment link for an order that does not exist. They pay, the callback
   * arrives, `confirmPayment` finds nothing and answers "order not found", and
   * the only record of the money is at the provider.
   *
   * This way the worst case is a pending order nobody paid for, which costs
   * nobody anything and is marked failed below.
   */
  const order = await Order.create({
    user: { userId: user._id, username: user.username, email: user.email },
    items,
    totalPrice,
    status: "pending",
  });

  let payment;
  try {
    payment = await paymentGateway.requestPayment({
      amount: totalPrice,
      email: user.email,
      description: `Order for ${user.username}`,
    });
  } catch (error) {
    // No payment was opened, so the order will never be settled.
    await Order.findByIdAndUpdate(order._id, { $set: { status: "failed" } });
    throw error;
  }

  // Only now can the callback be matched back to this order.
  order.authority = payment.authority;
  await order.save();

  return {
    status: payment.status,
    authority: payment.authority,
    url: payment.url,
    orderId: order._id,
  };
};

/**
 * Confirms a payment and, only then, marks the order paid and empties the cart.
 *
 * The amount sent for verification comes from the stored order, not from the
 * cart as it happens to look now. The old version verified whatever the cart
 * totalled at that moment, which is a different number the instant the cart
 * changes.
 */
const confirmPayment = async (user, { authority, status }) => {
  if (!authority) {
    throw badRequest("پارامتر نامعتبر");
  }

  const order = await Order.findOne({
    authority,
    "user.userId": user._id,
  });

  if (!order) {
    throw notFound("سفارش یافت نشد");
  }

  if (order.status === "paid") {
    // Not an error: the callback can legitimately arrive twice.
    return { alreadyPaid: true, order };
  }

  if (status !== "OK") {
    order.status = "failed";
    await order.save();
    throw badRequest("پرداخت با خطا مواجه شد");
  }

  const { verified, refId } = await paymentGateway.verifyPayment({
    amount: order.totalPrice,
    authority,
  });

  if (!verified) {
    order.status = "failed";
    await order.save();
    throw badRequest("پرداخت تایید نشد");
  }

  order.status = "paid";
  order.refId = refId ? String(refId) : undefined;
  order.paidAt = new Date();
  await order.save();

  await user.clearCart();

  return { alreadyPaid: false, order };
};

/** Orders belonging to one user, newest first. */
const listInvoices = async (user) => {
  const orders = await Order.find({ "user.userId": user._id })
    .sort({ createdAt: -1 })
    .lean();

  if (orders.length === 0) {
    throw notFound("you have not any order");
  }

  return orders;
};

module.exports = {
  previewOrder,
  startPayment,
  confirmPayment,
  listInvoices,
  buildCartSnapshot,
};
