"use strict";

const bcrypt = require("bcryptjs");

const { User } = require("./user.model");
const { toPublicUser } = require("./user.serializer");
const config = require("../../config");
const { deleteUpload, toPublicPath } = require("../../libraries/storage/file-store");
const {
  badRequest,
  conflict,
  notFound,
  unauthorized,
} = require("../../libraries/errors/app-error");

/**
 * What a person may change about their own account.
 *
 * Deliberately narrower than what a moderator may change: a role is absent
 * from every path here, so nobody can promote themselves by editing their own
 * profile. That distinction is the reason this is a separate service rather
 * than a reuse of the moderator one.
 */

/** The one spelling of an address, matching the auth service. */
const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : email;

const getProfile = async (user) => toPublicUser(user);

/**
 * Updates the profile fields.
 *
 * Username and email are unique, so a clash is reported as a conflict rather
 * than being allowed to surface as a raw index violation.
 */
const updateProfile = async (user, input) => {
  const updates = {};

  if (input.username !== undefined && input.username !== user.username) {
    const taken = await User.findOne({
      username: input.username,
      _id: { $ne: user._id },
    });
    if (taken) throw conflict("That username is already taken");
    updates.username = input.username;
  }

  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email !== user.email) {
      const taken = await User.findOne({ email, _id: { $ne: user._id } });
      if (taken) throw conflict("That email is already registered");
      updates.email = email;
    }
  }

  // Free-text fields. An empty string is a deliberate "clear this", which is
  // why they are only skipped when genuinely absent from the request.
  for (const field of ["displayName", "bio", "phone", "country"]) {
    if (input[field] !== undefined) updates[field] = input[field];
  }

  if (Object.keys(updates).length === 0) {
    return toPublicUser(user);
  }

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: updates },
    { returnDocument: "after", runValidators: true },
  );

  if (!updated) throw notFound("Your account no longer exists");

  return toPublicUser(updated);
};

/**
 * Changes the password.
 *
 * The current one is required. Without that check, anyone who found an
 * unattended signed-in browser could lock the owner out of their own account.
 */
const changePassword = async (user, { currentPassword, newPassword }) => {
  const withPassword = await User.findById(user._id).select("+password");
  if (!withPassword) throw notFound("Your account no longer exists");

  const matches = await bcrypt.compare(currentPassword, withPassword.password);
  if (!matches) throw unauthorized("Your current password is not correct");

  if (currentPassword === newPassword) {
    throw badRequest("The new password must be different from the current one");
  }

  withPassword.password = await bcrypt.hash(
    newPassword,
    config.auth.bcryptRounds,
  );
  await withPassword.save();

  return { message: "Your password has been changed" };
};

/** Replaces the avatar, removing whatever it replaced. */
const updateAvatar = async (user, file) => {
  if (!file) throw badRequest("Choose an image to upload");

  const previous = user.avatar;

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: { avatar: toPublicPath(file.filename) } },
    { returnDocument: "after" },
  );

  if (!updated) throw notFound("Your account no longer exists");

  // Only after the write succeeded, so a failed update never leaves the
  // profile pointing at a file that is already gone.
  if (previous) await deleteUpload(previous);

  return toPublicUser(updated);
};

const removeAvatar = async (user) => {
  const previous = user.avatar;

  const updated = await User.findByIdAndUpdate(
    user._id,
    { $set: { avatar: null } },
    { returnDocument: "after" },
  );

  if (!updated) throw notFound("Your account no longer exists");

  if (previous) await deleteUpload(previous);

  return toPublicUser(updated);
};

/**
 * Deletes the account, and with it the session.
 *
 * The password is required for the same reason it is required to change one.
 */
const deleteAccount = async (user, { password }) => {
  const withPassword = await User.findById(user._id).select("+password");
  if (!withPassword) throw notFound("Your account no longer exists");

  const matches = await bcrypt.compare(password, withPassword.password);
  if (!matches) throw unauthorized("Your password is not correct");

  if (withPassword.avatar) await deleteUpload(withPassword.avatar);
  await User.findByIdAndDelete(user._id);

  return { message: "Your account has been deleted" };
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  updateAvatar,
  removeAvatar,
  deleteAccount,
};
