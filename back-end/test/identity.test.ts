import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import config from "../src/config";
import { auditLogs } from "../src/modules/access/schema";
import { getAppRedis } from "../src/platform/redis";
import { createClient } from "./helpers/api-client";
import {
  aStaffMember,
  authenticator,
  captureEmails,
  closeDatabase,
  database,
  suspend,
  uniqueEmail,
} from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Signing in, out, and everything in between: /api/v1/auth.
 *
 * Three of these are milestone M2's acceptance tests, marked [acceptance]:
 * staff cannot get in without an authenticator; five wrong passwords lock
 * password sign-in; (in access.test.ts) every role change is audited.
 */

type Client = ReturnType<typeof createClient>;
let emails: ReturnType<typeof captureEmails>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

beforeEach(() => {
  emails.sent.length = 0;
});

const V1 = "/api/v1";

const requestCode = (client: Client, email: string) => client.post(`${V1}/auth/code`, { email });

/** Signs in the way a person does: ask for a code, read the email, type it. */
const signInByCode = async (client: Client, email: string) => {
  const sent = await requestCode(client, email);
  assert.equal(sent.status, 202, `the code was not sent: ${JSON.stringify(sent.data)}`);
  return client.post(`${V1}/auth/code/verify`, { email, code: emails.lastCodeFor(email) });
};

const signInByPassword = (client: Client, email: string, password: string) =>
  client.post(`${V1}/auth/password`, { login: email, password });

/** Stands in for the minute that must pass between two codes to one address. */
const forgetCodeCooldown = (email: string) => getAppRedis().del(`code-cooldown:${email}`);

describe("Signing in with an emailed code", () => {
  it("When a new address signs in, then an account is made for it, already verified", async () => {
    const client = createClient();
    const email = uniqueEmail();

    const response = await signInByCode(client, email);

    assert.equal(response.status, 200);
    assert.equal(response.data.status, "signed_in");
    assert.equal(response.data.account.email, email);
    assert.equal(response.data.account.emailVerified, true);
    assert.equal(response.data.account.hasPassword, false);
    assert.equal(response.data.account.isStaff, false);
  });

  it("When the same address signs in again, then it is the same account", async () => {
    const email = uniqueEmail();
    const first = await signInByCode(createClient(), email);
    await forgetCodeCooldown(email);

    const second = await signInByCode(createClient(), email);

    assert.equal(second.data.account.id, first.data.account.id);
  });

  it("When a code is asked for, then the answer is the same for known and unknown addresses", async () => {
    const known = uniqueEmail();
    await signInByCode(createClient(), known);

    const forKnown = await requestCode(createClient(), uniqueEmail("other"));
    const forUnknown = await requestCode(createClient(), uniqueEmail("nobody"));

    assert.equal(forKnown.status, forUnknown.status);
    assert.deepEqual(forKnown.data, forUnknown.data);
  });

  it("When the code is typed in Persian digits, then it is accepted", async () => {
    const client = createClient();
    const email = uniqueEmail();
    await requestCode(client, email);
    const persian = emails
      .lastCodeFor(email)
      .replace(/\d/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)));

    const response = await client.post(`${V1}/auth/code/verify`, { email, code: persian });

    assert.equal(response.status, 200);
    assert.equal(response.data.status, "signed_in");
  });

  it("When a wrong code is entered, then it is refused; after five, even the right one is gone", async () => {
    const client = createClient();
    const email = uniqueEmail();
    await requestCode(client, email);
    const right = emails.lastCodeFor(email);
    const wrong = right === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await client.post(`${V1}/auth/code/verify`, { email, code: wrong });
      assert.equal(response.data.error.code, "CODE_WRONG", `attempt ${attempt}`);
    }
    const sixth = await client.post(`${V1}/auth/code/verify`, { email, code: right });
    assert.equal(sixth.data.error.code, "CODE_EXPIRED");
  });

  it("When a code has been used, then it cannot sign in a second time", async () => {
    const email = uniqueEmail();
    await requestCode(createClient(), email);
    const code = emails.lastCodeFor(email);

    const first = await createClient().post(`${V1}/auth/code/verify`, { email, code });
    const second = await createClient().post(`${V1}/auth/code/verify`, { email, code });

    assert.equal(first.status, 200);
    assert.equal(second.data.error.code, "CODE_EXPIRED");
  });

  it("When a second code is asked for within the minute, then it is refused with how long to wait", async () => {
    const email = uniqueEmail();
    await requestCode(createClient(), email);

    const again = await requestCode(createClient(), email);

    assert.equal(again.status, 429);
    assert.equal(again.data.error.code, "TOO_MANY_CODES");
    assert.ok(again.data.error.retryAfterSeconds > 0);
    assert.equal(again.headers.get("retry-after"), String(again.data.error.retryAfterSeconds));
  });

  it("When the account is suspended, then signing in is refused", async () => {
    const email = uniqueEmail();
    await signInByCode(createClient(), email);
    await suspend(email);
    await forgetCodeCooldown(email);

    const response = await signInByCode(createClient(), email);

    assert.equal(response.data.error.code, "ACCOUNT_SUSPENDED");
  });
});

