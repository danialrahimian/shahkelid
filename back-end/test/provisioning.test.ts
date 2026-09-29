import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLogs } from "../src/modules/access/schema";
import { panels } from "../src/modules/infrastructure/schema";
import { setDriverFactory } from "../src/modules/provisioning/drivers";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { syncAllPanels } from "../src/modules/provisioning/sync";
import { runProvisionJob, startProvisioningWorker } from "../src/modules/provisioning/worker";
import { subscriptionEvents, subscriptions } from "../src/modules/subscriptions/schema";
import { panelUsernameFor, PROVISION_TOPIC } from "../src/modules/subscriptions/service";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { relayOutbox } from "../src/platform/outbox/outbox";
import { createPublisher } from "../src/platform/queue/publisher";
import { TOPIC_ROUTES } from "../src/platform/queue/routes";
import { createProducerConnection } from "../src/platform/redis";
import { createClient } from "./helpers/api-client";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Staff } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Panels, servers, plans and subscriptions: /api/v1/staff and /s/:token.
 *
 * The panel is a fake that behaves the way the contract tests showed the
 * real PasarGuard behaves (test/pasarguard.contract.test.ts). Everything
 * else is real: the API over HTTP, PostgreSQL, the outbox.
 */

const V1 = "/api/v1/staff";
const GB = 1024 ** 3;

/** A stand-in for the panel's own subscription links, served locally. */
let linkServer: Server;
let lastLinkRequest: IncomingHttpHeaders = {};
let linkBase = "";

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  installFakePanels();

  linkServer = createServer((req, res) => {
    lastLinkRequest = req.headers;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("subscription-userinfo", "upload=0; download=1024; total=53687091200; expire=0");
    res.setHeader("profile-web-page-url", "https://secret-panel.example/sub/abc");
    res.setHeader("x-powered-by-panel", "pasarguard");
    res.end(req.method === "HEAD" ? undefined : "vless://example@1.2.3.4:443#DE");
  });
  await new Promise<void>((resolve) => linkServer.listen(0, "127.0.0.1", resolve));
  linkBase = `http://127.0.0.1:${(linkServer.address() as AddressInfo).port}/sub`;
});

after(async () => {
  setDriverFactory(null);
  linkServer.close();
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

const subscribe = async (staff: Staff, planId: string) => {
  const customer = await aCustomerAccount();
  const response = await staff.client.post(`${V1}/subscriptions`, { userId: customer.id, planId });
  return { customer, response };
};

/** Makes a subscription and puts it on the panel, as the worker would. */
const aLiveSubscription = async (store: Awaited<ReturnType<typeof aStore>>) => {
  const { response } = await subscribe(store.staff, store.planId);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  await provisionSubscription(database(), response.data.id);
  const detail = await store.staff.client.get(`${V1}/subscriptions/${response.data.id}`);
  return detail.data.subscription as {
    id: string;
    status: string;
    link: string;
    usedBytes: number;
    expiresAt: string | null;
  };
};

const rowOf = async (id: string) =>
  (await database().select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!;

const historyOf = async (id: string) =>
  (
    await database()
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, id))
      .orderBy(subscriptionEvents.id)
  ).map((event) => event.kind);

// ------------------------------------------------------------------ panels

describe("Panels", () => {
  it("When a panel is added, then it is checked first, and its password is never shown again", async () => {
    const staff = await owner();

    const response = await staff.client.post(`${V1}/panels`, {
      name: "Main",
      driver: "pasarguard",
      baseUrl: "https://main-panel.test/",
      credentials: { kind: "password", username: "operator", password: "s3cret-pass" },
    });

    assert.equal(response.status, 201);
    assert.equal(response.data.baseUrl, "https://main-panel.test", "trailing slash dropped");
    assert.equal(response.data.version, "5.4.1-fake");
    assert.deepEqual(response.data.credentials, { kind: "password", username: "operator" });
    assert.doesNotMatch(JSON.stringify(response.data), /s3cret-pass/);

    const [row] = await database().select().from(panels).where(eq(panels.id, response.data.id));
    assert.doesNotMatch(row!.credentialsEnc.toString("latin1"), /s3cret-pass/, "stored encrypted");
    const [audit] = await database()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, response.data.id), eq(auditLogs.action, "panel.created")));
    assert.doesNotMatch(JSON.stringify(audit), /s3cret-pass/, "not in the audit log either");
  });

  it("When the panel refuses the credentials, then nothing is saved and the answer says why", async () => {
    const staff = await owner();

    const response = await staff.client.post(`${V1}/panels`, {
      name: "Typo",
      driver: "pasarguard",
      baseUrl: "https://typo-panel.test",
      credentials: { kind: "password", username: "operator", password: "wrong" },
    });

    assert.equal(response.status, 502);
    assert.equal(response.data.error.code, "PANEL_REJECTED");
    const saved = await database().select().from(panels).where(eq(panels.baseUrl, "https://typo-panel.test"));
    assert.equal(saved.length, 0);
  });

  it("When a server names a group the panel does not have, then it is refused", async () => {
    const store = await aStore();
    const [location] = (await store.staff.client.get(`${V1}/locations`)).data;

    const response = await store.staff.client.post(`${V1}/servers`, {
      panelId: store.panelId,
      locationId: location.id,
      name: "nowhere",
      host: "x.example.com",
      panelGroupId: 99,
      capacityUsers: 10,
    });

    assert.equal(response.status, 400);
    assert.equal(response.data.error.fields[0].path, "panelGroupId");
  });

  it("When support staff (no servers:manage) ask for the panels, then it is forbidden", async () => {
    const support = await signedInStaff(["support"]);

    assert.equal((await support.client.get(`${V1}/panels`)).status, 403);
    assert.equal((await support.client.get(`${V1}/customers`)).status, 200, "customers they may see");
  });
});

