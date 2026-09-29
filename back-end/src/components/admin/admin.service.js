"use strict";

const mongoose = require("mongoose");
const { Product } = require("../products/product.model");
const { User } = require("../users/user.model");
const { deleteUpload, toPublicPath } = require("../../libraries/storage/file-store");
const { Order } = require("../orders/order.model");
const { badRequest, notFound } = require("../../libraries/errors/app-error");

/**
 * Perks arrive as a JSON string because the form is multipart.
 * A malformed value is the caller's mistake, not a 500.
 */
const parsePerks = (raw) => {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("not an array");
    }
    return parsed.map(String);
  } catch {
    throw badRequest("perks must be a JSON array of strings");
  }
};

/**
 * Removes an uploaded image, but only if nothing still needs it.
 *
 * A past order keeps its own copy of each line, including the image path, and
 * those receipts have to keep rendering years later. Deleting the file the
 * moment a product is withdrawn would quietly break every invoice that ever
 * contained it, and there is no way to get it back.
 *
 * Another product can point at the same file too, which the older catalogue
 * did, so that is checked as well. Storage is cheap; a customer's receipt is
 * not reproducible.
 */
const deleteUploadIfUnused = async (image, { exceptProductId } = {}) => {
  if (!image) return false;

  const [usedByProduct, usedByOrder] = await Promise.all([
    Product.exists({
      image,
      ...(exceptProductId ? { _id: { $ne: exceptProductId } } : {}),
    }),
    Order.exists({ "items.image": image }),
  ]);

  if (usedByProduct || usedByOrder) return false;

  return deleteUpload(image);
};

const assertValidId = (id, label = "id") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest(`Invalid ${label}`);
  }
};

const createProduct = async (admin, { body, file }) => {
  // The old handler read `req.file.filename` unguarded, so a request without an
  // image threw a TypeError and the client got no response at all.
  if (!file) {
    throw badRequest("an image is required");
  }

  const product = await Product.create({
    name: body.name,
    price: body.price,
    period: body.period,
    perks: parsePerks(body.perks),
    image: toPublicPath(file.filename),
    userId: admin._id,
  });

  const updatedAdmin = await User.findByIdAndUpdate(
    admin._id,
    { $push: { "adminProducts.items": { productId: product._id, count: 1 } } },
    { returnDocument: "after" },
  );

  return { product, adminProducts: updatedAdmin.adminProducts.items };
};

const updateProduct = async (admin, productId, { body, file }) => {
  assertValidId(productId, "product id");

  const existing = await Product.findById(productId);
  if (!existing) {
    throw notFound("Product not found");
  }

  const updateData = {
    name: body.name,
    price: body.price,
    period: body.period,
    perks: parsePerks(body.perks),
  };

  const previousImage = existing.image;
  if (file) {
    updateData.image = toPublicPath(file.filename);
  }

  const product = await Product.findByIdAndUpdate(productId, updateData, {
    returnDocument: "after",
    runValidators: true,
  });

  // Only drop the old file once the write succeeded, so a failed update does
  // not leave the product pointing at a deleted image, and only if no order or
  // other product still refers to it.
  if (file && previousImage) {
    await deleteUploadIfUnused(previousImage, { exceptProductId: productId });
  }

  const freshAdmin = await User.findById(admin._id);
  return { product, adminProducts: freshAdmin.adminProducts.items };
};

const deleteProduct = async (admin, productId) => {
  assertValidId(productId, "product id");

  const product = await Product.findByIdAndDelete(productId);
  if (!product) {
    throw notFound("Product not found");
  }

  const objectId = new mongoose.Types.ObjectId(productId);

  // Pull the deleted product out of every cart and from the owning admin.
  await Promise.all([
    User.updateMany(
      { "cart.items.productId": objectId },
      { $pull: { "cart.items": { productId: objectId } } },
    ),
    User.updateMany(
      { "adminProducts.items.productId": objectId },
      { $pull: { "adminProducts.items": { productId: objectId } } },
    ),
  ]);

  await deleteUploadIfUnused(product.image);

  const freshAdmin = await User.findById(admin._id);
  return freshAdmin.adminProducts.items;
};

const listAdminProducts = (admin) => admin.adminProducts.items;

const getAdminProduct = async (productId) => {
  assertValidId(productId, "product id");

  const product = await Product.findById(productId).lean();
  if (!product) {
    throw notFound("Product not found");
  }
  return product;
};

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  listAdminProducts,
  getAdminProduct,
};
