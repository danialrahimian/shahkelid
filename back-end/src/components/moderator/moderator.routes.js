"use strict";

const express = require("express");
const { body } = require("express-validator");
const { asyncHandler, requireRole, validate } = require("../../middlewares");
const moderatorService = require("./moderator.service");

const router = express.Router();

// Moderators and owners only. Previously every one of these endpoints was open
// to anonymous callers, including one that could change any user's password.
router.use("/mod", requireRole("moderator", "owner"));

const editUserValidator = [
  body("_id").exists({ values: "falsy" }).withMessage("user id is required"),
  body("email")
    .optional({ values: "falsy" })
    .isEmail()
    .withMessage("invalid email format"),
  body("username")
    .optional({ values: "falsy" })
    .isLength({ min: 3, max: 20 })
    .withMessage("username must be between 3 and 20 characters")
    .bail()
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("username can only contain letters, numbers and underscore"),
  // Optional on purpose: leaving it blank means "keep the current password".
  body("password")
    .optional({ values: "falsy" })
    .isLength({ min: 6 })
    .withMessage("password must be more than 5 characters"),
  validate,
];

const cartActionValidator = [
  body("userId").exists({ values: "falsy" }).withMessage("userId is required"),
  body("productId")
    .exists({ values: "falsy" })
    .withMessage("productId is required"),
  validate,
];

router.get(
  "/mod/users",
  asyncHandler(async (req, res) =>
    res.status(200).json(await moderatorService.listUsers()),
  ),
);

// The client has always called this route, but it was never registered - the
// `deleteUser` handler existed and nothing routed to it, so deleting a user
// returned 404.
router.post(
  "/mod/users/delete-user/:userId",
  asyncHandler(async (req, res) => {
    const users = await moderatorService.deleteUser(
      req.user,
      req.params.userId,
    );
    return res.status(200).json(users);
  }),
);

router.post(
  "/mod/user/edit-user",
  editUserValidator,
  asyncHandler(async (req, res) => {
    const users = await moderatorService.updateUser(req.user, req.body);
    return res.status(200).json(users);
  }),
);

router.post(
  "/mod/user-cart/add",
  cartActionValidator,
  asyncHandler(async (req, res) => {
    const users = await moderatorService.addToUserCart(req.body);
    return res.status(200).json(users);
  }),
);

router.post(
  "/mod/user-cart/remove",
  cartActionValidator,
  asyncHandler(async (req, res) => {
    const users = await moderatorService.removeFromUserCart(req.body);
    return res.status(200).json(users);
  }),
);

module.exports = { moderatorRouter: router };
