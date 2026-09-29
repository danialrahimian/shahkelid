"use strict";

const express = require("express");
const { body } = require("express-validator");

const {
  asyncHandler,
  requireAuth,
  upload,
  validate,
} = require("../../middlewares");
const profileService = require("./profile.service");

const router = express.Router();

/**
 * A person's own account.
 *
 * Every route needs a session and acts on `req.user`, never on an id from the
 * request, so one signed-in person cannot reach another's profile by changing
 * a number in the URL.
 */

const profileValidator = [
  body("username")
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage("username must be between 3 and 20 characters")
    .bail()
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("username can only contain letters, numbers and underscore"),
  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("email is not valid"),
  body("displayName")
    .optional()
    .trim()
    .isLength({ max: 60 })
    .withMessage("display name must be 60 characters or fewer"),
  body("bio")
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage("bio must be 300 characters or fewer"),
  body("phone")
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage("phone must be 20 characters or fewer"),
  body("country")
    .optional()
    .trim()
    .isLength({ max: 60 })
    .withMessage("country must be 60 characters or fewer"),
  validate,
];

const passwordValidator = [
  body("currentPassword")
    .exists({ values: "falsy" })
    .withMessage("your current password is required"),
  body("newPassword")
    .exists({ values: "falsy" })
    .withMessage("a new password is required")
    .bail()
    .isLength({ min: 6 })
    .withMessage("password must be more than 5 characters")
    .bail()
    .isLength({ max: 72 })
    .withMessage("password is too long"),
  validate,
];

router.get(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) =>
    res.status(200).json(await profileService.getProfile(req.user)),
  ),
);

router.put(
  "/profile",
  requireAuth,
  profileValidator,
  asyncHandler(async (req, res) =>
    res.status(200).json(await profileService.updateProfile(req.user, req.body)),
  ),
);

router.put(
  "/profile/password",
  requireAuth,
  passwordValidator,
  asyncHandler(async (req, res) =>
    res.status(200).json(
      await profileService.changePassword(req.user, {
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      }),
    ),
  ),
);

router.put(
  "/profile/avatar",
  requireAuth,
  // Same limits as a product image: size, count and MIME type are all capped
  // by the shared upload middleware.
  upload.single("avatar"),
  asyncHandler(async (req, res) =>
    res.status(200).json(await profileService.updateAvatar(req.user, req.file)),
  ),
);

router.delete(
  "/profile/avatar",
  requireAuth,
  asyncHandler(async (req, res) =>
    res.status(200).json(await profileService.removeAvatar(req.user)),
  ),
);

router.post(
  "/profile/delete",
  requireAuth,
  [
    body("password")
      .exists({ values: "falsy" })
      .withMessage("your password is required"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await profileService.deleteAccount(req.user, {
      password: req.body.password,
    });

    // The account is gone, so the session pointing at it must go too.
    await new Promise((resolve) => {
      if (!req.session) return resolve();
      return req.session.destroy(() => resolve());
    });

    return res.status(200).json(result);
  }),
);

module.exports = { profileRouter: router };
