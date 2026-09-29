import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pino from "pino";

import { PasarGuardDriver } from "../src/modules/provisioning/pasarguard";
import { startProvisioningWorker } from "../src/modules/provisioning/worker";
import { panelUsernameFor } from "../src/modules/subscriptions/service";
import { startOutboxRelay } from "../src/platform/outbox/outbox";
import { createPublisher } from "../src/platform/queue/publisher";
import { TOPIC_ROUTES } from "../src/platform/queue/routes";
import { createProducerConnection } from "../src/platform/redis";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";
import { payInSandbox } from "./helpers/zarinpal-sandbox";

/**
 * M4's acceptance, end to end, with nothing faked:
 *
 *   a customer buys a plan → pays in Zarinpal's sandbox → comes back →
 *   the outbox, the queue and the worker put the subscription on the real
 *   test panel → the order page shows the link.
 *
 * The roadmap asks for under 10 seconds from paying to the link (and QR).
 *
 *   npm run test:contract
 */

const url = process.env.PASARGUARD_TEST_URL;
const username = process.env.PASARGUARD_TEST_USERNAME;
const password = process.env.PASARGUARD_TEST_PASSWORD;
const groupId = Number(process.env.PASARGUARD_TEST_GROUP_ID ?? "1");
const enabled = process.env.PASARGUARD_CONTRACT === "1" && url && username && password;

const made: string[] = [];

describe("M4 acceptance: Zarinpal sandbox to a working link", { skip: !enabled && "run with npm run test:contract and a test panel in .env" }, () => {
  let emails: ReturnType<typeof captureEmails>;

  before(async () => {
    await resetTestDatabase();
    await startTestServer();
    emails = captureEmails();
  });

  after(async () => {
    const driver = new PasarGuardDriver(url!, { kind: "password", username: username!, password: password! });
    for (const name of made) await driver.deleteUser(name).catch(() => undefined);
    emails.stop();
    await closeDatabase();
    await stopTestServer();
  });

  it("[acceptance] From paying in the sandbox to the link on the order page takes under 10 seconds", async () => {
    // The store: the real panel, a server, a plan.
    const staff = await signedInStaff(["owner"]);
    const tag = randomBytes(3).toString("hex");
    const panel = await staff.client.post("/api/v1/staff/panels", {
      name: "PasarGuard test",
      driver: "pasarguard",
      baseUrl: url,
      credentials: { kind: "password", username, password },
    });
    assert.equal(panel.status, 201, JSON.stringify(panel.data));
    const location = await staff.client.post("/api/v1/staff/locations", { code: "DE", nameFa: "آلمان", nameEn: "Germany" });
    await staff.client.post("/api/v1/staff/servers", {
      panelId: panel.data.id,
      locationId: location.data.id,
      name: "test-1",
      host: new URL(url!).host,
      panelGroupId: groupId,
      capacityUsers: 10,
    });
    const plan = await staff.client.post("/api/v1/staff/plans", {
      slug: `m4-${tag}`,
      name: "آزمون خرید",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 15_000,
      panels: [{ panelId: panel.data.id, groupIds: [] }],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));

    // The worker process, as it runs in production.
    const prefix = `test-${randomBytes(4).toString("hex")}`;
    const connection = createProducerConnection();
    const publisher = createPublisher({ connection, routes: TOPIC_ROUTES, prefix });
    const relay = startOutboxRelay({ db: database(), publish: publisher.publish, logger: pino({ level: "silent" }) });
    const worker = startProvisioningWorker({ db: database(), prefix });

    try {
      const buyer = await signedInCustomer(emails);
      const order = await buyer.client.post("/api/v1/shop/orders", { planId: plan.data.id }, { headers: { "idempotency-key": randomUUID() } });
      assert.equal(order.status, 201, JSON.stringify(order.data));
      const started = await buyer.client.post(`/api/v1/shop/orders/${order.data.id}/pay/zarinpal`);
      assert.equal(started.status, 200, JSON.stringify(started.data));

      const back = await payInSandbox(started.data.payUrl);
      const paidAt = Date.now();
      // The sandbox sends the browser to the public address; the test server is on its own port.
      const callback = await fetch(`${getBaseUrl()}${back.callback.pathname}${back.callback.search}`, { redirect: "manual" });
      assert.equal(callback.status, 303);

      let view = (await buyer.client.get(`/api/v1/shop/orders/${order.data.id}`)).data;
      while (!view.subscription?.link && Date.now() - paidAt < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        view = (await buyer.client.get(`/api/v1/shop/orders/${order.data.id}`)).data;
      }
      const elapsed = Date.now() - paidAt;
      if (view.subscription) made.push(panelUsernameFor(view.subscription.id));

      assert.equal(view.payment.status, "succeeded");
      assert.ok(view.subscription?.link, "the link is on the order page");
      assert.ok(elapsed < 10_000, `took ${elapsed} ms`);
      console.log(`  paying → link: ${elapsed} ms`);
    } finally {
      await relay.stop();
      await worker.close();
      await publisher.close();
      connection.disconnect();
    }
  });
});
