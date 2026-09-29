"use strict";

const { body } = require("express-validator");
const { validate } = require("../../middlewares");

// bcrypt silently truncates past 72 bytes, so anything longer is rejected
// rather than accepted and cut short.
const withinBcryptLimit = (value) => {
  if (Buffer.byteLength(value, "utf8") > 72) {
    throw new Error("password is too long");
  }
  return true;
};

const signUpValidator = [
  body("username")
    .exists({ values: "falsy" })
    .withMessage("username is required")
    .bail()
    .isString()
    .withMessage("username must be a string")
    .bail()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage("username must be between 3 and 20 characters")
    .bail()
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("username can only contain letters, numbers and underscore"),

  body("email")
    .exists({ values: "falsy" })
    .withMessage("email is required")
    .bail()
    .trim()
    .isEmail()
    .withMessage("email is not valid"),

  body("password")
    .exists({ values: "falsy" })
    .withMessage("password is requird")
    .bail()
    .isString()
    .withMessage("password must be a string")
    .bail()
    .isLength({ min: 6 })
    .withMessage("password must be more than 5 characters")
    .bail()
    .custom(withinBcryptLimit),

  validate,
];

const loginValidator = [
  // The client sends the same value as both username and email, so at least
  // one of them has to be present rather than email specifically.
  body().custom((value, { req }) => {
    if (!req.body?.username && !req.body?.email) {
      throw new Error("email or username is required");
    }
    return true;
  }),

  body("password")
    .exists({ values: "falsy" })
    .withMessage("password is required")
    .bail()
    .isString()
    .withMessage("password must be a string")
    .bail()
    .custom(withinBcryptLimit),

  validate,
];

const resetLinkValidator = [
  body("email")
    .exists({ values: "falsy" })
    .withMessage("email is required")
    .bail()
    .trim()
    .isEmail()
    .withMessage("email is not valid"),
  validate,
];

const resetPasswordValidator = [
  body("newPassword")
    .exists({ values: "falsy" })
    .withMessage("a new password is required")
    .bail()
    .isString()
    .withMessage("password must be a string")
    .bail()
    .isLength({ min: 6 })
    .withMessage("password must be more than 5 characters")
    .bail()
    .custom(withinBcryptLimit),
  validate,
];

module.exports = {
  signUpValidator,
  loginValidator,
  resetLinkValidator,
  resetPasswordValidator,
};
