import { defineConfig } from "drizzle-kit";

import config from "./src/config";

/**
 * Migrations are generated from the module schemas and committed to
 * ./drizzle. Three are written by hand, because drizzle-kit cannot express
 * them: the citext extension (before any table), and the ledger and
 * append-only triggers (after).
 *
 *   npm run db:generate -w back-end   new migration from schema changes
 *   npm run db:migrate  -w back-end   apply pending migrations
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/platform/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: config.postgres.url },
  strict: true,
  verbose: true,
});
