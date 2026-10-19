import { randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";

import { hashPassword } from "../../platform/crypto/password";
import type { Db } from "../../platform/db/client";
import { clearFailures } from "../identity/lockout";
import { userRecoveryCodes, users } from "../identity/schema";
import { findUserByUsername } from "../identity/service";
import { base32Encode } from "../identity/totp";
import { writeAudit } from "./audit";
import { grantOwner } from "./bootstrap";
import { roles, userRoles } from "./schema";

/**
 * Owners who sign in with a username and a password, managed from the
 * server's command line (scripts/owner.ts, behind `shahkelid owner`).
 *
 * The installer asks for a domain, a username and a password, and nothing
 * else: no mail service is needed to get into the staff area for the first
 * time. The owner role then makes them set up an authenticator app on their
 * first sign-in, as every staff account must.
 *
 * Whoever runs these already controls the server, so they are not a way
 * around the rules. Each change is in the activity log as the system's.
 */

/** A new owner with a username and a password. Refuses when one exists, unless `another`. */
export const createUsernameOwner = async (
  db: Db,
  username: string,
  password: string,
  { another = false } = {},
) => {
  if (await findUserByUsername(db, username)) {
    throw new Error(`The username "${username}" is taken`);
  }
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username: username.trim().toLowerCase(),
        passwordHash,
        // 40 random bits in base32: eight characters, easy to read aloud.
        referralCode: base32Encode(randomBytes(5)),
      })
      .returning();
    // In the same transaction: refused, it takes the new account with it.
    await grantOwner(tx, user!.id, { another });
    return user!;
  });
};

const ownerNamed = async (db: Db, username: string) => {
  const user = await findUserByUsername(db, username);
  if (!user || user.deletedAt) throw new Error(`No account is called "${username}"`);
  return user;
};

/**
 * A new password for a username, for an owner who forgot theirs. Every
 * session it had is ended, and a lock from wrong guesses is lifted.
 */
export const setUsernamePassword = async (db: Db, redis: Redis, username: string, password: string) => {
  const user = await ownerNamed(db, username);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, sessionsRevokedAt: new Date() }).where(eq(users.id, user.id));
    await writeAudit(tx, {
      actorKind: "system",
      action: "account.password_reset",
      entityType: "user",
      entityId: user.id,
    });
  });
  await clearFailures(redis, "password", user.username!);
};

/**
 * Turns two-step sign-in off for a username, for an owner who lost both
 * their phone and their recovery codes. They are asked to set it up again
 * at their next sign-in.
 */
export const resetUsernameTwoFactor = async (db: Db, redis: Redis, username: string) => {
  const user = await ownerNamed(db, username);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpSecretEnc: null, totpEnabledAt: null, sessionsRevokedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));
    await writeAudit(tx, {
      actorKind: "system",
      action: "account.two_factor_reset",
      entityType: "user",
      entityId: user.id,
    });
  });
  await clearFailures(redis, "two_factor", user.id);
};

/** Every owner, for `shahkelid owner list`. */
export const listOwners = async (db: Db) =>
  db
    .select({
      username: users.username,
      email: users.email,
      twoFactor: users.totpEnabledAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, "owner"), isNull(users.deletedAt)));
