"use strict";

const { Product } = require("./product.model");
const { notFound, badRequest } = require("../../libraries/errors/app-error");
const mongoose = require("mongoose");

const SORTABLE_FIELDS = new Set(["name", "price", "period", "_id"]);
const MAX_PAGE_SIZE = 60;

/** Escapes user input before it becomes part of a RegExp (best practice 6.16). */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listProducts = async (query = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || 3;
  // Capping the page size stops a single request from asking for the whole
  // collection and pinning the event loop.
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);

  const filter = {};

  if (query.search) {
    filter.name = { $regex: escapeRegex(String(query.search)), $options: "i" };
  }
  if (query.period) {
    filter.period = String(query.period);
  }
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  let sort = { _id: 1 };
  if (query.sort) {
    const raw = String(query.sort);
    const direction = raw.startsWith("-") ? -1 : 1;
    const field = raw.replace(/^-/, "");
    if (SORTABLE_FIELDS.has(field)) {
      sort = { [field]: direction };
    }
  }

  const [products, totalProductsLength] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return { products, totalProductsLength, limit };
};

const getProductById = async (productId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw badRequest("Invalid product id");
  }

  const product = await Product.findById(productId).lean();
  if (!product) {
    throw notFound("Product not found");
  }
  return product;
};

module.exports = { listProducts, getProductById };
