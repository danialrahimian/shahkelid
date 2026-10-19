import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { open, seal } from "../../platform/crypto/secret-box";
import { ApiError } from "../../platform/http/api-error";
import { writeAudit, type AuditEntry } from "../access/audit";
import { assertNotLocked, clearFailures, recordFailure } from "./lockout";
import { userRecoveryCodes, users } from "./schema";
import type { User } from "./service";
import { base32Encode, generateSecret, matchCode, otpauthUri } from "./totp";

/**
 * Two-factor sign-in with an authenticator app. Every staff account must use
 * it (roles.requires_2fa); customers will be able to opt in (phase 2).
 */

type RequestInfo = Pick<AuditEntry, "ip" | "userAgent" | "requestId">;

const ISSUER = "Shah Kelid";
const SETUP_TTL_SECONDS = 15 * 60;
const RECOVERY_CODE_COUNT = 10;

const setupKey = (userId: string) => `2fa-setup:${userId}`;

/**
 * Starts setup: a new secret, held (encrypted) in Redis until the person
 * proves their app produces the right codes. Only then is it saved, so a
 * setup abandoned half way never leaves an account requiring codes nobody
 * can produce.
 */
export const beginSetup = async (redis: Redis, user: User) => {
  if (user.totpEnabledAt) {
    throw new ApiError(409, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor sign-in is already on");
  }
  const secret = generateSecret();
  await redis.set(setupKey(user.id), seal(secret).toString("base64"), "EX", SETUP_TTL_SECONDS);
  return { secret, otpauthUri: otpauthUri({ secret, account: user.email ?? user.username ?? user.id, issuer: ISSUER }) };
};

/** Recovery codes: XXXX-XXXX in base32, stored only as SHA-256 hashes. */
const newRecoveryCode = () => {
  const raw = base32Encode(randomBytes(5)); // 8 characters, 40 bits
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};
const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(code.replace("-", "").toUpperCase()).digest("hex");

/**
 * Each authenticator code works once. A code read over someone's shoulder,
 * or out of a screen recording, is already spent.
 */
const spendStep = async (redis: Redis, userId: string, step: number) =>
  (await redis.set(`totp-used:${userId}:${step}`, "1", "EX", 120, "NX")) === "OK";

const wrongCode = async (redis: Redis, userId: string) => {
  const failures = await recordFailure(redis, "two_factor", userId);
  if (failures >= config.account.lockoutThreshold) await assertNotLocked(redis, "two_factor", userId);
  return new ApiError(400, "CODE_WRONG", "That code is not right");
};

/** Finishes setup with a code from the app; returns the recovery codes, once. */
export const enableTwoFactor = async (
  db: Db,
  redis: Redis,
  user: User,
  code: string,
  request: RequestInfo,
) => {
  await assertNotLocked(redis, "two_factor", user.id);

  const pending = await redis.get(setupKey(user.id));
  if (!pending) throw new ApiError(400, "CODE_EXPIRED", "Setup expired; start again");
  const secret = open(Buffer.from(pending, "base64"));

  const step = matchCode(secret, code);
  if (step === null || !(await spendStep(redis, user.id, step))) {
    throw await wrongCode(redis, user.id);
  }

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ totpSecretEnc: seal(secret), totpEnabledAt: new Date() })
      .where(and(eq(users.id, user.id), isNull(users.totpEnabledAt)))
      .returning({ id: users.id });
    if (!updated) {
      throw new ApiError(409, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor sign-in is already on");
    }

    await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));
    await tx
      .insert(userRecoveryCodes)
      .values(recoveryCodes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })));

    await writeAudit(tx, {
      actorKind: "customer",
      actorUserId: user.id,
      action: "account.two_factor_enabled",
      entityType: "user",
      entityId: user.id,
      ...request,
    });
  });

  await redis.del(setupKey(user.id));
  await clearFailures(redis, "two_factor", user.id);
  return recoveryCodes;
};

/**
 * The second step of signing in: an authenticator code, or a recovery code
 * when the phone is lost. A recovery code works once and its use is audited,
 * because it is exactly what someone who stole the list would use.
 */
export const verifySecondFactor = async (
  db: Db,
  redis: Redis,
  user: User,
  code: string,
  request: RequestInfo,
) => {
  await assertNotLocked(redis, "two_factor", user.id);

  if (/^\d{6}$/.test(code)) {
    if (!user.totpSecretEnc) throw await wrongCode(redis, user.id);
    const step = matchCode(open(user.totpSecretEnc), code);
    if (step === null || !(await spendStep(redis, user.id, step))) {
      throw await wrongCode(redis, user.id);
    }
    await clearFailures(redis, "two_factor", user.id);
    return;
  }

  const used = await db.transaction(async (tx) => {
    const [spent] = await tx
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userRecoveryCodes.userId, user.id),
          eq(userRecoveryCodes.codeHash, hashRecoveryCode(code)),
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });
    if (!spent) return false;

    await writeAudit(tx, {
      actorKind: "customer",
      actorUserId: user.id,
      action: "account.recovery_code_used",
      entityType: "user",
      entityId: user.id,
      ...request,
    });
    return true;
  });

  if (!used) throw await wrongCode(redis, user.id);
  await clearFailures(redis, "two_factor", user.id);
};
