import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import config from "../../config";
import * as schema from "./schema";

/**
 * The PostgreSQL connection.
 *
 * One pool per process, created on first use and closed on shutdown. The
 * `api`, `worker` and `scheduler` roles each have their own, sized by
 * POSTGRES_POOL_SIZE.
 */

export const createDb = (url = config.postgres.url, max = config.postgres.poolSize) => {
  const pool = new Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
};

export type Db = ReturnType<typeof createDb>["db"];

/** Anything that can run a query: the database itself or a transaction. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

let shared: ReturnType<typeof createDb> | undefined;

export const getDb = (): Db => {
  shared ??= createDb();
  return shared.db;
};

export const closeDb = async () => {
  if (!shared) return;
  const { pool } = shared;
  shared = undefined;
  await pool.end();
};
