import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PasarGuardDriver } from "../src/modules/provisioning/pasarguard";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { syncSubscription } from "../src/modules/provisioning/sync";
import { panelUsernameFor } from "../src/modules/subscriptions/service";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * M3's acceptance, end to end, against the real test panel:
 *
 *   staff define a panel, a location, a server and a plan → make a
 *   subscription for a customer → it appears on the panel → our /s/ link
 *   gives the page its account data → usage is read back.
 *
 *   npm run test:contract
 *
 * Everything it makes on the panel is deleted at the end, pass or fail.
 * What it cannot do is carry real traffic: that part is checked by hand with
 * a VPN app (see docs/03-roadmap.md, M3).
 */

const url = process.env.PASARGUARD_TEST_URL;
const username = process.env.PASARGUARD_TEST_USERNAME;
const password = process.env.PASARGUARD_TEST_PASSWORD;
const groupId = Number(process.env.PASARGUARD_TEST_GROUP_ID ?? "1");
const enabled = process.env.PASARGUARD_CONTRACT === "1" && url && username && password;

const V1 = "/api/v1/staff";
const made: string[] = [];

describe("M3 acceptance against the real panel", { skip: !enabled && "set PASARGUARD_CONTRACT=1 and a test panel in .env" }, () => {
  before(async () => {
    await resetTestDatabase();
    await startTestServer();
  });

  after(async () => {
    const driver = new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! });
    for (const name of made) await driver.deleteUser(name).catch(() => undefined);
    await closeDatabase();
    await stopTestServer();
  });

  it("[acceptance] A subscription made by staff appears on the panel, its link works in a VPN app, and usage syncs", async () => {
    const staff = await signedInStaff(["owner"]);
    const tag = randomBytes(3).toString("hex");

    const panel = await staff.client.post(`${V1}/panels`, {
      name: "PasarGuard test",
      driver: "pasarguard",
      baseUrl: url,
      credentials: { kind: "password", username, password },
    });
    assert.equal(panel.status, 201, JSON.stringify(panel.data));
    assert.match(panel.data.version, /^5\./);

    const groups = await staff.client.get(`${V1}/panels/${panel.data.id}/groups`);
    assert.ok(groups.data.some((group: { id: number }) => group.id === groupId));

    const group = await staff.client.post(`${V1}/groups`, { name: "Germany" });
    assert.equal(group.status, 201, JSON.stringify(group.data));
    const sources = await staff.client.put(`${V1}/groups/${group.data.id}/sources`, {
      sources: [{ panelId: panel.data.id, panelGroupId: groupId, allHosts: true }],
    });
    assert.equal(sources.status, 200, JSON.stringify(sources.data));

    const plan = await staff.client.post(`${V1}/plans`, {
      slug: `acceptance-${tag}`,
      name: "آزمون پذیرش",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 0,
      groupIds: [group.data.id],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));

    const customer = await aCustomerAccount();
    const created = await staff.client.post(`${V1}/subscriptions`, { userId: customer.id, planId: plan.data.id });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.id as string;
    made.push(panelUsernameFor(id));

    // What the worker does for the outbox event.
    await provisionSubscription(database(), id);

    const onPanel = await new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! }).getUser(panelUsernameFor(id));
    assert.ok(onPanel, "the user is on the panel");
    assert.equal(onPanel.status, "on_hold");
    assert.equal(onPanel.dataLimitBytes, 1024 ** 3);
    assert.equal(onPanel.deviceLimit, 1);

    // The link's configs are the panel service's (panel/, Go); its contract
    // with a real panel is tried there. The page's account data is the shop's.
    const detail = await staff.client.get(`${V1}/subscriptions/${id}`);
    const link = new URL(detail.data.subscription.link);
    const info = await fetch(`${getBaseUrl()}${link.pathname}/info`);
    assert.equal(info.status, 200);

    await syncSubscription(database(), { id, panelUsername: panelUsernameFor(id) });
    const customerPage = await staff.client.get(`${V1}/customers/${customer.id}`);
    assert.equal(customerPage.data.subscriptions[0].id, id);
    assert.ok(customerPage.data.subscriptions[0].lastSyncedAt, "usage read back from the panel");

    const deleted = await staff.client.post(`${V1}/subscriptions/${id}/actions/delete`);
    assert.equal(deleted.data.status, "deleted");
    assert.equal(await new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! }).getUser(panelUsernameFor(id)), null);
  });
});