// ------------------------------------------------------------------- plans

describe("Plans", () => {
  it("When a plan is sold in gigabytes, then it is stored in bytes (binary GB, as the panel counts)", async () => {
    const store = await aStore();

    const plan = await store.staff.client.get(`${V1}/plans/${store.planId}`);

    assert.equal(plan.data.dataLimitBytes, 50 * GB);
    assert.equal(plan.data.priceToman, 150_000);
    assert.equal(plan.data.panels.length, 1);
  });

  it("When a slug is taken, then the second plan is refused on that field", async () => {
    const store = await aStore();
    const { data: plan } = await store.staff.client.get(`${V1}/plans/${store.planId}`);

    const response = await store.staff.client.post(`${V1}/plans`, {
      slug: plan.slug,
      name: "copy",
      dataLimitGb: null,
      durationDays: 30,
      deviceLimit: null,
      priceToman: 1,
      panels: [{ panelId: store.panelId, groupIds: [] }],
    });

    assert.equal(response.status, 409);
    assert.equal(response.data.error.fields[0].path, "slug");
  });
});

// ------------------------------------------------------------- placement

describe("Choosing a server", () => {
  it("When there are several servers, then the highest priority with room is chosen", async () => {
    const store = await aStore({
      servers: [
        { capacity: 10, priority: 0 },
        { capacity: 10, priority: 5 },
      ],
    });

    const { response } = await subscribe(store.staff, store.planId);

    assert.equal(response.data.server.id, store.serverIds[1]);
  });

  it("When a server is full, then the next one is used, and with none left the sale is refused", async () => {
    const store = await aStore({
      servers: [
        { capacity: 1, priority: 5 },
        { capacity: 1, priority: 0 },
      ],
    });

    const first = await subscribe(store.staff, store.planId);
    const second = await subscribe(store.staff, store.planId);
    const third = await subscribe(store.staff, store.planId);

    assert.equal(first.response.data.server.id, store.serverIds[0]);
    assert.equal(second.response.data.server.id, store.serverIds[1]);
    assert.equal(third.response.status, 409);
    assert.equal(third.response.data.error.code, "NO_SERVER_AVAILABLE");
  });

  it("When customers are placed, then the server list counts them", async () => {
    const store = await aStore({ servers: [{ capacity: 10, priority: 0 }] });
    await subscribe(store.staff, store.planId);
    await subscribe(store.staff, store.planId);

    const list = await store.staff.client.get(`${V1}/servers`);

    const server = list.data.find((row: { id: string }) => row.id === store.serverIds[0]);
    assert.equal(server.liveSubscriptions, 2);
  });

  it("When two sales race for the last place, then only one gets it", async () => {
    const store = await aStore({ servers: [{ capacity: 1, priority: 0 }] });
    const [a, b] = await Promise.all([aCustomerAccount(), aCustomerAccount()]);

    const results = await Promise.all(
      [a, b].map((customer) =>
        store.staff.client.post(`${V1}/subscriptions`, { userId: customer.id, planId: store.planId }),
      ),
    );

    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });
});

// ------------------------------------------------------------ provisioning

