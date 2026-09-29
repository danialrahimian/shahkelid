import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { Redis } from "ioredis";

import config from "../../config";
import { ApiError } from "../../platform/http/api-error";

/**
 * Six-digit codes sent by email: for signing in (which is also how an account
 * is created) and for resetting a password.
 *
 * They live only in Redis, for ten minutes, and only as an HMAC: a copy of
 * Redis does not reveal a single usable code. Each code allows five guesses,
 * after which it is gone and a new one must be requested; with a million
 * possible codes that is a one-in-two-hundred-thousand chance per code.
 */

export type CodePurpose = "sign_in" | "reset_password";

const RESEND_COOLDOWN_SECONDS = 60;

const hmac = (code: string) =>
  createHmac("sha256", Buffer.from(config.security.encryptionKey, "base64"))
    .update(code)
    .digest("hex");

/** Email addresses compare case-insensitively everywhere else too (citext). */
const emailKey = (email: string) => email.trim().toLowerCase();

const keys = (purpose: CodePurpose, email: string) => ({
  code: `code:${purpose}:${emailKey(email)}`,
  cooldown: `code-cooldown:${emailKey(email)}`,
  hourly: `code-hourly:${emailKey(email)}`,
});

/**
 * Makes a new code, replacing any earlier one for the same purpose, and
 * returns it for sending.
 *
 * Throttled per address, not per IP: one minute between codes, and a few per
 * hour. Otherwise the endpoint would be a free way to flood someone's inbox.
 */
export const issueCode = async (redis: Redis, email: string, purpose: CodePurpose) => {
  const k = keys(purpose, email);

  const cooling = await redis.set(k.cooldown, "1", "EX", RESEND_COOLDOWN_SECONDS, "NX");
  if (cooling === null) {
    const ttl = await redis.ttl(k.cooldown);
    throw new ApiError(429, "TOO_MANY_CODES", "A code was sent to this address moments ago", {
      retryAfterSeconds: Math.max(ttl, 1),
    });
  }

  const sentThisHour = await redis.incr(k.hourly);
  if (sentThisHour === 1) await redis.expire(k.hourly, 60 * 60);
  if (sentThisHour > config.account.codesPerEmailPerHour) {
    const ttl = await redis.ttl(k.hourly);
    throw new ApiError(429, "TOO_MANY_CODES", "Too many codes sent to this address", {
      retryAfterSeconds: Math.max(ttl, 1),
    });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const ttlSeconds = Math.ceil(config.account.codeTtlMs / 1000);
  await redis
    .multi()
    .del(k.code)
    .hset(k.code, { hash: hmac(code), attempts: 0 })
    .expire(k.code, ttlSeconds)
    .exec();

  return code;
};

/**
 * Checks a code, and spends it if it is right.
 *
 * The attempt counter is incremented before comparing, atomically, so ten
 * guesses sent at once still count as ten. A right code is deleted in the
 * same step that accepts it; two requests racing with the same code cannot
 * both succeed, because only one of them can delete it.
 */
export const consumeCode = async (
  redis: Redis,
  email: string,
  purpose: CodePurpose,
  code: string,
) => {
  const key = keys(purpose, email).code;

  const attempts = await redis.hincrby(key, "attempts", 1);
  const stored = await redis.hget(key, "hash");

  if (!stored) {
    // HINCRBY on a missing key creates one; don't leave that behind.
    await redis.del(key);
    throw new ApiError(400, "CODE_EXPIRED", "No code is waiting for this address");
  }

  if (attempts > config.account.codeMaxAttempts) {
    await redis.del(key);
    throw new ApiError(400, "CODE_EXPIRED", "Too many wrong codes; request a new one");
  }

  const given = Buffer.from(hmac(code));
  const expected = Buffer.from(stored);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new ApiError(400, "CODE_WRONG", "That code is not right");
  }

  if ((await redis.del(key)) !== 1) {
    throw new ApiError(400, "CODE_EXPIRED", "That code has already been used");
  }
};
