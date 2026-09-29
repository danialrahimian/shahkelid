import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticator codes (TOTP, RFC 6238), as Google Authenticator, Authy and
 * every other authenticator app produce them: HMAC-SHA1, 30-second steps,
 * six digits.
 *
 * Small enough to own rather than depend on, and checked against the RFC's
 * own test vectors (totp.test.ts), which is the standard any library would be
 * held to.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;

// ------------------------------------------------------------ base32 (RFC 4648)

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const base32Encode = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (text: string): Buffer => {
  const clean = text.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not base32: "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

// -------------------------------------------------------------------- codes

/** 160 bits, the size RFC 4226 recommends, as authenticator apps expect it. */
export const generateSecret = () => base32Encode(randomBytes(20));

/** The code for one time step (RFC 4226 HOTP with dynamic truncation). */
export const codeAt = (secret: Buffer, step: number, digits = DIGITS) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
};

export const stepAt = (timeMs: number) => Math.floor(timeMs / 1000 / STEP_SECONDS);

/**
 * Which time step a code belongs to, or null if it matches none.
 *
 * One step either side of now is accepted, to forgive a phone clock that is
 * a few seconds off. The step is returned so the caller can refuse to accept
 * the same code twice (a code seen once over someone's shoulder is spent).
 */
export const matchCode = (secretBase32: string, code: string, nowMs = Date.now()) => {
  const secret = base32Decode(secretBase32);
  const now = stepAt(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(codeAt(secret, step));
    const given = Buffer.from(code);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return step;
  }
  return null;
};

/** The link an authenticator app reads from a QR code. */
export const otpauthUri = ({
  secret,
  account,
  issuer,
}: {
  secret: string;
  account: string;
  issuer: string;
}) => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
