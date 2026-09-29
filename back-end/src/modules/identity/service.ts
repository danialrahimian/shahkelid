import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";

import type { AccountView } from "@shah-kelid/contracts";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { decoyHash, hashPassword, needsRehash, verifyPassword } from "../../platform/crypto/password";
import { ApiError, conflict } from "../../platform/http/api-error";
import type { AccessProfile } from "../access/roles";
import { writeAudit, type AuditEntry } from "../access/audit";
import { sendEmail } from "../notifications/email";
import { assertNotLocked, clearFailures, recordFailure } from "./lockout";
import { users } from "./schema";
import { consumeCode, issueCode } from "./sign-in-codes";
import { base32Encode } from "./totp";

export type User = typeof users.$inferSelect;
type Context = { db: Db; redis: Redis };
type RequestInfo = Pick<AuditEntry, "ip" | "userAgent" | "requestId">;

/**
 * What free-trial abuse is checked against (phase 2): Gmail ignores dots and
 * everything after a "+", so ali.reza+1@gmail.com is the same inbox as
 * alireza@gmail.com. Other providers vary, so only the "+tag" is dropped.
 */
export const normalizeEmailForAbuse = (email: string) => {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const untagged = local.split("+")[0] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${untagged.replaceAll(".", "")}@gmail.com`;
  }
  return `${untagged}@${domain}`;
};

export const findUserByEmail = async (db: Db, email: string) => {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim()));
  return user;
};

export const findUserById = async (db: Db, id: string) => {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
};

/**
 * Creates the account for an address that has just proved it receives mail,
 * so it is created verified.
 *
 * Two sign-ins for a new address racing each other both end with the same
 * account: the second insert finds the address taken and reads the first's.
 */
export const createVerifiedAccount = async (db: Db, email: string): Promise<User> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          email: email.trim(),
          emailNormalized: normalizeEmailForAbuse(email),
          emailVerifiedAt: new Date(),
          // 40 random bits in base32: eight characters, easy to read aloud.
          referralCode: base32Encode(randomBytes(5)),
        })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (created) return created;

      const existing = await findUserByEmail(db, email);
      if (existing) return existing;
    } catch (error) {
      // A referral-code collision (one in a trillion): try another code.
      const cause = (error as { cause?: { code?: string } }).cause ?? error;
      if ((cause as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Could not create the account");
};

const assertActive = (user: User) => {
  if (user.status !== "active") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account is not active");
  }
};

const markSignedIn = (db: Db, userId: string) =>
  db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

// -------------------------------------------------------------- sign-in code

const codeEmail = (to: string, code: string, purpose: "sign_in" | "reset_password") =>
  purpose === "sign_in"
    ? {
        to,
        subject: `کد ورود شما به شاه‌کلید: ${code}`,
        text: [
          `کد ورود شما: ${code}`,
          "",
          "این کد تا ۱۰ دقیقه معتبر است و فقط یک بار کار می‌کند.",
          "اگر شما درخواست ورود نداده‌اید، این ایمیل را نادیده بگیرید؛ بدون این کد کسی نمی‌تواند وارد حساب شما شود.",
        ].join("\n"),
      }
    : {
        to,
        subject: `کد تغییر رمز شاه‌کلید: ${code}`,
        text: [
          `کد تغییر رمز عبور شما: ${code}`,
          "",
          "این کد تا ۱۰ دقیقه معتبر است.",
          "اگر شما درخواست تغییر رمز نداده‌اید، این ایمیل را نادیده بگیرید؛ رمز شما عوض نمی‌شود.",
        ].join("\n"),
      };

/**
 * Sends a sign-in code. The same for new and existing addresses: signing in
 * with a code is also how an account is created, so there is no "no such
 * account" answer to give away.
 */
export const requestSignInCode = async ({ redis }: Context, email: string) => {
  const code = await issueCode(redis, email, "sign_in");
  await sendEmail(codeEmail(email.trim(), code, "sign_in"));
};

export const signInWithCode = async ({ db, redis }: Context, email: string, code: string) => {
  await consumeCode(redis, email, "sign_in", code);

  const user = (await findUserByEmail(db, email)) ?? (await createVerifiedAccount(db, email));
  assertActive(user);

  // An address that proves it receives mail is verified, even if the
  // account was made some other way.
  if (!user.emailVerifiedAt) {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  }
  await markSignedIn(db, user.id);
  return user;
};

// ----------------------------------------------------------------- password

/**
 * Password sign-in, with a lock after repeated wrong passwords.
 *
 * An unknown address and a wrong password get the same answer, in the same
 * time (the decoy hash), and count towards the same lock, so none of the
 * three reveals whether an address has an account.
 */
export const signInWithPassword = async (
  { db, redis }: Context,
  email: string,
  password: string,
) => {
  await assertNotLocked(redis, "password", email);

  const user = await findUserByEmail(db, email);
  const stored = user?.passwordHash ?? (await decoyHash());
  const matches = (await verifyPassword(password, stored)) && Boolean(user?.passwordHash);

  if (!user || !matches) {
    const failures = await recordFailure(redis, "password", email);
    // The attempt that reaches the threshold is told about the lock at once,
    // rather than finding out on the next try.
    if (failures >= config.account.lockoutThreshold) {
      await assertNotLocked(redis, "password", email);
    }
    throw new ApiError(401, "WRONG_CREDENTIALS", "Wrong email or password");
  }

  await clearFailures(redis, "password", email);
  assertActive(user);

  if (needsRehash(user.passwordHash!)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
  }
  await markSignedIn(db, user.id);
  return user;
};

/** Always the same answer, whether or not the address has an account. */
export const requestPasswordReset = async ({ db, redis }: Context, email: string) => {
  // The code is issued (and throttled) either way, so the response time and
  // the rate limit behave the same for registered and unknown addresses.
  const code = await issueCode(redis, email, "reset_password");
  if (await findUserByEmail(db, email)) {
    await sendEmail(codeEmail(email.trim(), code, "reset_password"));
  }
};

export const resetPassword = async (
  { db, redis }: Context,
  email: string,
  code: string,
  newPassword: string,
  request: RequestInfo,
) => {
  await consumeCode(redis, email, "reset_password", code);

  const user = await findUserByEmail(db, email);
  if (!user) throw new ApiError(400, "CODE_WRONG", "That code is not right");

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await writeAudit(tx, {
      actorKind: "customer",
      actorUserId: user.id,
      action: "account.password_reset",
      entityType: "user",
      entityId: user.id,
      ...request,
    });
  });
  // Whoever just proved they own the mailbox should not stay locked out.
  await clearFailures(redis, "password", email);
};

/**
 * Sets a first password for an account made with an emailed code.
 *
 * Changing an existing password is not done here but through a reset code:
 * otherwise a stolen session would be enough to take the account over for
 * good.
 */
export const setFirstPassword = async (
  db: Db,
  user: User,
  newPassword: string,
  request: RequestInfo,
) => {
  if (user.passwordHash) throw conflict("This account already has a password; reset it instead");

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await writeAudit(tx, {
      actorKind: "customer",
      actorUserId: user.id,
      action: "account.password_set",
      entityType: "user",
      entityId: user.id,
      ...request,
    });
  });
};

// ---------------------------------------------------------------------- view

export const accountView = (user: User, access: AccessProfile): AccountView => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  locale: user.locale === "en" ? "en" : "fa",
  emailVerified: Boolean(user.emailVerifiedAt),
  hasPassword: Boolean(user.passwordHash),
  isStaff: access.roles.length > 0,
  permissions: [...access.permissions].sort(),
  twoFactor: {
    enabled: Boolean(user.totpEnabledAt),
    required: access.requiresTwoFactor,
  },
});
