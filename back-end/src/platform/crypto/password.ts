import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

import { normalizePersian } from "@shah-kelid/contracts";

/**
 * Password hashing with scrypt.
 *
 * scrypt is built into Node, so there is no native package to compile on each
 * server, and it runs on libuv's thread pool, so hashing does not block the
 * event loop the way the pure-JavaScript bcrypt the old code uses does.
 *
 * Parameters are OWASP's (N=2^15, r=8, p=3: 32 MiB per hash). They are stored
 * with every hash, so they can be raised later: `needsRehash` tells the
 * sign-in code to re-hash a password with the new settings the next time its
 * owner signs in.
 */

type Params = { N: number; r: number; p: number };

const CURRENT: Params = { N: 2 ** 15, r: 8, p: 3 };
const KEY_BYTES = 32;
const SALT_BYTES = 16;

const derive = (password: string, salt: Buffer, params: Params) =>
  new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = {
      ...params,
      // Node's default ceiling is 32 MiB, right at this setting's working set.
      maxmem: 128 * params.N * params.r * 2,
    };
    // The same visible password is the same password, whichever keyboard
    // typed its ی and ک.
    scrypt(normalizePersian(password), salt, KEY_BYTES, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

/** "scrypt$N$r$p$salt$hash", with salt and hash in base64. */
export const hashPassword = async (password: string) => {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, CURRENT);
  const { N, r, p } = CURRENT;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
};

const parse = (stored: string) => {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !N || !r || !p || !salt || !hash) return null;
  return {
    params: { N: Number(N), r: Number(r), p: Number(p) },
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64"),
  };
};

/** Constant-time comparison: how long it takes says nothing about the password. */
export const verifyPassword = async (password: string, stored: string) => {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params);
  return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
};

export const needsRehash = (stored: string) => {
  const parsed = parse(stored);
  return (
    !parsed ||
    parsed.params.N !== CURRENT.N ||
    parsed.params.r !== CURRENT.r ||
    parsed.params.p !== CURRENT.p
  );
};

/**
 * A hash of nothing in particular, verified against when an account does not
 * exist or has no password, so that "no such account" takes as long to
 * answer as "wrong password" and the timing does not reveal which emails are
 * registered.
 */
let decoy: Promise<string> | undefined;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(16).toString("hex")));
