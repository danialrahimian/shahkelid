"use strict";

const express = require("express");
const { asyncHandler } = require("../../middlewares");
const productService = require("./product.service");

const router = express.Router();

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const result = await productService.listProducts(req.query);
    return res.status(200).json(result);
  }),
);

router.get(
  "/product/:productId",
  asyncHandler(async (req, res) => {
    const product = await productService.getProductById(req.params.productId);
    return res.status(200).json(product);
  }),
);

module.exports = { productRouter: router };
