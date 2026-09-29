import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PasarGuardDriver } from "../src/modules/provisioning/pasarguard";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { syncAllPanels } from "../src/modules/provisioning/sync";
import { panelUsernameFor } from "../src/modules/subscriptions/service";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * M3's acceptance, end to end, against the real test panel:
 *
 *   staff define a panel, a location, a server and a plan → make a
 *   subscription for a customer → it appears on the panel → our /s/ link
 *   serves the panel's configurations to a VPN app → usage is synced back.
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

    const location = await staff.client.post(`${V1}/locations`, { code: "DE", nameFa: "آلمان", nameEn: "Germany" });
    const server = await staff.client.post(`${V1}/servers`, {
      panelId: panel.data.id,
      locationId: location.data.id,
      name: "test-1",
      host: new URL(url!).host,
      panelGroupId: groupId,
      capacityUsers: 10,
    });
    assert.equal(server.status, 201, JSON.stringify(server.data));

    const plan = await staff.client.post(`${V1}/plans`, {
      slug: `acceptance-${tag}`,
      name: "آزمون پذیرش",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 0,
      panels: [{ panelId: panel.data.id, groupIds: [] }],
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

    const detail = await staff.client.get(`${V1}/subscriptions/${id}`);
    const link = new URL(detail.data.subscription.link);
    const response = await fetch(`${getBaseUrl()}${link.pathname}`, {
      headers: { "user-agent": "v2rayNG/1.9.0", "x-hwid": `acceptance-${tag}` },
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("subscription-userinfo") ?? "", /total=1073741824/);
    assert.doesNotMatch(response.headers.get("profile-web-page-url") ?? "", new RegExp(new URL(url!).host));
    // v2rayNG reads base64 of one link per line.
    const decoded = Buffer.from(body, "base64").toString("utf8");
    assert.match(decoded, /^(vless|vmess|trojan|ss):\/\//m, "configurations a VPN app can import");

    const synced = await syncAllPanels(database());
    assert.ok(!("error" in synced[panel.data.id]!), JSON.stringify(synced));
    const customerPage = await staff.client.get(`${V1}/customers/${customer.id}`);
    assert.equal(customerPage.data.subscriptions[0].id, id);
    assert.ok(customerPage.data.subscriptions[0].lastSyncedAt, "usage read back from the panel");

    const deleted = await staff.client.post(`${V1}/subscriptions/${id}/actions/delete`);
    assert.equal(deleted.data.status, "deleted");
    assert.equal(await new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! }).getUser(panelUsernameFor(id)), null);
  });
});