describe("Passwords", () => {
  const withPassword = async (password = "correct horse battery") => {
    const client = createClient();
    const email = uniqueEmail();
    await signInByCode(client, email);
    const set = await client.put(`${V1}/auth/password`, { newPassword: password });
    assert.equal(set.status, 204);
    return { client, email, password };
  };

  it("When a first password is set, then the account can sign in with it", async () => {
    const { email, password } = await withPassword();

    const response = await signInByPassword(createClient(), email, password);

    assert.equal(response.status, 200);
    assert.equal(response.data.account.hasPassword, true);
  });

  it("When a password is too short, then it is refused with the field and the reason", async () => {
    const client = createClient();
    await signInByCode(client, uniqueEmail());

    const response = await client.put(`${V1}/auth/password`, { newPassword: "short" });

    assert.equal(response.status, 400);
    assert.deepEqual(response.data.error.fields, [{ path: "newPassword", code: "PASSWORD_TOO_SHORT" }]);
  });

  it("When the account already has a password, then it cannot be replaced without a reset code", async () => {
    const { client } = await withPassword();

    const response = await client.put(`${V1}/auth/password`, { newPassword: "another long password" });

    assert.equal(response.status, 409);
  });

  it("When the password is wrong or the address unknown, then the answer is identical", async () => {
    const { email } = await withPassword();

    const wrongPassword = await signInByPassword(createClient(), email, "not the password");
    const unknownAddress = await signInByPassword(createClient(), uniqueEmail("nobody"), "not the password");

    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.data, unknownAddress.data);
  });

  it("[acceptance] When five wrong passwords are tried, then password sign-in locks, even for the right one", async () => {
    const { email, password } = await withPassword();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await signInByPassword(createClient(), email, "not the password");
      assert.equal(response.data.error.code, "WRONG_CREDENTIALS", `attempt ${attempt}`);
    }
    const fifth = await signInByPassword(createClient(), email, "not the password");
    assert.equal(fifth.status, 423);
    assert.equal(fifth.data.error.code, "ACCOUNT_LOCKED");
    assert.ok(fifth.data.error.retryAfterSeconds > 0);

    const rightButLocked = await signInByPassword(createClient(), email, password);
    assert.equal(rightButLocked.data.error.code, "ACCOUNT_LOCKED");
  });

  it("When password sign-in is locked, then the owner can still get in with an emailed code", async () => {
    // Otherwise anyone who knows an address could keep its owner out.
    const { email } = await withPassword();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await signInByPassword(createClient(), email, "not the password");
    }
    await forgetCodeCooldown(email);

    const byCode = await signInByCode(createClient(), email);

    assert.equal(byCode.status, 200);
    assert.equal(byCode.data.status, "signed_in");
  });

  it("When a password is reset with an emailed code, then the old one stops working and the new one works", async () => {
    const { email, password } = await withPassword();
    await forgetCodeCooldown(email);

    const forgot = await createClient().post(`${V1}/auth/password/forgot`, { email });
    assert.equal(forgot.status, 202);
    const reset = await createClient().post(`${V1}/auth/password/reset`, {
      email,
      code: emails.lastCodeFor(email),
      newPassword: "a brand new long password",
    });
    assert.equal(reset.status, 200);

    assert.equal((await signInByPassword(createClient(), email, password)).status, 401);
    assert.equal(
      (await signInByPassword(createClient(), email, "a brand new long password")).status,
      200,
    );
  });

  it("When a password is reset, then every device already signed in is signed out (a thief with the old one too)", async () => {
    const { email, password } = await withPassword();
    const elsewhere = createClient();
    assert.equal((await signInByPassword(elsewhere, email, password)).status, 200);
    assert.equal((await elsewhere.get(`${V1}/auth/session`)).data.status, "signed_in");
    await forgetCodeCooldown(email);

    await createClient().post(`${V1}/auth/password/forgot`, { email });
    await createClient().post(`${V1}/auth/password/reset`, {
      email,
      code: emails.lastCodeFor(email),
      newPassword: "a brand new long password",
    });

    assert.equal((await elsewhere.get(`${V1}/auth/session`)).data.status, "signed_out");
    const fresh = createClient();
    assert.equal((await signInByPassword(fresh, email, "a brand new long password")).status, 200);
    assert.equal((await fresh.get(`${V1}/auth/session`)).data.status, "signed_in", "a sign-in after the reset counts");
  });

  it("When a reset is asked for an unknown address, then the answer is the same and no email goes out", async () => {
    const response = await createClient().post(`${V1}/auth/password/forgot`, {
      email: uniqueEmail("nobody"),
    });

    assert.equal(response.status, 202);
    assert.equal(emails.sent.length, 0);
  });
});

