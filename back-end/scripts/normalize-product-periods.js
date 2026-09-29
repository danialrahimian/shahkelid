"use strict";

/**
 * Brings existing products onto the three allowed billing terms.
 *
 * The period used to be free text, so the catalogue holds "/ mo", "/ 6 mo",
 * "/ yr" and "6 mounth". Now that the schema only accepts three values, those
 * rows would fail validation the next time anyone edited them, and the pricing
 * page cannot group by a term it does not recognise.
 *
 * Run it once after upgrading:
 *
 *   npm run migrate:periods           # show what would change
 *   npm run migrate:periods -- --write
 *
 * It reports before it writes, because a term change moves a price: the same
 * amount over a different number of months is a different rate.
 */

const mongoose = require("mongoose");

const config = require("../src/config");
const {
  Product,
  BILLING_PERIODS,
  PERIOD_MONTHS,
} = require("../src/components/products/product.model");

/** The same word-based reading the client uses, kept deliberately strict. */
const UNIT_MONTHS = {
  y: 12, yr: 12, yrs: 12, year: 12, years: 12, yearly: 12,
  annual: 12, annually: 12,
  m: 1, mo: 1, mos: 1, mon: 1, month: 1, months: 1, monthly: 1,
  mounth: 1, mounths: 1,
};

const readMonths = (period) => {
  const text = String(period ?? "").toLowerCase().trim();
  if (!text) return null;

  const countMatch = /\d+/.exec(text);
  const count = countMatch ? Number.parseInt(countMatch[0], 10) : 1;
  if (!Number.isFinite(count) || count <= 0) return null;

  for (const word of text.split(/[^a-z]+/).filter(Boolean)) {
    if (UNIT_MONTHS[word] !== undefined) return count * UNIT_MONTHS[word];
  }

  return countMatch ? count : null;
};

/**
 * Picks the term to move a plan onto.
 *
 * An exact match is used where there is one. Otherwise the plan moves to the
 * next term *up*, never down: the customer then gets the same price spread
 * over a longer commitment. Rounding the other way would show a higher rate
 * per month than they originally agreed to, which is not a call a migration
 * script gets to make.
 */
const chooseTerm = (months) => {
  if (months === null) return { period: null, exact: false };

  const exact = BILLING_PERIODS.find(
    (period) => PERIOD_MONTHS[period] === months,
  );
  if (exact) return { period: exact, exact: true };

  const longerOrEqual = BILLING_PERIODS.filter(
    (period) => PERIOD_MONTHS[period] >= months,
  ).sort((a, b) => PERIOD_MONTHS[a] - PERIOD_MONTHS[b]);

  // Longer than every term we offer: the longest is the closest honest fit.
  const period = longerOrEqual[0] ?? BILLING_PERIODS[BILLING_PERIODS.length - 1];
  return { period, exact: false };
};

const main = async () => {
  const write = process.argv.includes("--write");

  await mongoose.connect(config.database.uri);

  // `lean` so documents that already violate the new enum can still be read.
  const products = await Product.find().lean();

  const unchanged = [];
  const exact = [];
  const rounded = [];
  const unreadable = [];

  for (const product of products) {
    if (BILLING_PERIODS.includes(product.period)) {
      unchanged.push(product);
      continue;
    }

    const months = readMonths(product.period);
    const { period, exact: isExact } = chooseTerm(months);

    if (!period) {
      unreadable.push(product);
      continue;
    }

    const entry = { product, from: product.period, to: period, months };
    if (isExact) exact.push(entry);
    else rounded.push(entry);
  }

  console.log(`Products: ${products.length}`);
  console.log(`  already valid: ${unchanged.length}`);
  console.log(`  exact match:   ${exact.length}`);
  console.log(`  rounded up:    ${rounded.length}`);
  console.log(`  unreadable:    ${unreadable.length}`);

  for (const { product, from, to } of exact) {
    console.log(`  = "${product.name}": "${from}" -> "${to}"`);
  }

  for (const { product, from, to, months } of rounded) {
    console.log(
      `  ~ "${product.name}": "${from}" (${months} months) -> "${to}" ` +
        `at $${product.price}. Check the price: the term got longer.`,
    );
  }

  for (const product of unreadable) {
    console.log(
      `  ? "${product.name}": "${product.period}" could not be read, ` +
        `defaulting to "${BILLING_PERIODS[0]}". Set it by hand if that is wrong.`,
    );
  }

  if (!write) {
    console.log("\nNothing written. Re-run with --write to apply.");
    await mongoose.disconnect();
    return;
  }

  const updates = [
    ...exact.map((entry) => ({ id: entry.product._id, period: entry.to })),
    ...rounded.map((entry) => ({ id: entry.product._id, period: entry.to })),
    ...unreadable.map((product) => ({
      id: product._id,
      period: BILLING_PERIODS[0],
    })),
  ];

  for (const { id, period } of updates) {
    await Product.updateOne({ _id: id }, { $set: { period } });
  }

  console.log(`\nUpdated ${updates.length} products.`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
