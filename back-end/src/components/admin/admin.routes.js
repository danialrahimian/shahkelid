"use strict";

const express = require("express");
const { body } = require("express-validator");
const {
  asyncHandler,
  requireRole,
  validate,
  upload,
} = require("../../middlewares");
const adminService = require("./admin.service");
const { BILLING_PERIODS } = require("../products/product.model");

const router = express.Router();

// Every route here is for admins and moderators only. The previous version
// shipped these endpoints with no authentication at all: anyone on the network
// could create, edit or delete products.
//
// The guard is attached per route rather than with router.use. This router is
// mounted at "/", so a router-wide guard would also run for paths it does not
// define, turning every unknown URL into a 401 instead of a 404.
const adminOnly = requireRole("admin", "moderator", "owner");

const productValidator = [
  body("name")
    .exists({ values: "falsy" })
    .withMessage("name is required")
    .bail()
    .isLength({ min: 2 })
    .withMessage("name must have more than 2 characters")
    .bail()
    .matches(/^[\p{L}\p{N}_ -]+$/u)
    .withMessage("name can only contain letters, numbers, spaces and dashes"),
  body("period")
    .exists({ values: "falsy" })
    .withMessage("period is required")
    .bail()
    .trim()
    // Checked against the same list the schema enforces, so a bad value is a
    // readable 400 rather than a mongoose validation error further down.
    .isIn(BILLING_PERIODS)
    .withMessage(`period must be one of: ${BILLING_PERIODS.join(", ")}`),
  body("perks").exists({ values: "falsy" }).withMessage("perks is required"),
  body("price")
    .exists({ values: "undefined" })
    .withMessage("price is required")
    .bail()
    .isInt({ min: 0 })
    .withMessage("price must be a non-negative integer")
    .toInt(),
  validate,
];

router.post(
  "/admin",
  adminOnly,
  upload.single("image"),
  productValidator,
  asyncHandler(async (req, res) => {
    const result = await adminService.createProduct(req.user, {
      body: req.body,
      file: req.file,
    });
    return res.status(201).json(result);
  }),
);

router.put(
  "/admin/:productId",
  adminOnly,
  upload.single("image"),
  productValidator,
  asyncHandler(async (req, res) => {
    const result = await adminService.updateProduct(
      req.user,
      req.params.productId,
      { body: req.body, file: req.file },
    );
    return res.status(200).json(result);
  }),
);

// Kept as POST because that is what the existing client sends. DELETE would be
// the better verb if the client is updated.
router.post(
  "/product/:productId",
  adminOnly,
  asyncHandler(async (req, res) => {
    const adminProducts = await adminService.deleteProduct(
      req.user,
      req.params.productId,
    );
    return res.status(200).json(adminProducts);
  }),
);

router.get("/admin-products", adminOnly, (req, res) =>
  res.status(200).json(adminService.listAdminProducts(req.user)),
);

router.get(
  "/admin-product/:adminProductId",
  adminOnly,
  asyncHandler(async (req, res) => {
    const product = await adminService.getAdminProduct(
      req.params.adminProductId,
    );
    return res.status(200).json(product);
  }),
);

module.exports = { adminRouter: router };
