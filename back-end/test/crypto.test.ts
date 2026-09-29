import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { open, seal } from "../src/platform/crypto/secret-box";
import { hashPassword, needsRehash, verifyPassword } from "../src/platform/crypto/password";
import {
  base32Decode,
  base32Encode,
  codeAt,
  matchCode,
  otpauthUri,
  stepAt,
} from "../src/modules/identity/totp";

describe("Authenticator codes (RFC 6238)", () => {
  // The RFC's own test vectors (Appendix B, SHA-1): the secret is the ASCII
  // string "12345678901234567890", and codes are eight digits there.
  const secret = Buffer.from("12345678901234567890", "ascii");
  const vectors: [seconds: number, code: string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [seconds, expected] of vectors) {
    it(`When the time is ${seconds}s, then the code is ${expected}`, () => {
      assert.equal(codeAt(secret, stepAt(seconds * 1000), 8), expected);
    });
  }

  it("When a phone clock is one step behind, then its code still matches, and says which step", () => {
    const base32 = base32Encode(secret);
    const now = 1234567890 * 1000;
    const previousCode = codeAt(secret, stepAt(now) - 1);
    assert.equal(matchCode(base32, previousCode, now), stepAt(now) - 1);
  });

  it("When a code is two steps old, then it no longer matches", () => {
    const base32 = base32Encode(secret);
    const now = 1234567890 * 1000;
    assert.equal(matchCode(base32, codeAt(secret, stepAt(now) - 2), now), null);
  });

  it("When base32 is encoded and decoded, then the bytes survive the round trip", () => {
    // RFC 4648 test vector.
    assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
    assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
  });

  it("When the setup link is built, then an authenticator app can read it", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "ali@example.com", issuer: "Shah Kelid" });
    assert.match(uri, /^otpauth:\/\/totp\/Shah%20Kelid%3Aali%40example\.com\?/);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
    assert.match(uri, /period=30/);
  });
});

describe("Secrets at rest", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("When a secret is sealed and opened with the same key, then it comes back intact", () => {
    assert.equal(open(seal("JBSWY3DPEHPK3PXP", key), key), "JBSWY3DPEHPK3PXP");
  });

  it("When the same secret is sealed twice, then the two results differ", () => {
    // A fresh IV each time: equal ciphertexts would reveal equal secrets.
    assert.notDeepEqual(seal("same", key), seal("same", key));
  });

  it("When a sealed value is tampered with, then it refuses to open rather than returning garbage", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP", key);
    sealed[sealed.length - 1]! ^= 1;
    assert.throws(() => open(sealed, key));
  });

  it("When it is opened with another key, then it refuses", () => {
    assert.throws(() => open(seal("secret", key), Buffer.alloc(32, 8).toString("base64")));
  });
});

describe("Passwords", () => {
  it("When the right password is given, then it verifies; the wrong one does not", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
    assert.equal(await verifyPassword("correct horse battery stapler", hash), false);
  });

  it("When the same password is hashed twice, then the hashes differ (each has its own salt)", async () => {
    assert.notEqual(await hashPassword("same password"), await hashPassword("same password"));
  });

  it("When a Persian password is typed on a keyboard with Arabic ی and ک, then it still verifies", async () => {
    // Set on one device with Persian letters, typed on another whose layout
    // produces the Arabic ones. They look identical; they must match.
    const hash = await hashPassword("کلید-یاسمن");
    assert.equal(await verifyPassword("كليد-ياسمن", hash), true);
  });

  it("When a password contains a compatibility character, then its plain form verifies", async () => {
    const hash = await hashPassword("ﬁle-password"); // the "fi" ligature
    assert.equal(await verifyPassword("file-password", hash), true);
  });

  it("When a hash uses weaker settings than today's, then it is due for re-hashing", () => {
    assert.equal(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA=="), true);
  });

  it("When the stored value is not a hash at all, then nothing verifies against it", async () => {
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
  });
});
