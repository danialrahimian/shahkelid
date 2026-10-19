import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { OwnerExistsError } from "../src/modules/access/bootstrap";
import {
  createUsernameOwner,
  listOwners,
  resetUsernameTwoFactor,
  setUsernamePassword,
} from "../src/modules/access/owners";
import { userRecoveryCodes, users } from "../src/modules/identity/schema";
import { getAppRedis } from "../src/platform/redis";
import { createClient } from "./helpers/api-client";
import { closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The owner the installer makes: a username and a password, no email. It
 * must reach the staff area with no mail service set up, and still be held
 * to two-step sign-in like every staff account.
 */

const V1 = "/api/v1";
const PASSWORD = "a long enough password";

const signIn = (login: string, password = PASSWORD) =>
  createClient().post(`${V1}/auth/password`, { login, password });

before(async () => {
  await resetTestDatabase();
  await startTestServer();
});

after(async () => {
  await closeDatabase();
  await stopTestServer();
});

describe("An owner with a username", () => {
  it("Signs in with the username in any case, and is made to set up an authenticator first", async () => {
    await createUsernameOwner(database(), "boss", PASSWORD);

    const response = await signIn("Boss");

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.status, "two_factor_setup_required");
    assert.equal(response.data.account.username, "boss");
    assert.equal(response.data.account.email, null);
  });

  it("Is not made twice by mistake: a second owner needs --another", async () => {
    await assert.rejects(createUsernameOwner(database(), "second", PASSWORD), OwnerExistsError);
    // The refused owner's account went with the refusal.
    assert.equal((await database().select().from(users).where(eq(users.username, "second"))).length, 0);

    await createUsernameOwner(database(), "second", PASSWORD, { another: true });
    const names = (await listOwners(database())).map((owner) => owner.username).sort();
    assert.deepEqual(names, ["boss", "second"]);
  });

  it("A username is not given twice", async () => {
    await assert.rejects(createUsernameOwner(database(), "boss", PASSWORD, { another: true }), /taken/);
  });

  it("A wrong password is refused like any other, and locks after five", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await signIn("boss", "not the password");
      // The fifth is told about the lock at once.
      assert.ok(["WRONG_CREDENTIALS", "ACCOUNT_LOCKED"].includes(wrong.data.error.code));
    }
    const locked = await signIn("boss");
    assert.equal(locked.data.error.code, "ACCOUNT_LOCKED");
  });

  it("A new password from the server lifts the lock and ends every session", async () => {
    const before = await database().select().from(users).where(eq(users.username, "boss"));
    await setUsernamePassword(database(), getAppRedis(), "boss", "another long password");

    assert.equal((await signIn("boss")).status, 401, "the old password is gone");
    assert.equal((await signIn("boss", "another long password")).data.status, "two_factor_setup_required");
    const [after] = await database().select().from(users).where(eq(users.id, before[0]!.id));
    assert.ok(after!.sessionsRevokedAt, "sessions signed in before are over");
  });

  it("Two-step sign-in can be turned off from the server, to be set up again", async () => {
    const [boss] = await database().select().from(users).where(eq(users.username, "boss"));
    await database().update(users).set({ totpEnabledAt: new Date(), totpSecretEnc: randomBytes(32) }).where(eq(users.id, boss!.id));
    await database().insert(userRecoveryCodes).values({ userId: boss!.id, codeHash: randomBytes(32).toString("hex") });

    await resetUsernameTwoFactor(database(), getAppRedis(), "boss");

    const [after] = await database().select().from(users).where(eq(users.id, boss!.id));
    assert.equal(after!.totpEnabledAt, null);
    assert.equal(after!.totpSecretEnc, null);
    assert.equal((await database().select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, boss!.id))).length, 0);
    assert.equal((await signIn("boss", "another long password")).data.status, "two_factor_setup_required");
  });

  it("Staff screens name it by its username", async () => {
    const admin = await signedInStaff(["owner"]);
    const team = await admin.client.get(`${V1}/staff/team`);
    const boss = team.data.find((member: { username: string | null }) => member.username === "boss");
    assert.equal(boss.email, "boss");
  });
});
