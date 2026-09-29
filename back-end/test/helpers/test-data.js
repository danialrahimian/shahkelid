"use strict";

/**
 * Builders for test records.
 *
 * Unique fields carry a random suffix so repeated runs never collide
 * (testing practice 6.5), and every test creates the records it acts on
 * rather than relying on a shared fixture (practice 6.1).
 */

const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const { User } = require("../../src/components/users/user.model");
const { Product } = require("../../src/components/products/product.model");
const { Post } = require("../../src/components/posts/post.model");
const config = require("../../src/config");

const unique = () => crypto.randomBytes(4).toString("hex");

const aSignUpPayload = (overrides = {}) => {
  const suffix = unique();
  return {
    username: `user_${suffix}`,
    email: `user_${suffix}@example.com`,
    password: "Str0ng!Pass",
    ...overrides,
  };
};

/** Creates a user directly in the database, bypassing the HTTP layer. */
const aUserInDb = async ({ role = "user", password = "Str0ng!Pass", ...rest } = {}) => {
  const suffix = unique();
  const hashed = await bcrypt.hash(password, config.auth.bcryptRounds);

  const user = await User.create({
    username: rest.username ?? `user_${suffix}`,
    email: rest.email ?? `user_${suffix}@example.com`,
    password: hashed,
    role,
    cart: { items: [] },
  });

  // The plaintext is handed back so the test can log in as this user.
  return { user, password };
};

const aProductInDb = async (overrides = {}) => {
  const suffix = unique();
  return Product.create({
    name: overrides.name ?? `plan_${suffix}`,
    period: overrides.period ?? "1 month",
    price: overrides.price ?? 10,
    perks: overrides.perks ?? ["fast", "secure"],
    image: overrides.image ?? `/uploads/${suffix}.png`,
    ...(overrides.userId ? { userId: overrides.userId } : {}),
  });
};

/** Creates an article directly in the database. */
const aPostInDb = async (overrides = {}) => {
  const suffix = unique();

  return Post.create({
    slug: overrides.slug ?? `article-${suffix}`,
    title: overrides.title ?? `Article ${suffix}`,
    excerpt: overrides.excerpt ?? "A short summary of the article.",
    content: overrides.content ?? "The body of the article.",
    coverImage: overrides.coverImage ?? `/uploads/post-${suffix}.svg`,
    tags: overrides.tags ?? ["privacy"],
    readingMinutes: overrides.readingMinutes ?? 4,
    author: overrides.author ?? { name: "Shah Kelid", avatar: null },
    likes: overrides.likes ?? [],
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
};

/** Signs a client in as a freshly created user of the given role. */
const loginAs = async (client, role = "user") => {
  const { user, password } = await aUserInDb({ role });
  const response = await client.post("/login", {
    username: user.username,
    email: user.email,
    password,
  });
  return { user, password, response };
};

module.exports = {
  aSignUpPayload,
  aUserInDb,
  aProductInDb,
  aPostInDb,
  loginAs,
  unique,
};
