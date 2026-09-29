"use strict";

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { User, ROLES } = require("../users/user.model");
const { toPublicUsers } = require("../users/user.serializer");
const { Product } = require("../products/product.model");
const config = require("../../config");
const {
  badRequest,
  notFound,
  forbidden,
} = require("../../libraries/errors/app-error");

const assertValidId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest(`invalid ${label}`);
  }
};

/** Every list of users goes through the serializer, so no hash is ever sent. */
const listUsers = async () => toPublicUsers(await User.find());

const deleteUser = async (actor, userId) => {
  assertValidId(userId, "user id");

  if (actor._id.toString() === userId) {
    throw badRequest("you cannot delete your own account here");
  }

  const deleted = await User.findByIdAndDelete(userId);
  if (!deleted) {
    throw notFound("there is no user to delete");
  }

  return listUsers();
};

/**
 * Updates a user's profile.
 *
 * Role changes are restricted to owners. The old handler destructured `role`
 * from the body and then silently dropped it, so the client's role field never
 * did anything; allowing it unconditionally would instead let any moderator
 * promote themselves.
 */
const updateUser = async (actor, { _id, username, email, password, role }) => {
  if (!_id) {
    throw badRequest("user id is required");
  }
  assertValidId(_id, "user id");

  const updateData = {};
  if (username !== undefined) updateData.username = username;
  if (email !== undefined) updateData.email = email;

  if (password && password.trim() !== "") {
    if (password.length < 6) {
      throw badRequest("password is too short");
    }
    updateData.password = await bcrypt.hash(password, config.auth.bcryptRounds);
  }

  if (role !== undefined && role !== "") {
    if (actor.role !== "owner") {
      throw forbidden("only an owner can change roles");
    }
    if (!ROLES.includes(role)) {
      throw badRequest(`role must be one of: ${ROLES.join(", ")}`);
    }
    updateData.role = role;
  }

  const updated = await User.findByIdAndUpdate(
    _id,
    { $set: updateData },
    { returnDocument: "after", runValidators: true },
  );

  if (!updated) {
    throw notFound("there is no user to edit");
  }

  return listUsers();
};

const addToUserCart = async ({ userId, productId }) => {
  assertValidId(userId, "user id");
  assertValidId(productId, "product id");

  const [user, product] = await Promise.all([
    User.findById(userId),
    Product.findById(productId),
  ]);

  if (!user) throw notFound("user not found");
  if (!product) throw notFound("product not found");

  await user.addToCart(product);
  return listUsers();
};

/**
 * Takes one unit out of somebody's cart.
 *
 * Like the shopper's own version, this does not require the product to still
 * exist: clearing out a withdrawn plan is exactly when a moderator needs it.
 */
const removeFromUserCart = async ({ userId, productId }) => {
  assertValidId(userId, "user id");
  assertValidId(productId, "product id");

  const user = await User.findById(userId);
  if (!user) throw notFound("user not found");

  await user.removeFromCart(productId);
  return listUsers();
};

module.exports = {
  listUsers,
  deleteUser,
  updateUser,
  addToUserCart,
  removeFromUserCart,
};
