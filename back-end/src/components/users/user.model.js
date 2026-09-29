"use strict";

const mongoose = require("mongoose");

const ROLES = ["user", "admin", "moderator", "owner"];

const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: true },
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // `select: false` keeps the hash out of every query that does not ask for
    // it explicitly. The old moderator endpoint returned whole user documents,
    // hashes and reset tokens included.
    password: { type: String, required: true, select: false },
    cart: {
      items: { type: [cartItemSchema], default: [] },
    },
    role: { type: String, enum: ROLES, default: "user" },

    // --- profile ------------------------------------------------------------
    // Everything below is optional: an account created before profiles existed
    // is still valid, and nobody is forced to fill anything in.
    /** Public path to the uploaded avatar, e.g. "/uploads/<name>.png". */
    avatar: { type: String, default: null },
    displayName: { type: String, trim: true, maxlength: 60, default: "" },
    bio: { type: String, trim: true, maxlength: 300, default: "" },
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    country: { type: String, trim: true, maxlength: 60, default: "" },
    resetPasswordToken: { type: String, select: false, index: true },
    resetPasswordTokenExpiredTime: { type: Date, select: false },
    adminProducts: {
      items: {
        type: [
          {
            productId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Product",
              required: true,
            },
            count: { type: Number, required: true, default: 1 },
          },
        ],
        default: [],
      },
    },
  },
  { timestamps: true },
);

/**
 * The id of a cart line's product, whether or not it has been populated.
 *
 * `buildCartSnapshot` populates `cart.items.productId` on the very same user
 * document these methods run against. Once populated the field holds a whole
 * Product, and calling `toString()` on it yields the document rather than the
 * id, so a plain comparison would never match and every add would create a
 * duplicate line.
 */
const lineProductId = (item) => String(item.productId?._id ?? item.productId);

/**
 * Adds one unit of a product to the cart.
 * Returns the saved document so callers can read the fresh cart.
 */
userSchema.methods.addToCart = function addToCart(product) {
  const items = [...this.cart.items];
  const index = items.findIndex(
    (item) => lineProductId(item) === String(product._id),
  );

  if (index >= 0) {
    items[index].quantity += 1;
  } else {
    items.push({ productId: product._id, quantity: 1 });
  }

  this.cart = { items };
  return this.save();
};

/**
 * Removes one unit, dropping the line when it reaches zero.
 *
 * Takes an id rather than a product on purpose. Removal must work even when
 * the product itself is gone: a plan deleted from the catalogue would
 * otherwise be stuck in the cart forever, because every attempt to take it out
 * would first fail to find it.
 *
 * Returns the document unchanged when the line is not there; the old version
 * read `items[-1].quantity` and threw a TypeError instead.
 */
userSchema.methods.removeFromCart = function removeFromCart(productId) {
  const target = String(productId?._id ?? productId);
  const items = [...this.cart.items];
  const index = items.findIndex((item) => lineProductId(item) === target);

  if (index < 0) {
    return Promise.resolve(this);
  }

  if (items[index].quantity > 1) {
    items[index].quantity -= 1;
  } else {
    items.splice(index, 1);
  }

  this.cart = { items };
  return this.save();
};

/** Empties the cart, used once a payment is confirmed. */
userSchema.methods.clearCart = function clearCart() {
  this.cart = { items: [] };
  return this.save();
};

const User = mongoose.model("User", userSchema);

module.exports = { User, ROLES };
