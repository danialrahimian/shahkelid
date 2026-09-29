import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import config from "../../config";

const MIGRATIONS = path.join(__dirname, "..", "..", "..", "drizzle");

/**
 * Applies every migration not yet applied, in order, each in a transaction.
 *
 *   npm run db:migrate -w back-end
 *
 * Safe to run on every deploy and before every test run: applied migrations
 * are recorded in the database and skipped.
 */
export const runMigrations = async (url = config.postgres.url) => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
};

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
