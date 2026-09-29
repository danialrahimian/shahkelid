"use strict";

/**
 * Lists, and optionally removes, orders left over from manual testing.
 *
 * These distort every figure on the dashboard: a handful of trial checkouts
 * made while building the app include one worth six figures, which on its own
 * outweighs a year of real trade.
 *
 *   npm run prune:test-orders            # list them, change nothing
 *   npm run prune:test-orders -- --write
 *
 * Deliberately a dry run by default and never invoked automatically. An order
 * is a financial record: deleting one is not the kind of tidying a script gets
 * to do on its own judgement.
 *
 * The test is whether every line refers to a plan the catalogue no longer
 * sells. That is a reasonable signal here because the catalogue was pruned to
 * nine real plans, but it is not proof, so each one is printed in full before
 * anything happens.
 */

const mongoose = require("mongoose");

const config = require("../src/config");
const { Order } = require("../src/components/orders/order.model");
const { Product } = require("../src/components/products/product.model");

const main = async () => {
  const write = process.argv.includes("--write");

  await mongoose.connect(config.database.uri);

  const catalogue = new Set(
    (await Product.find().select("name").lean()).map((product) => product.name),
  );

  const orders = await Order.find().lean();

  const suspect = orders.filter(
    (order) =>
      (order.items ?? []).length > 0 &&
      order.items.every((item) => !catalogue.has(item.name)),
  );

  const revenue = suspect
    .filter((order) => order.status === "paid")
    .reduce((sum, order) => sum + order.totalPrice, 0);

  console.log(`Orders: ${orders.length}`);
  console.log(`  referring only to plans no longer sold: ${suspect.length}`);
  console.log(`  of which paid, totalling: $${revenue.toLocaleString()}`);
  console.log();

  for (const order of suspect) {
    console.log(
      `  ${order.status.padEnd(8)} $${String(order.totalPrice).padEnd(9)}` +
        ` ${order.user.username}` +
        ` — ${order.items.map((item) => item.name).join(", ")}` +
        ` — ${new Date(order.createdAt).toISOString().slice(0, 10)}`,
    );
  }

  if (!write) {
    console.log("\nNothing removed. Re-run with --write to apply.");
    await mongoose.disconnect();
    return;
  }

  const result = await Order.deleteMany({
    _id: { $in: suspect.map((order) => order._id) },
  });

  console.log(`\nRemoved ${result.deletedCount} orders.`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
