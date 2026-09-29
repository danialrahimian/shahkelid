import { rateLimit } from "express-rate-limit";
import type { Redis } from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";

import { ApiError } from "./api-error";

/**
 * Per-IP request limits, counted in Redis so that every API process shares
 * one count. Counted in memory, three processes would each allow the limit,
 * and an attacker would get three times as many tries.
 */
export const limitPerIp = ({
  redis,
  name,
  windowMs,
  max,
}: {
  redis: Redis;
  /** Keeps each limiter's counters apart. */
  name: string;
  windowMs: number;
  max: number;
}) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (_req, _res, next, options) =>
      next(
        new ApiError(429, "RATE_LIMITED", "Too many requests from this address", {
          retryAfterSeconds: Math.ceil(options.windowMs / 1000),
        }),
      ),
  });