describe("Putting a subscription on the panel", () => {
  it("When a subscription is made, then it waits for the worker, with the job in the outbox", async () => {
    const store = await aStore();

    const { response } = await subscribe(store.staff, store.planId);

    assert.equal(response.status, 201);
    assert.equal(response.data.status, "provisioning");
    const events = await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateId, response.data.id), eq(outboxEvents.topic, PROVISION_TOPIC)));
    assert.equal(events.length, 1);
  });

  it("[acceptance] When the worker runs, then the user is on the panel with the plan's limits, on hold until first use", async () => {
    const store = await aStore({ planGroups: [7] });
    const { response } = await subscribe(store.staff, store.planId);

    await provisionSubscription(database(), response.data.id);

    const user = store.fake.users.get(panelUsernameFor(response.data.id))!;
    assert.equal(user.status, "on_hold");
    assert.equal(user.dataLimitBytes, 50 * GB);
    assert.equal(user.deviceLimit, 2);
    assert.equal(user.onHoldDurationSeconds, 30 * 86400);
    assert.deepEqual(user.groupIds, [2, 7], "the server's group and the plan's extra group");

    const detail = await store.staff.client.get(`${V1}/subscriptions/${response.data.id}`);
    assert.equal(detail.data.subscription.status, "on_hold");
    assert.equal(detail.data.subscription.expiresAt, null, "the clock has not started");
    assert.match(detail.data.subscription.link, /\/s\/[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(
      detail.data.history.map((event: { kind: string }) => event.kind),
      ["provisioned", "created"],
    );
  });

  it("When the real outbox, queue and worker run, then a new subscription reaches the panel on its own", async () => {
    const store = await aStore();
    const prefix = `test-${randomBytes(4).toString("hex")}`;
    const connection = createProducerConnection();
    const publisher = createPublisher({ connection, routes: TOPIC_ROUTES, prefix });
    const worker = startProvisioningWorker({ db: database(), prefix });
    try {
      const { response } = await subscribe(store.staff, store.planId);

      // Other tests' events may be waiting too; relaying them is harmless (the job is idempotent).
      await relayOutbox({ db: database(), publish: publisher.publish });

      const deadline = Date.now() + 10_000;
      while ((await rowOf(response.data.id)).status === "provisioning" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal((await rowOf(response.data.id)).status, "on_hold");
      assert.ok(store.fake.users.has(panelUsernameFor(response.data.id)));
    } finally {
      await worker.close();
      await publisher.close();
      connection.disconnect();
    }
  });

  it("When an earlier attempt made the user but its answer was lost, then the retry uses that user", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);
    // The lost attempt: the panel has the user, our row does not know it.
    await store.fake.createUser({
      username: panelUsernameFor(response.data.id),
      startsOnFirstUse: true,
      durationSeconds: 30 * 86400,
      startsAtLatest: new Date(Date.now() + 30 * 86400_000),
      dataLimitBytes: 50 * GB,
      deviceLimit: 2,
      trafficReset: "no_reset",
      groupIds: [2],
    });

    await provisionSubscription(database(), response.data.id);

    assert.equal(store.fake.users.size, 1, "no second user");
    assert.equal((await rowOf(response.data.id)).status, "on_hold");
  });

  it("When the worker runs twice for the same event, then the second does nothing", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);

    await provisionSubscription(database(), response.data.id);
    const calls = store.fake.calls.length;
    const again = await provisionSubscription(database(), response.data.id);

    assert.equal(again, "not_waiting");
    assert.equal(store.fake.calls.length, calls, "the panel was not asked again");
  });

  it("When the panel is down, then the attempt fails with the reason kept, and a later attempt succeeds", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);
    store.fake.down = true;

    await assert.rejects(
      runProvisionJob(database(), { data: { aggregateId: response.data.id }, attemptsMade: 0, opts: { attempts: 12 } }),
    );
    const waiting = await rowOf(response.data.id);
    assert.equal(waiting.status, "provisioning", "still waiting, not failed");
    assert.match(waiting.lastError ?? "", /down/);

    store.fake.down = false;
    await runProvisionJob(database(), { data: { aggregateId: response.data.id }, attemptsMade: 1, opts: { attempts: 12 } });
    assert.equal((await rowOf(response.data.id)).status, "on_hold");
  });

  it("When the last attempt fails, then the subscription waits for staff, and their retry puts it on the panel", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);
    const id = response.data.id;
    store.fake.down = true;

    await assert.rejects(
      runProvisionJob(database(), { data: { aggregateId: id }, attemptsMade: 11, opts: { attempts: 12 } }),
    );
    assert.equal((await rowOf(id)).status, "provisioning_failed");

    store.fake.down = false;
    const retried = await store.staff.client.post(`${V1}/subscriptions/${id}/actions/retry`);
    assert.equal(retried.data.status, "provisioning");
    const events = await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateId, id), eq(outboxEvents.topic, PROVISION_TOPIC)));
    assert.equal(events.length, 2, "a new job for the retry");

    await provisionSubscription(database(), id);
    assert.equal((await rowOf(id)).status, "on_hold");
    assert.deepEqual(await historyOf(id), ["created", "provisioning_failed", "retry", "provisioned"]);
  });

  it("When the panel refuses outright, then there are no more automatic attempts", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);
    store.fake.refuse = true;

    await assert.rejects(
      runProvisionJob(database(), { data: { aggregateId: response.data.id }, attemptsMade: 0, opts: { attempts: 12 } }),
      { name: "UnrecoverableError" },
    );
    assert.equal((await rowOf(response.data.id)).status, "provisioning_failed");
  });
});

