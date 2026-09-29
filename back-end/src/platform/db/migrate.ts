import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import config from "../../config";
import { syncSystemRoles } from "../../modules/access/roles";
import * as schema from "./schema";

const MIGRATIONS = path.join(__dirname, "..", "..", "..", "drizzle");

/**
 * Applies every migration not yet applied, in order, each in a transaction,
 * then brings the built-in roles up to date.
 *
 *   npm run db:migrate -w back-end
 *
 * Safe to run on every deploy and before every test run: applied migrations
 * are recorded in the database and skipped, and the role sync is idempotent.
 * The roles are synced here rather than at startup because they are part of
 * what a release installs, like the tables they live in.
 */
export const runMigrations = async (url = config.postgres.url) => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await syncSystemRoles(db);
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
