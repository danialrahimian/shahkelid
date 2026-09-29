"use strict";

const mongoose = require("mongoose");
const { Product } = require("../products/product.model");
const { notFound, badRequest } = require("../../libraries/errors/app-error");

/** Cart operations for the signed-in user. */

const assertValidId = (productId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw badRequest("Invalid product id");
  }
};

/**
 * Adds one unit of a product to the user's cart and returns the new lines.
 *
 * The old handler looked the user up again and called `addToCart` on a product
 * that may not exist, throwing a TypeError that no catch block handled.
 */
const addProductToCart = async (user, productId) => {
  assertValidId(productId);

  const product = await Product.findById(productId);
  if (!product) {
    throw notFound("Product not found");
  }

  const updated = await user.addToCart(product);
  return updated.cart.items;
};

/**
 * Takes one unit out of the cart.
 *
 * Deliberately does not check that the product still exists. It used to, which
 * meant a plan withdrawn from the catalogue could never be removed: the
 * lookup failed first and the line stayed in the cart permanently.
 */
const removeProductFromCart = async (user, productId) => {
  assertValidId(productId);

  const updated = await user.removeFromCart(productId);
  return updated.cart.items;
};

const getCartItems = (user) => user.cart.items;

module.exports = { addProductToCart, removeProductFromCart, getCartItems };
