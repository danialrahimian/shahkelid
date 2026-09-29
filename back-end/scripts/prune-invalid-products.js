"use strict";

/**
 * Removes the leftover products so only the real catalogue is left.
 *
 * The plans are three tiers on three terms, nine rows in all. Everything else
 * is from before the terms were fixed: duplicates, half-finished entries and a
 * test row priced at a hundred thousand dollars. They still appear on the
 * pricing page and can still be bought.
 *
 *   npm run prune:products            # show what would go
 *   npm run prune:products -- --write
 *
 * Deleting a product is not just one row. It has to leave every cart holding
 * it, leave the admin's own list, and take its uploaded image with it -- which
 * is exactly what the admin panel's delete does, and what this repeats in bulk.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");

const config = require("../src/config");
const {
  Product,
  BILLING_PERIODS,
} = require("../src/components/products/product.model");
const { User } = require("../src/components/users/user.model");
const { Order } = require("../src/components/orders/order.model");

/** The tiers the catalogue is supposed to offer. */
const TIERS = ["Basic", "Plus", "Complete"];

const isCanonical = (product) =>
  TIERS.includes(product.name) && BILLING_PERIODS.includes(product.period);

const main = async () => {
  const write = process.argv.includes("--write");

  await mongoose.connect(config.database.uri);

  const products = await Product.find().lean();
  const keep = products.filter(isCanonical);
  const drop = products.filter((product) => !isCanonical(product));

  console.log(`Products: ${products.length}`);
  console.log(`  keeping: ${keep.length}`);
  console.log(`  removing: ${drop.length}`);

  // Warn rather than delete blindly if the canonical set is not what it should
  // be: better to stop and ask than to leave the catalogue short.
  const expected = TIERS.length * BILLING_PERIODS.length;
  if (keep.length !== expected) {
    console.log(
      `\n  Warning: expected ${expected} canonical plans but found ${keep.length}.` +
        ` Run \`npm run seed:plans\` first.`,
    );
  }

  for (const product of drop) {
    // A product somebody already paid for is history, not catalogue. The order
    // keeps its own copy of the name and price, so removing the product does
    // not damage the invoice, but it is worth saying out loud.
    const orders = await Order.countDocuments({
      "items.productId": product._id,
    });
    const carts = await User.countDocuments({
      "cart.items.productId": product._id,
    });

    console.log(
      `  - "${product.name}" (${product.period}) $${product.price}` +
        (orders ? ` — in ${orders} past order(s)` : "") +
        (carts ? ` — in ${carts} cart(s)` : ""),
    );
  }

  if (!write) {
    console.log("\nNothing removed. Re-run with --write to apply.");
    await mongoose.disconnect();
    return;
  }

  const removedImages = new Set();

  for (const product of drop) {
    const id = product._id;

    await Promise.all([
      User.updateMany(
        { "cart.items.productId": id },
        { $pull: { "cart.items": { productId: id } } },
      ),
      User.updateMany(
        { "adminProducts.items.productId": id },
        { $pull: { "adminProducts.items": { productId: id } } },
      ),
    ]);

    await Product.deleteOne({ _id: id });
    if (product.image) removedImages.add(product.image);
  }

  // Only delete a file once nothing points at it any more. Two things can:
  // another product, because the legacy rows shared images between them, and
  // a past order, which keeps its own copy of each line including the image
  // and has to keep rendering long after the plan is withdrawn.
  const stillUsed = new Set(
    (await Product.find().lean()).map((product) => product.image),
  );

  for (const image of removedImages) {
    if (stillUsed.has(image)) continue;
    if (await Order.exists({ "items.image": image })) {
      stillUsed.add(image);
      console.log(`  keeping ${image}: a past invoice still shows it`);
    }
  }

  let filesRemoved = 0;
  for (const image of removedImages) {
    if (stillUsed.has(image)) continue;

    const target = path.join(config.uploads.directory, path.basename(image));
    try {
      await fs.unlink(target);
      filesRemoved += 1;
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.log(`  could not remove ${image}: ${error.message}`);
      }
    }
  }

  const remaining = await Product.countDocuments({});
  console.log(
    `\nRemoved ${drop.length} products and ${filesRemoved} image(s).` +
      ` ${remaining} remain.`,
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
