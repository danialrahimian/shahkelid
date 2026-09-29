import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";

import { PanelRejectedError } from "../src/modules/provisioning/driver";
import { PasarGuardDriver } from "../src/modules/provisioning/pasarguard";

/**
 * The PasarGuard driver against a real panel.
 *
 *   npm run test:contract
 *
 * Runs only when asked for (PASARGUARD_CONTRACT=1, set by that script) and
 * when a test panel is configured in .env (see .env.example). It creates
 * users named sk-contract-..., and deletes every one it made, pass or fail.
 *
 * What this proves that the other tests cannot: that the panel really
 * accepts what we send and answers what we read. A new panel version that
 * renames a field fails here, not in a customer's checkout.
 */

const url = process.env.PASARGUARD_TEST_URL;
const username = process.env.PASARGUARD_TEST_USERNAME;
const password = process.env.PASARGUARD_TEST_PASSWORD;
const groupId = Number(process.env.PASARGUARD_TEST_GROUP_ID ?? "1");
const enabled = process.env.PASARGUARD_CONTRACT === "1" && url && username && password;

const GB = 1024 ** 3;
const made: string[] = [];
const driver = enabled ? new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! }) : undefined;

const aName = () => {
  const name = `sk-contract-${randomBytes(4).toString("hex")}`;
  made.push(name);
  return name;
};

after(async () => {
  for (const name of made) await driver?.deleteUser(name).catch(() => undefined);
});

describe("PasarGuard driver against a real panel", { skip: !enabled && "set PASARGUARD_CONTRACT=1 and a test panel in .env" }, () => {
  it("When asked, then the panel reports its version and the groups we may use", async () => {
    const health = await driver!.health();
    const groups = await driver!.listGroups();

    assert.match(health.version ?? "", /^\d+\.\d+/);
    assert.ok(groups.some((group) => group.id === groupId), `group ${groupId} is visible`);
  });

  it("When a user is made to start on first use, then it is on hold with the whole duration waiting", async () => {
    const name = aName();

    const user = await driver!.createUser({
      username: name,
      startsOnFirstUse: true,
      durationSeconds: 30 * 86400,
      startsAtLatest: new Date(Date.now() + 30 * 86400_000),
      dataLimitBytes: 50 * GB,
      deviceLimit: 2,
      trafficReset: "no_reset",
      groupIds: [groupId],
      note: "shah-kelid contract test",
    });

    assert.equal(user.status, "on_hold");
    assert.equal(user.dataLimitBytes, 50 * GB);
    assert.equal(user.deviceLimit, 2);
    assert.equal(user.onHoldDurationSeconds, 30 * 86400);
    assert.equal(user.expiresAt, null);
    assert.deepEqual(user.groupIds, [groupId]);
    assert.match(user.subscriptionUrl, /^https?:\/\//);
  });

  it("When a user is made to start now, then it is active and expires when asked", async () => {
    const name = aName();
    const expiresAt = new Date(Date.now() + 7 * 86400_000);

    const user = await driver!.createUser({
      username: name,
      startsOnFirstUse: false,
      expiresAt,
      dataLimitBytes: null,
      deviceLimit: null,
      trafficReset: "monthly",
      groupIds: [groupId],
    });

    assert.equal(user.status, "active");
    assert.equal(user.dataLimitBytes, null, "0 on the panel reads back as unlimited");
    assert.ok(Math.abs(user.expiresAt!.getTime() - expiresAt.getTime()) < 2000, "the expiry survives the round trip");
  });

  it("When the same username is created twice, then the panel refuses the second, and reading finds the first", async () => {
    const name = aName();
    const input = {
      username: name,
      startsOnFirstUse: false as const,
      expiresAt: new Date(Date.now() + 86400_000),
      dataLimitBytes: GB,
      deviceLimit: null,
      trafficReset: "no_reset" as const,
      groupIds: [groupId],
    };
    const first = await driver!.createUser(input);

    await assert.rejects(driver!.createUser(input), PanelRejectedError);
    const found = await driver!.getUser(name);
    assert.equal(found?.id, first.id);
  });

  it("When a user does not exist, then reading gives null and deleting succeeds", async () => {
    assert.equal(await driver!.getUser("sk-contract-nobody-here"), null);
    await driver!.deleteUser("sk-contract-nobody-here");
  });

  it("When staff act on a user, then the panel does each thing: limits, disable, enable, reset, revoke, delete", async () => {
    const name = aName();
    const created = await driver!.createUser({
      username: name,
      startsOnFirstUse: false,
      expiresAt: new Date(Date.now() + 86400_000),
      dataLimitBytes: GB,
      deviceLimit: 1,
      trafficReset: "no_reset",
      groupIds: [groupId],
    });

    const changed = await driver!.updateLimits(name, { dataLimitBytes: 5 * GB, deviceLimit: 3 });
    assert.equal(changed.dataLimitBytes, 5 * GB);
    assert.equal(changed.deviceLimit, 3);

    assert.equal((await driver!.setEnabled(name, false)).status, "disabled");
    assert.equal((await driver!.setEnabled(name, true)).status, "active");

    assert.equal((await driver!.resetUsage(name)).usedBytes, 0);

    const revoked = await driver!.revokeSubscription(name);
    assert.notEqual(revoked.subscriptionUrl, created.subscriptionUrl, "a new link replaces the old");

    await driver!.deleteUser(name);
    assert.equal(await driver!.getUser(name), null);
  });

  it("When users are listed, then ours are in the list", async () => {
    const name = aName();
    await driver!.createUser({
      username: name,
      startsOnFirstUse: false,
      expiresAt: new Date(Date.now() + 86400_000),
      dataLimitBytes: GB,
      deviceLimit: null,
      trafficReset: "no_reset",
      groupIds: [groupId],
    });

    const { users, total } = await driver!.listUsers({ offset: 0, limit: 500 });

    assert.ok(total >= 1);
    assert.ok(users.some((user) => user.username === name));
  });

  it("When the subscription link is fetched like a client would, then it answers with usage headers", async () => {
    const name = aName();
    const user = await driver!.createUser({
      username: name,
      startsOnFirstUse: false,
      expiresAt: new Date(Date.now() + 86400_000),
      dataLimitBytes: GB,
      deviceLimit: null,
      trafficReset: "no_reset",
      groupIds: [groupId],
    });

    const response = await fetch(user.subscriptionUrl, { headers: { "user-agent": "v2rayNG/1.9.0" } });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("subscription-userinfo") ?? "", /total=\d+/);
  });

  it("When the password is wrong, then the driver says the panel refused, not that it is down", async () => {
    const wrong = new PasarGuardDriver(url!, { kind: "password", username: username!, password: "not-the-password" });

    await assert.rejects(wrong.health(), PanelRejectedError);
  });
});
