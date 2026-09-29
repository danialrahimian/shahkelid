"use strict";

/**
 * Creates the subscription catalogue: three tiers, each offered on the three
 * billing terms.
 *
 * Re-runnable. A plan is matched by its name and term, so running this twice
 * updates the nine rather than creating eighteen.
 *
 *   npm run seed:plans
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");

const config = require("../src/config");
const {
  Product,
  BILLING_PERIODS,
  PERIOD_MONTHS,
} = require("../src/components/products/product.model");
const { User } = require("../src/components/users/user.model");

/**
 * The three tiers, and what each costs on each term.
 *
 * Prices are whole dollars for the full term, because that is what the admin
 * form accepts and what the customer is actually charged. The page divides
 * them out into a rate per month.
 */
const TIERS = [
  {
    name: "Basic",
    palette: ["#0f172a", "#3b82f6"],
    prices: { "1 month": 13, "1 year": 60, "2 years": 96 },
    perks: [
      "Fast VPN on 2 devices",
      "Unlimited data",
      "80+ server locations",
      "Email support",
    ],
  },
  {
    name: "Plus",
    palette: ["#134e4a", "#10b981"],
    prices: { "1 month": 16, "1 year": 72, "2 years": 120 },
    perks: [
      "Fast VPN on 6 devices",
      "Unlimited data",
      "80+ server locations",
      "Shah Kelid private protocol",
      "Ad and tracker blocking",
      "24/7 live support",
    ],
  },
  {
    name: "Complete",
    palette: ["#3f1d38", "#a855f7"],
    prices: { "1 month": 19, "1 year": 96, "2 years": 168 },
    perks: [
      "Fast VPN on unlimited devices",
      "Unlimited data",
      "80+ server locations",
      "Shah Kelid private protocol",
      "Ad and tracker blocking",
      "1 TB encrypted storage",
      "Dedicated IP address",
      "VIP priority support",
    ],
  },
];

/**
 * Draws the plan's card image rather than downloading one: no network, no
 * licence, a couple of kilobytes each.
 */
const planSvg = ({ name, palette, term, index }) => {
  const [from, to] = palette;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="${name} plan">
  <defs>
    <linearGradient id="pg${index}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="pv${index}" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.30"/>
    </radialGradient>
  </defs>

  <rect width="800" height="800" fill="url(#pg${index})"/>
  <rect width="800" height="800" fill="url(#pv${index})"/>

  <g opacity="0.12" fill="#ffffff" transform="translate(560 150) scale(2.2)">
    <circle cx="60" cy="42" r="26"/>
    <path d="M 48 64 L 72 64 L 84 128 A 24 24 0 0 1 36 128 Z"/>
  </g>

  <text x="70" y="600" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700">${name}</text>
  <text x="70" y="666" fill="#ffffff" fill-opacity="0.75" font-family="Helvetica, Arial, sans-serif" font-size="38">${term}</text>
  <text x="70" y="726" fill="#ffffff" fill-opacity="0.55" font-family="Helvetica, Arial, sans-serif" font-size="28" letter-spacing="4">SHAH KELID</text>
</svg>`;
};

const main = async () => {
  await fs.mkdir(config.uploads.directory, { recursive: true });
  await mongoose.connect(config.database.uri);

  // Attribute the plans to a real staff account when one exists, so the admin
  // panel shows them under somebody rather than nobody.
  const staff = await User.findOne({
    role: { $in: ["owner", "admin", "moderator"] },
  }).sort({ createdAt: 1 });

  let created = 0;
  let updated = 0;
  let index = 0;

  for (const tier of TIERS) {
    for (const period of BILLING_PERIODS) {
      index += 1;

      const slug = `${tier.name}-${period}`.toLowerCase().replace(/\s+/g, "-");
      const fileName = `plan-${slug}.svg`;

      await fs.writeFile(
        path.join(config.uploads.directory, fileName),
        planSvg({
          name: tier.name,
          palette: tier.palette,
          term: period,
          index,
        }),
        "utf8",
      );

      const document = {
        name: tier.name,
        period,
        price: tier.prices[period],
        perks: tier.perks,
        image: `${config.uploads.publicPath}/${fileName}`,
        ...(staff ? { userId: staff._id } : {}),
      };

      // A tier is the same product across terms, so name and term together
      // are what identifies a row.
      const existing = await Product.findOne({ name: tier.name, period });

      if (existing) {
        await Product.updateOne({ _id: existing._id }, { $set: document });
        updated += 1;
      } else {
        await Product.create(document);
        created += 1;
      }
    }
  }

  const monthly = TIERS.map(
    (tier) =>
      `  ${tier.name}: $${(tier.prices["2 years"] / PERIOD_MONTHS["2 years"]).toFixed(2)}/mo on the 2-year term`,
  ).join("\n");

  console.log(`Seeded plans: ${created} created, ${updated} updated.`);
  console.log(monthly);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