describe("Staff and two-factor sign-in", () => {
  it("[acceptance] When staff without an authenticator sign in, then they can do nothing until they set one up", async () => {
    const staff = await aStaffMember({ roleKeys: ["admin"] });
    const client = createClient();

    const signedIn = await signInByPassword(client, staff.email, staff.password);
    assert.equal(signedIn.data.status, "two_factor_setup_required");

    const blocked = await client.get(`${V1}/staff/roles`);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, "TWO_FACTOR_SETUP_REQUIRED");

    const setup = await client.post(`${V1}/auth/two-factor/setup`, {});
    assert.equal(setup.status, 200);
    assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\//);

    const enabled = await client.post(`${V1}/auth/two-factor/enable`, {
      code: authenticator(setup.data.secret).next(),
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.recoveryCodes.length, 10);
    assert.equal(enabled.data.session.status, "signed_in");

    const allowed = await client.get(`${V1}/staff/roles`);
    assert.equal(allowed.status, 200);
  });

  it("[acceptance] When staff with an authenticator sign in with a password, then they are only half in until the code", async () => {
    const staff = await aStaffMember({ roleKeys: ["admin"], withAuthenticator: true });
    const client = createClient();

    const signedIn = await signInByPassword(client, staff.email, staff.password);
    assert.equal(signedIn.data.status, "two_factor_pending");
    // Half in: nothing about the account is shown yet.
    assert.equal(signedIn.data.account, undefined);

    const blocked = await client.get(`${V1}/staff/roles`);
    assert.equal(blocked.status, 401);
    assert.equal(blocked.data.error.code, "TWO_FACTOR_REQUIRED");

    const verified = await client.post(`${V1}/auth/two-factor/verify`, {
      code: staff.authenticator!.next(),
    });
    assert.equal(verified.data.status, "signed_in");
    assert.equal((await client.get(`${V1}/staff/roles`)).status, 200);
  });

  it("When staff sign in with an emailed code instead, then the authenticator is still required", async () => {
    // An emailed code is one factor, like a password: it does not skip the second.
    const staff = await aStaffMember({ roleKeys: ["support"], withAuthenticator: true });

    const response = await signInByCode(createClient(), staff.email);

    assert.equal(response.data.status, "two_factor_pending");
  });

  it("When an authenticator code has been used once, then it does not work a second time", async () => {
    const staff = await aStaffMember({ roleKeys: ["admin"], withAuthenticator: true });
    const code = staff.authenticator!.next();

    const first = createClient();
    await signInByPassword(first, staff.email, staff.password);
    assert.equal((await first.post(`${V1}/auth/two-factor/verify`, { code })).status, 200);

    const second = createClient();
    await signInByPassword(second, staff.email, staff.password);
    const replay = await second.post(`${V1}/auth/two-factor/verify`, { code });
    assert.equal(replay.data.error.code, "CODE_WRONG");
  });

  it("When the phone is lost, then a recovery code gets in once, and its use is audited", async () => {
    const staff = await aStaffMember({ roleKeys: ["admin"] });
    const client = createClient();
    await signInByPassword(client, staff.email, staff.password);
    const setup = await client.post(`${V1}/auth/two-factor/setup`, {});
    const enabled = await client.post(`${V1}/auth/two-factor/enable`, {
      code: authenticator(setup.data.secret).next(),
    });
    const recovery: string = enabled.data.recoveryCodes[0];

    const lostPhone = createClient();
    await signInByPassword(lostPhone, staff.email, staff.password);
    const used = await lostPhone.post(`${V1}/auth/two-factor/verify`, { code: recovery.toLowerCase() });
    assert.equal(used.data.status, "signed_in");

    const again = createClient();
    await signInByPassword(again, staff.email, staff.password);
    const reused = await again.post(`${V1}/auth/two-factor/verify`, { code: recovery });
    assert.equal(reused.data.error.code, "CODE_WRONG");

    const audit = await database()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "account.recovery_code_used"));
    assert.ok(audit.some((entry) => entry.entityId === staff.id));
  });

  it("When five wrong authenticator codes are entered, then the second step locks", async () => {
    const staff = await aStaffMember({ roleKeys: ["admin"], withAuthenticator: true });
    const client = createClient();
    await signInByPassword(client, staff.email, staff.password);

    let last;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      last = await client.post(`${V1}/auth/two-factor/verify`, { code: "000000" });
    }

    assert.equal(last!.data.error.code, "ACCOUNT_LOCKED");
  });
});

