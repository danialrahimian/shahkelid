import { Pool, type PoolClient } from "pg";

import config from "../../src/config";
import { runMigrations } from "../../src/platform/db/migrate";

/**
 * The PostgreSQL test database.
 *
 * Each test file starts from an empty, fully migrated database: the same
 * migrations production runs, so a test cannot pass against a schema that
 * production would not have.
 */

const assertTestDatabase = (url: string) => {
  const name = new URL(url).pathname.replace(/^\//, "");
  // The reset below drops every table. It refuses to touch anything that is
  // not unmistakably a test database, whatever the environment says.
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to reset "${name}": only databases named *_test are reset by tests.`);
  }
};

export const resetTestDatabase = async (url = config.postgres.url) => {
  assertTestDatabase(url);

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;",
    );
  } finally {
    await pool.end();
  }

  await runMigrations(url);
};

export const createTestPool = (url = config.postgres.url) => {
  assertTestDatabase(url);
  return new Pool({ connectionString: url, max: 5 });
};

/** A connection's server process id. Read it before the connection blocks. */
export const backendPid = async (client: PoolClient) => {
  const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  const pid = rows[0]?.pid;
  if (pid === undefined) throw new Error("No backend pid");
  return pid;
};

/**
 * Waits until the connection with this pid is blocked on a lock held by
 * another.
 *
 * For concurrency tests: it proves the second transaction really is queued
 * behind the first, rather than trusting a sleep to have been long enough.
 */
export const waitUntilBlocked = async (observer: Pool, pid: number, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      "select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
      [pid],
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Connection ${pid} never blocked on a lock`);
};
