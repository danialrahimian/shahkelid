"use strict";

/**
 * Shapes a user for the wire.
 *
 * Every response that carries a user goes through here. `select: false` on the
 * schema already hides the hash, but an explicit allow-list means a new
 * sensitive field cannot leak simply by being added to the schema.
 */
const toPublicUser = (user) => {
  if (!user) return null;
  const plain = typeof user.toObject === "function" ? user.toObject() : user;

  return {
    _id: plain._id,
    username: plain.username,
    email: plain.email,
    role: plain.role,
    cart: { items: plain.cart?.items ?? [] },
    createdAt: plain.createdAt,

    avatar: plain.avatar ?? null,
    displayName: plain.displayName ?? "",
    bio: plain.bio ?? "",
    phone: plain.phone ?? "",
    country: plain.country ?? "",
  };
};

const toPublicUsers = (users) => users.map((user) => toPublicUser(user));

module.exports = { toPublicUser, toPublicUsers };