describe("The session", () => {
  it("When someone signs out, then the session is over", async () => {
    const client = createClient();
    await signInByCode(client, uniqueEmail());

    assert.equal((await client.post(`${V1}/auth/sign-out`, {})).status, 204);

    assert.equal((await client.get(`${V1}/auth/session`)).data.status, "signed_out");
  });

  it("When another website submits a form to the API, then it is refused", async () => {
    const response = await createClient().post(
      `${V1}/auth/code`,
      { email: uniqueEmail() },
      { headers: { origin: "https://evil.example" } },
    );

    assert.equal(response.status, 403);
    assert.equal(response.data.error.code, "CROSS_ORIGIN");
  });

  it("When our own web app submits it, then it is accepted", async () => {
    const response = await createClient().post(
      `${V1}/auth/code`,
      { email: uniqueEmail() },
      { headers: { origin: config.cors.origin } },
    );

    assert.equal(response.status, 202);
  });

  it("When the site is opened at another address it is served on (www, a backup domain), then that is accepted too", async () => {
    const response = await createClient().post(
      `${V1}/auth/code`,
      { email: uniqueEmail() },
      { headers: { origin: "https://www.shop.test" } },
    );

    assert.equal(response.status, 202);
  });

  it("When an address under /api/v1 does not exist, then the answer is a JSON 404", async () => {
    const response = await createClient().get(`${V1}/nothing-here`);

    assert.equal(response.status, 404);
    assert.equal(response.data.error.code, "NOT_FOUND");
  });
});
