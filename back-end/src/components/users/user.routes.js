"use strict";

const express = require("express");
const { asyncHandler, requireAuth } = require("../../middlewares");
const userService = require("./user.service");

const router = express.Router();

// Every cart endpoint needs a session. Previously none of them checked, and
// each one dereferenced `req.user._id` - so an anonymous request crashed the
// handler instead of being turned away.
router.use("/cart", requireAuth);

router.get(
  "/cart",
  asyncHandler(async (req, res) =>
    res.status(200).json(userService.getCartItems(req.user)),
  ),
);

router.post(
  "/cart/:productId",
  asyncHandler(async (req, res) => {
    const items = await userService.addProductToCart(
      req.user,
      req.params.productId,
    );
    return res.status(200).json(items);
  }),
);

router.post(
  "/cart/remove/:productId",
  asyncHandler(async (req, res) => {
    const items = await userService.removeProductFromCart(
      req.user,
      req.params.productId,
    );
    return res.status(200).json(items);
  }),
);

module.exports = { userRouter: router };