// ------------------------------------------------------------------- usage

describe("Keeping usage in step with the panel", () => {
  it("[acceptance] When the customer uses the service, then staff see the usage after the sync", async () => {
    const store = await aStore();
    const subscription = await aLiveSubscription(store);
    const username = panelUsernameFor(subscription.id);

    store.fake.use(username, 3 * GB);
    await syncAllPanels(database());

    const detail = await store.staff.client.get(`${V1}/subscriptions/${subscription.id}`);
    assert.equal(detail.data.subscription.usedBytes, 3 * GB);
    assert.equal(detail.data.subscription.status, "active", "the first connection started the clock");
    assert.ok(detail.data.subscription.expiresAt, "and it now has an expiry");
    assert.ok(detail.data.subscription.lastSyncedAt);
    assert.ok(
      detail.data.history.some(
        (event: { kind: string; details: { from?: string; to?: string } }) =>
          event.kind === "status_changed" && event.details.from === "on_hold" && event.details.to === "active",
      ),
    );

    const customer = await store.staff.client.get(`${V1}/customers/${detail.data.subscription.userId}`);
    assert.equal(customer.data.subscriptions[0].usedBytes, 3 * GB, "on the customer's page too");
  });

  it("When the volume runs out, then the subscription reads as limited", async () => {
    const store = await aStore();
    const subscription = await aLiveSubscription(store);

    store.fake.use(panelUsernameFor(subscription.id), 50 * GB);
    await syncAllPanels(database());

    assert.equal((await rowOf(subscription.id)).status, "limited");
  });

  it("When a user disappears from the panel, then it is flagged once, not every sync", async () => {
    const store = await aStore();
    const subscription = await aLiveSubscription(store);
    store.fake.users.delete(panelUsernameFor(subscription.id));

    await syncAllPanels(database());
    await syncAllPanels(database());

    assert.equal((await rowOf(subscription.id)).lastError, "Not found on the panel");
    assert.equal((await historyOf(subscription.id)).filter((kind) => kind === "missing_on_panel").length, 1);
  });

  it("When one panel is down, then the others still sync, and the down one says why", async () => {
    const down = await aStore();
    const up = await aStore();
    const subscription = await aLiveSubscription(up);
    down.fake.down = true;
    up.fake.use(panelUsernameFor(subscription.id), GB);

    await syncAllPanels(database());

    assert.equal((await rowOf(subscription.id)).usedBytes, GB);
    const [row] = await database().select().from(panels).where(eq(panels.id, down.panelId));
    assert.match(row!.lastError ?? "", /down/);
  });
});

// ----------------------------------------------------------- staff actions

