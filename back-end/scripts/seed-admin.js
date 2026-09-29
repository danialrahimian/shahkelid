"use strict";

/**
 * Creates or promotes the first privileged account.
 *
 * Every /admin and /mod endpoint now requires a role, so a fresh database has
 * nobody who can reach the panels. This script closes that gap without a
 * hardcoded account in the source: the credentials come from the environment,
 * the password is hashed before it is written, and the plaintext is never
 * logged. The old seeder stored its password in clear text.
 *
 *   SEED_ADMIN_USERNAME=owner \
 *   SEED_ADMIN_EMAIL=owner@example.com \
 *   SEED_ADMIN_PASSWORD='pick-a-long-one' \
 *   npm run seed:admin
 */

const readline = require("node:readline/promises");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const config = require("../src/config");
const { User, ROLES } = require("../src/components/users/user.model");

const ask = async (question, { silent = false } = {}) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (silent) {
    // Show the prompt first, then silence the stream so the password itself is
    // not echoed. Muting before writing swallowed the question too, leaving the
    // operator staring at a blank line with no idea what was being asked.
    process.stdout.write(question);
    rl.output.write = () => true;
  }
  try {
    return (await rl.question(silent ? "" : question)).trim();
  } finally {
    rl.close();
    if (silent) process.stdout.write("\n");
  }
};

const main = async () => {
  const role = process.env.SEED_ADMIN_ROLE || "owner";
  if (!ROLES.includes(role)) {
    throw new Error(`SEED_ADMIN_ROLE must be one of: ${ROLES.join(", ")}`);
  }

  const username =
    process.env.SEED_ADMIN_USERNAME || (await ask("Username: "));
  const email = process.env.SEED_ADMIN_EMAIL || (await ask("Email: "));
  const password =
    process.env.SEED_ADMIN_PASSWORD ||
    (await ask("Password: ", { silent: true }));

  if (!username || !email || !password) {
    throw new Error("Username, email and password are all required.");
  }
  if (password.length < 8) {
    throw new Error("Pick a password of at least 8 characters.");
  }

  await mongoose.connect(config.database.uri);

  const existing = await User.findOne({
    $or: [{ username }, { email: email.toLowerCase() }],
  });

  if (existing) {
    // Promoting rather than failing makes the script safe to re-run and lets
    // an existing account be rescued after roles were introduced.
    existing.role = role;
    existing.password = await bcrypt.hash(password, config.auth.bcryptRounds);
    await existing.save();
    console.log(`Updated "${existing.username}" and set role to ${role}.`);
  } else {
    const created = await User.create({
      username,
      email,
      password: await bcrypt.hash(password, config.auth.bcryptRounds),
      role,
      cart: { items: [] },
    });
    console.log(`Created "${created.username}" with role ${role}.`);
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
