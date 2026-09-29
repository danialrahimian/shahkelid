import type { Redis } from "ioredis";

import config from "../../config";
import { ApiError } from "../../platform/http/api-error";

/**
 * Temporary locks after repeated wrong answers.
 *
 * Counted per email address (and per account for authenticator codes), not
 * per IP, because the attack being stopped is guessing one account's password
 * from many addresses.
 *
 * The lock covers PASSWORD sign-in only. Sign-in with an emailed code keeps
 * working, because it proves control of the mailbox. Without that, anyone who
 * knows an address could keep its owner locked out on purpose.
 */

export type LockKind = "password" | "two_factor";

const keyOf = (kind: LockKind, subject: string) => `lock:${kind}:${subject.trim().toLowerCase()}`;

/** Throws ACCOUNT_LOCKED if the threshold has been reached. */
export const assertNotLocked = async (redis: Redis, kind: LockKind, subject: string) => {
  const key = keyOf(kind, subject);
  const failures = Number((await redis.get(key)) ?? 0);
  if (failures >= config.account.lockoutThreshold) {
    const ttl = await redis.pttl(key);
    throw new ApiError(423, "ACCOUNT_LOCKED", "Too many wrong attempts; try again later", {
      retryAfterSeconds: Math.max(Math.ceil(ttl / 1000), 1),
    });
  }
};

/**
 * Counts one wrong attempt. The window starts at the first failure, so five
 * wrong passwords spread over a day do not lock anyone.
 */
export const recordFailure = async (redis: Redis, kind: LockKind, subject: string) => {
  const key = keyOf(kind, subject);
  const failures = await redis.incr(key);
  if (failures === 1) await redis.pexpire(key, config.account.lockoutMs);
  return failures;
};

export const clearFailures = async (redis: Redis, kind: LockKind, subject: string) => {
  await redis.del(keyOf(kind, subject));
};
