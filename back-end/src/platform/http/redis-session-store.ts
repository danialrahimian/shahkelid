import session from "express-session";
import type { Redis } from "ioredis";

/**
 * express-session storage in Redis, on the ioredis connection the app already
 * holds.
 *
 * connect-redis, the usual choice, now speaks only to the `redis` package;
 * using it would mean a second Redis client library for four operations.
 * Each session is one key holding JSON, expiring when the cookie does, so an
 * abandoned session cleans itself up.
 */
export class RedisSessionStore extends session.Store {
  private readonly redis: Redis;
  private readonly prefix: string;
  private readonly fallbackTtlSeconds: number;

  constructor({
    redis,
    prefix = "sess:",
    fallbackTtlSeconds = 24 * 60 * 60,
  }: {
    redis: Redis;
    prefix?: string;
    fallbackTtlSeconds?: number;
  }) {
    super();
    this.redis = redis;
    this.prefix = prefix;
    this.fallbackTtlSeconds = fallbackTtlSeconds;
  }

  private key(sid: string) {
    return `${this.prefix}${sid}`;
  }

  private ttlOf(data: session.SessionData) {
    const expires = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : undefined;
    if (!expires) return this.fallbackTtlSeconds;
    return Math.max(1, Math.ceil((expires - Date.now()) / 1000));
  }

  override get(sid: string, callback: (error: unknown, data?: session.SessionData | null) => void) {
    this.redis.get(this.key(sid)).then(
      (raw) => callback(null, raw ? (JSON.parse(raw) as session.SessionData) : null),
      (error: unknown) => callback(error),
    );
  }

  override set(sid: string, data: session.SessionData, callback?: (error?: unknown) => void) {
    this.redis.set(this.key(sid), JSON.stringify(data), "EX", this.ttlOf(data)).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }

  override destroy(sid: string, callback?: (error?: unknown) => void) {
    this.redis.del(this.key(sid)).then(
      () => callback?.(),
      (error: unknown) => callback?.(error),
    );
  }

  /** Keeps an active session alive without rewriting its contents. */
  override touch(sid: string, data: session.SessionData, callback?: () => void) {
    this.redis.expire(this.key(sid), this.ttlOf(data)).then(
      () => callback?.(),
      () => callback?.(),
    );
  }
}
