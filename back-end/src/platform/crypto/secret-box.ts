import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import config from "../../config";

/**
 * Encryption for secrets kept in the database: two-factor secrets now, VPN
 * panel credentials from M3.
 *
 * AES-256-GCM, which both hides the secret and detects tampering: a stored
 * value that was altered, or encrypted with another key, fails to open
 * instead of decrypting to garbage.
 *
 * Layout: version (1 byte) | IV (12) | auth tag (16) | ciphertext. The version
 * byte leaves room to rotate the key later without guessing which key sealed
 * which value.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const keyFrom = (base64: string) => {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return key;
};

export const seal = (plaintext: string, keyBase64 = config.security.encryptionKey): Buffer => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
};

export const open = (sealed: Buffer, keyBase64 = config.security.encryptionKey): string => {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) {
    throw new Error("Not a sealed value this build can open");
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyBase64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
