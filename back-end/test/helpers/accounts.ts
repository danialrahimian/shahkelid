import { randomBytes } from "node:crypto";

import config from "../../src/config";
import { createDb, type Db } from "../../src/platform/db/client";
import { hashPassword } from "../../src/platform/crypto/password";
import { seal } from "../../src/platform/crypto/secret-box";
import { roles, userRoles } from "../../src/modules/access/schema";
import { users } from "../../src/modules/identity/schema";
import { setEmailSender, type Email } from "../../src/modules/notifications/email";
import { base32Decode, codeAt, generateSecret, stepAt } from "../../src/modules/identity/totp";
import { eq, inArray } from "drizzle-orm";

/** Helpers for the account tests: emails, people, and authenticator codes. */

export const uniqueEmail = (label = "person") =>
  `${label}.${randomBytes(4).toString("hex")}@example.com`;

/**
 * Catches every email the server sends, instead of queueing it, so a test can
 * read the code it was sent the way a person would read it in their inbox.
 */
export const captureEmails = () => {
  const sent: Email[] = [];
  setEmailSender(async (email) => {
    sent.push(email);
  });

  return {
    sent,
    /** The six-digit code in the latest email to this address. */
    lastCodeFor: (address: string) => {
      const email = [...sent].reverse().find((e) => e.to.toLowerCase() === address.toLowerCase());
      const code = email?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) throw new Error(`No code was emailed to ${address}`);
      return code;
    },
    stop: () => setEmailSender(null),
  };
};

let testDb: { db: Db; pool: { end: () => Promise<void> } } | undefined;

/** A direct database handle, for arranging what the API is then asked about. */
export const database = () => {
  testDb ??= createDb(config.postgres.url, 3);
  return testDb.db;
};

export const closeDatabase = async () => {
  await testDb?.pool.end();
  testDb = undefined;
};

/**
 * Authenticator codes for a known secret.
 *
 * Every code works once, so a test that signs in twice needs two different
 * ones. The server accepts the step before, now and the step after, which
 * gives three distinct codes to hand out.
 */
export const authenticator = (secret: string) => {
  const key = base32Decode(secret);
  let offset = -1;
  return {
    secret,
    next: () => {
      if (offset > 1) throw new Error("Only three distinct codes are valid at once");
      const code = codeAt(key, stepAt(Date.now()) + offset);
      offset += 1;
      return code;
    },
  };
};

/**
 * A member of staff, arranged directly in the database: an account, a
 * password, roles, and optionally an authenticator already set up.
 */
export const aStaffMember = async ({
  roleKeys,
  password = "a long staff password",
  withAuthenticator = false,
}: {
  roleKeys: string[];
  password?: string;
  withAuthenticator?: boolean;
}) => {
  const db = database();
  const email = uniqueEmail("staff");
  const secret = withAuthenticator ? generateSecret() : undefined;

  const [user] = await db
    .insert(users)
    .values({
      email,
      emailNormalized: email,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password),
      referralCode: randomBytes(5).toString("hex").toUpperCase(),
      ...(secret ? { totpSecretEnc: seal(secret), totpEnabledAt: new Date() } : {}),
    })
    .returning();

  if (roleKeys.length > 0) {
    const found = await db.select().from(roles).where(inArray(roles.key, roleKeys));
    await db.insert(userRoles).values(found.map((role) => ({ userId: user!.id, roleId: role.id })));
  }

  return {
    id: user!.id,
    email,
    password,
    authenticator: secret ? authenticator(secret) : undefined,
  };
};

export const suspend = async (email: string) => {
  await database().update(users).set({ status: "suspended" }).where(eq(users.email, email));
};
