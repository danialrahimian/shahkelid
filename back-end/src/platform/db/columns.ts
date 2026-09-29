import { sql } from "drizzle-orm";
import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Column building blocks shared by every module's schema.
 *
 * The conventions they encode were settled in stage 2 (docs/02-database.md):
 * uuid ids, bigint toman and bytes, timestamptz everywhere.
 */

/**
 * A primary key.
 *
 * UUIDv7: time-ordered, so inserts land at the end of the index rather than
 * all over it, and not guessable, so no id in a URL can be walked to find
 * someone else's order. PostgreSQL 18 generates it; the application may also
 * pass one it made itself.
 */
export const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/**
 * A whole number of toman, or of bytes.
 *
 * Read as a JavaScript number, which is exact up to 9 quadrillion: far past
 * any price in toman and about 8 petabytes of traffic. The alternative,
 * JavaScript bigint, would make every sum and comparison in the application
 * awkward for a range this data never approaches.
 */
export const wholeNumber = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** A timestamp that may be absent. Always with a time zone, stored as UTC. */
export const at = (name: string) => timestamp(name, { withTimezone: true });

/** Case-insensitive text: Ali@Example.com and ali@example.com are one email. */
export const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

/** Raw bytes: encrypted secrets. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
