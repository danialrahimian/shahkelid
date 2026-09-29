"use strict";

const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

const { User } = require("../users/user.model");
const { toPublicUser } = require("../users/user.serializer");
const config = require("../../config");
const { sendEmail } = require("../../libraries/mailer");
const {
  badRequest,
  conflict,
  unauthorized,
} = require("../../libraries/errors/app-error");

/**
 * Business rules for signing up, signing in and password recovery.
 * No express objects reach this layer (best practice 1.2).
 */

/**
 * The single spelling of an address, used for both storage and lookup.
 *
 * Sign-up used to run the address through validator's `normalizeEmail`, which
 * strips dots and rewrites googlemail.com. Login did not, so anyone who signed
 * up as "first.last@gmail.com" was stored as "firstlast@gmail.com" and could
 * never log in with the address they had typed. Trimming and lower-casing is
 * all the schema does on write, so it is all that is done here.
 */
const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : email;

/**
 * A genuine bcrypt hash of a value nobody can supply.
 *
 * It exists so that a login for an account that does not exist spends the same
 * time as one that does. The previous placeholder string was not a valid hash,
 * so bcrypt rejected it in microseconds instead of the ~200ms a real
 * comparison takes, and the response time still gave away which usernames are
 * registered.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  config.auth.bcryptRounds,
);

const registerUser = async ({ username, password, email }) => {
  const normalizedEmail = normalizeEmail(email);

  const existing = await User.findOne({
    $or: [{ username }, { email: normalizedEmail }],
  });
  if (existing) {
    throw conflict("User already exists please login");
  }

  const hashedPassword = await bcrypt.hash(password, config.auth.bcryptRounds);
  const user = await User.create({
    username,
    email: normalizedEmail,
    password: hashedPassword,
    cart: { items: [] },
  });

  return toPublicUser(user);
};

/**
 * Verifies credentials. The same message is returned whether the account is
 * missing or the password is wrong, so the endpoint cannot be used to find out
 * which usernames exist.
 */
const authenticateUser = async ({ username, email, password }) => {
  const identifiers = [];
  if (username) identifiers.push({ username });
  if (email) identifiers.push({ email: normalizeEmail(email) });
  if (identifiers.length === 0) {
    throw badRequest("A username or email is required");
  }

  const user = await User.findOne({ $or: identifiers }).select("+password");
  if (!user) {
    // Spend roughly the same time as a real comparison so the response time
    // does not reveal whether the account exists.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw unauthorized("Invalid username or password");
  }

  const matches = await bcrypt.compare(password, user.password);
  if (!matches) {
    throw unauthorized("Invalid username or password");
  }

  return toPublicUser(user);
};

/**
 * Issues a reset token. Always reports success: telling an anonymous caller
 * that an address is unknown hands them a list of registered emails.
 */
const requestPasswordReset = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail });

  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordTokenExpiredTime = new Date(
      Date.now() + config.auth.resetTokenTtlMs,
    );
    await user.save();

    await sendEmail({
      to: normalizedEmail,
      subject: "reset password",
      html: `
      <p>If you want to reset your password click below:</p>
      <a href="${config.cors.origin}/reset-password/${token}">
        Reset Password
      </a>
      `,
    });
  }

  return { message: "reset link sent successfully" };
};

/** Consumes a reset token and sets the new password. */
const resetPassword = async ({ token, newPassword }) => {
  const user = await User.findOne({ resetPasswordToken: token }).select(
    "+resetPasswordToken +resetPasswordTokenExpiredTime",
  );

  if (!user) {
    throw badRequest("token is invalid");
  }

  const expiry = user.resetPasswordTokenExpiredTime;
  if (!expiry || expiry.getTime() <= Date.now()) {
    throw badRequest(
      "your time has been expired please enter your email again",
    );
  }

  user.password = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
  // Burn the token so the link cannot be replayed.
  user.resetPasswordToken = undefined;
  user.resetPasswordTokenExpiredTime = undefined;
  await user.save();

  return { message: "password updated succesfully" };
};

module.exports = {
  registerUser,
  authenticateUser,
  requestPasswordReset,
  resetPassword,
  normalizeEmail,
  // Exported so a test can check it is a real hash. Timing the two login paths
  // cannot show this: the database lookup costs more than the hash comparison
  // at the low cost factor tests run with, so the difference hides in the noise.
  DUMMY_PASSWORD_HASH,
};