describe("What staff can do to a subscription", () => {
  it("When the link is revoked, then the old link stops working and a new one does", async () => {
    const store = await aStore();
    store.fake.subscriptionBase = linkBase;
    const subscription = await aLiveSubscription(store);
    const oldPath = new URL(subscription.link).pathname;

    const revoked = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/revoke_link`);

    assert.equal(revoked.status, 200);
    assert.notEqual(revoked.data.link, subscription.link);
    assert.equal((await fetch(`${getBaseUrl()}${oldPath}`)).status, 404);
    assert.equal((await fetch(`${getBaseUrl()}${new URL(revoked.data.link).pathname}`)).status, 200);
  });

  it("When staff disable, enable and reset usage, then the panel does it and the history says who", async () => {
    const store = await aStore();
    const subscription = await aLiveSubscription(store);
    store.fake.use(panelUsernameFor(subscription.id), GB);

    const disabled = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/disable`);
    assert.equal(disabled.data.status, "disabled");
    const enabled = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/enable`);
    assert.equal(enabled.data.status, "active");
    const reset = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/reset_usage`);
    assert.equal(reset.data.usedBytes, 0);

    const detail = await store.staff.client.get(`${V1}/subscriptions/${subscription.id}`);
    const staffEvents = detail.data.history.filter((event: { actorKind: string }) => event.actorKind === "staff");
    assert.deepEqual(
      staffEvents.map((event: { kind: string }) => event.kind),
      ["reset_usage", "enable", "disable", "created"],
    );
    assert.equal(staffEvents[0].actorEmail, store.staff.email);
  });

  it("When the panel is down, then the action fails and nothing changes here", async () => {
    const store = await aStore();
    const subscription = await aLiveSubscription(store);
    store.fake.down = true;

    const response = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/disable`);

    assert.equal(response.status, 503);
    assert.equal(response.data.error.code, "PANEL_UNREACHABLE");
    assert.equal((await rowOf(subscription.id)).status, "on_hold");
  });

  it("When a subscription is not on the panel yet, then panel actions are refused", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);

    const reset = await store.staff.client.post(`${V1}/subscriptions/${response.data.id}/actions/reset_usage`);

    assert.equal(reset.status, 409);
    assert.equal(reset.data.error.code, "NOT_PROVISIONED");
  });

  it("When a subscription is deleted, then it leaves the panel and its link, and frees its place", async () => {
    const store = await aStore({ servers: [{ capacity: 1, priority: 0 }] });
    store.fake.subscriptionBase = linkBase;
    const subscription = await aLiveSubscription(store);

    const deleted = await store.staff.client.post(`${V1}/subscriptions/${subscription.id}/actions/delete`);

    assert.equal(deleted.data.status, "deleted");
    assert.equal(store.fake.users.size, 0);
    assert.equal((await fetch(`${getBaseUrl()}${new URL(subscription.link).pathname}`)).status, 404);
    const next = await subscribe(store.staff, store.planId);
    assert.equal(next.response.status, 201, "the server has room again");
  });
});

// -------------------------------------------------------- the customer link

describe("The customer's link (/s/:token)", () => {
  it("When a VPN app fetches the link, then it gets the panel's answer, without the panel's address", async () => {
    const store = await aStore();
    store.fake.subscriptionBase = linkBase;
    const subscription = await aLiveSubscription(store);
    const path = new URL(subscription.link).pathname;

    const response = await fetch(`${getBaseUrl()}${path}`, {
      headers: { "user-agent": "v2rayNG/1.9.0", "x-hwid": "device-1", cookie: "secret=1" },
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "vless://example@1.2.3.4:443#DE");
    assert.match(response.headers.get("subscription-userinfo") ?? "", /total=53687091200/);
    assert.equal(response.headers.get("profile-web-page-url"), subscription.link, "our link, not the panel's");
    assert.equal(response.headers.get("x-powered-by-panel"), null, "nothing else from the panel");
    assert.equal(lastLinkRequest["user-agent"], "v2rayNG/1.9.0", "the app's name reaches the panel");
    assert.equal(lastLinkRequest["x-hwid"], "device-1", "and so does the device id, for the device limit");
    assert.equal(lastLinkRequest.cookie, undefined, "cookies do not");
  });

  it("When an app asks for headers only, then HEAD works too", async () => {
    const store = await aStore();
    store.fake.subscriptionBase = linkBase;
    const subscription = await aLiveSubscription(store);

    const response = await fetch(`${getBaseUrl()}${new URL(subscription.link).pathname}`, { method: "HEAD" });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("subscription-userinfo") ?? "", /total=/);
  });

  it("When the token is unknown or malformed, then it is a plain 404", async () => {
    assert.equal((await fetch(`${getBaseUrl()}/s/${"a".repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${getBaseUrl()}/s/..%2F..%2Fetc`)).status, 404);
  });

  it("When the subscription is still being made, then its link is not served yet", async () => {
    const store = await aStore();
    const { response } = await subscribe(store.staff, store.planId);

    assert.equal((await fetch(`${getBaseUrl()}${new URL(response.data.link).pathname}`)).status, 404);
  });
});

// --------------------------------------------------------------- customers

describe("Customers", () => {
  it("When staff search by email, then the customer is found with a count of live subscriptions", async () => {
    const store = await aStore();
    const { customer } = await subscribe(store.staff, store.planId);

    const found = await store.staff.client.get(`${V1}/customers?search=${encodeURIComponent(customer.email)}`);

    assert.equal(found.data.length, 1);
    assert.equal(found.data[0].liveSubscriptions, 1);
  });

  it("When someone who is not staff asks, then it is refused", async () => {
    const anonymous = createClient();

    assert.equal((await anonymous.get(`${V1}/customers`)).status, 401);
  });
});
