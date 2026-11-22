import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { orderItems, orders } from "../src/modules/billing/schema";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { syncSubscription } from "../src/modules/provisioning/sync";
import { applyRenewal } from "../src/modules/subscriptions/renewal";
import { SLACK_BYTES, SYNCED } from "../src/modules/subscriptions/members";
import { subscriptionPanels, subscriptions } from "../src/modules/subscriptions/schema";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { aCustomerAccount, closeDatabase, database } from "./helpers/accounts";
import type { FakePanel } from "./helpers/fake-panel";
import { resetTestDatabase } from "./helpers/postgres";
import { fakeFor, installFakePanels, owner } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * One subscription on several panels: the plan is sold on two panels, the
 * customer's user is made on both, their link carries both panels' configs,
 * and the volume is one: what is used on each panel adds up, and each panel
 * is told to stop at what it counted itself plus what is left overall.
 */

const STAFF = "/api/v1/staff";
const GB = 1024 ** 3;
let linkServer: Server;
let linkBase = "";

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  installFakePanels();
  // Both panels' subscription links: /a/... answers with panel A's configs, /b/... with B's.
  linkServer = createServer((req, res) => {
    const which = (req.url ?? "").startsWith("/a/") ? "A" : "B";
    if (which === "B" && bDown) {
      res.destroy();
      return;
    }
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("subscription-userinfo", "upload=0; download=1; total=2; expire=0");
    const links = which === "A" ? ["vless://a1@1.1.1.1:443#A-1", "vless://a2@1.1.1.2:443#A-2"] : ["trojan://b1@2.2.2.2:443#B-1"];
    res.end(Buffer.from(links.join("\n")).toString("base64"));
  });
  await new Promise<void>((resolve) => linkServer.listen(0, "127.0.0.1", resolve));
  linkBase = `http://127.0.0.1:${(linkServer.address() as AddressInfo).port}`;
});

after(async () => {
  linkServer.close();
  await closeDatabase();
  await stopTestServer();
});

let bDown = false;

// ----------------------------------------------------------------- arrange

/** Two panels, one of our groups taking a group from each, and a 50 GB plan sold through it. */
const twoPanels = async () => {
  const staff = await owner();
  const tag = randomBytes(3).toString("hex");
  const make = async (name: "a" | "b") => {
    const baseUrl = `https://panel-${name}-${tag}.test`;
    const fake = fakeFor(baseUrl);
    fake.groups = [{ id: 2, name: "de", inboundTags: ["vless-ws"] }];
    fake.subscriptionBase = `${linkBase}/${name}/sub`;
    const panel = await staff.client.post(`${STAFF}/panels`, {
      name: `Panel ${name.toUpperCase()} ${tag}`,
      driver: "pasarguard",
      baseUrl,
      credentials: { kind: "password", username: "operator", password: "right" },
    });
    assert.equal(panel.status, 201, JSON.stringify(panel.data));
    return { fake, panelId: panel.data.id as string };
  };
  const a = await make("a");
  const b = await make("b");
  const group = await staff.client.post(`${STAFF}/groups`, { name: `Germany ${tag}` });
  assert.equal(group.status, 201, JSON.stringify(group.data));
  const sources = await staff.client.put(`${STAFF}/groups/${group.data.id}/sources`, {
    sources: [
      { panelId: a.panelId, panelGroupId: 2, allHosts: true },
      { panelId: b.panelId, panelGroupId: 2, allHosts: true },
    ],
  });
  assert.equal(sources.status, 200, JSON.stringify(sources.data));
  const plan = await staff.client.post(`${STAFF}/plans`, {
    slug: `both-${tag}`,
    name: "دو پنل ۵۰ گیگ",
    dataLimitGb: 50,
    durationDays: 30,
    deviceLimit: 2,
    priceToman: 150_000,
    groupIds: [group.data.id],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.data));
  return { staff, a, b, groupId: group.data.id as string, planId: plan.data.id as string };
};

type Store = Awaited<ReturnType<typeof twoPanels>>;

const subscribe = async (store: Store) => {
  const customer = await aCustomerAccount();
  const made = await store.staff.client.post(`${STAFF}/subscriptions`, { userId: customer.id, planId: store.planId });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return { id: made.data.id as string, customer };
};

/** A subscription made on both panels, as the worker would. */
const aLive = async (store: Store) => {
  const { id, customer } = await subscribe(store);
  assert.equal(await provisionSubscription(database(), id), "provisioned");
  const [row] = await database().select().from(subscriptions).where(eq(subscriptions.id, id));
  return { id, customer, username: row!.panelUsername, token: row!.accessToken };
};

/**
 * Every live subscription read from its panels now, as the shop does when
 * one is opened. (The fleet sync is the panel service's, in Go, tested
 * there; the rules of one volume are the same on both sides.)
 */
const readAll = async () => {
  const live = await database()
    .select({ id: subscriptions.id, panelUsername: subscriptions.panelUsername })
    .from(subscriptions)
    .where(inArray(subscriptions.status, [...SYNCED]));
  for (const row of live) await syncSubscription(database(), row).catch(() => undefined);
};

const view = async (store: Store, id: string) => (await store.staff.client.get(`${STAFF}/subscriptions/${id}`)).data.subscription;
const on = (fake: FakePanel, username: string) => fake.users.get(username)!;
const used = (panels: { name: string; usedBytes: number }[], letter: string) =>
  panels.find((panel) => panel.name.startsWith(`Panel ${letter}`))!.usedBytes;

// ------------------------------------------------------------------ making

describe("A plan sold on two panels", () => {
  it("When a subscription is made, then its user is made on both panels, under one name and one link", async () => {
    const store = await twoPanels();

    const { id, username } = await aLive(store);

    assert.ok(on(store.a.fake, username), "on panel A");
    assert.ok(on(store.b.fake, username), "on panel B");
    assert.equal(on(store.a.fake, username).dataLimitBytes, 50 * GB);
    const subscription = await view(store, id);
    assert.equal(subscription.status, "on_hold");
    assert.equal(subscription.panels.length, 2);
    assert.ok(subscription.panels.every((panel: { onPanel: boolean }) => panel.onPanel));
    assert.equal(subscription.panel.id, store.a.panelId, "the group's first panel is the main one");
    assert.deepEqual(on(store.a.fake, username).groupIds, [2]);
    assert.deepEqual(on(store.b.fake, username).groupIds, [2]);
  });

  it("When one panel is down while it is made, then the customer gets the other at once, and staff are told", async () => {
    const store = await twoPanels();
    const { id } = await subscribe(store);
    store.b.fake.down = true;

    assert.equal(await provisionSubscription(database(), id), "provisioned");
    const [row] = await database().select().from(subscriptions).where(eq(subscriptions.id, id));
    assert.equal(row!.status, "on_hold");
    assert.equal(store.b.fake.users.has(row!.panelUsername), false);
    const waiting = (await view(store, id)).panels.find((panel: { onPanel: boolean }) => !panel.onPanel);
    assert.match(waiting.lastError, /down/);
    const alerts = await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, "admin.alert"), eq(outboxEvents.aggregateId, id)));
    assert.equal((alerts[0]!.payload as { subject: string }).subject, "A service was made on some of its panels only");

    // The panel service's sync makes it on B later, with what is left (its tests).
  });

  it("When both panels are down, then the attempt fails and is retried, as with one panel", async () => {
    const store = await twoPanels();
    const { id } = await subscribe(store);
    store.a.fake.down = true;
    store.b.fake.down = true;

    await assert.rejects(provisionSubscription(database(), id), /down/);

    store.a.fake.down = false;
    store.b.fake.down = false;
    assert.equal(await provisionSubscription(database(), id), "provisioned");
  });
});

// ------------------------------------------------------------------- usage

describe("One volume across the panels", () => {
  it("[acceptance] When 1 GB is used on one panel and 2 GB on the other, then each panel counts its own and the subscription has used 3 GB", async () => {
    const store = await twoPanels();
    const { id, username } = await aLive(store);
    store.a.fake.use(username, 1 * GB);
    store.b.fake.use(username, 2 * GB);

    await readAll();

    const subscription = await view(store, id);
    assert.equal(subscription.usedBytes, 3 * GB);
    assert.equal(subscription.dataLimitBytes, 50 * GB);
    assert.equal(used(subscription.panels, "A"), 1 * GB);
    assert.equal(used(subscription.panels, "B"), 2 * GB);
    assert.equal(on(store.a.fake, username).usedBytes, 1 * GB, "panel A's own count is untouched");
    assert.equal(on(store.b.fake, username).usedBytes, 2 * GB);
    // 47 GB is left overall: each panel may count that much more, and no more.
    assert.equal(on(store.a.fake, username).dataLimitBytes, 48 * GB);
    assert.equal(on(store.b.fake, username).dataLimitBytes, 49 * GB);
  });

  it("When usage grows by less than the slack, then the panels are not asked again; by more, they are", async () => {
    const store = await twoPanels();
    const { username } = await aLive(store);
    store.a.fake.use(username, 1 * GB);
    await readAll();
    const before = store.b.fake.updates.length;

    store.a.fake.use(username, SLACK_BYTES / 2);
    await readAll();
    assert.equal(store.b.fake.updates.length, before, "a few megabytes: left for later");

    store.a.fake.use(username, 2 * SLACK_BYTES);
    await readAll();
    assert.equal(store.b.fake.updates.length, before + 1);
    assert.equal(on(store.b.fake, username).dataLimitBytes, 50 * GB - on(store.a.fake, username).usedBytes);
  });

  it("When the volume is used up between the two panels, then the subscription is limited and both panels stop it", async () => {
    const store = await twoPanels();
    const { id, username } = await aLive(store);
    store.a.fake.use(username, 30 * GB);
    store.b.fake.use(username, 20 * GB);

    await readAll();

    const subscription = await view(store, id);
    assert.equal(subscription.status, "limited");
    assert.equal(subscription.usedBytes, 50 * GB);
    assert.equal(on(store.a.fake, username).dataLimitBytes, 30 * GB, "its own count, with nothing left to add");
    assert.equal(on(store.a.fake, username).status, "limited");
    assert.equal(on(store.b.fake, username).status, "limited");
  });

  it("When the first connection is on one panel, then the clock starts on the other with the same expiry", async () => {
    const store = await twoPanels();
    const { id, username } = await aLive(store);
    store.b.fake.use(username, 1024);
    assert.equal(on(store.a.fake, username).status, "on_hold");

    await readAll();

    const expiry = on(store.b.fake, username).expiresAt!;
    assert.equal(on(store.a.fake, username).status, "active");
    assert.equal(on(store.a.fake, username).expiresAt!.getTime(), expiry.getTime());
    const subscription = await view(store, id);
    assert.equal(subscription.status, "active");
    assert.equal(Date.parse(subscription.expiresAt), expiry.getTime());
  });

  it("When one panel is down at a sync, then the other is still read and the total keeps the down one's last count", async () => {
    const store = await twoPanels();
    const { id, username } = await aLive(store);
    store.a.fake.use(username, 1 * GB);
    store.b.fake.use(username, 2 * GB);
    await readAll();

    store.b.fake.down = true;
    store.a.fake.use(username, 4 * GB);
    await readAll();

    assert.equal((await view(store, id)).usedBytes, 7 * GB, "5 on A now, and B's last known 2");
    store.b.fake.down = false;
    await readAll();
    assert.equal(on(store.b.fake, username).dataLimitBytes, 2 * GB + 43 * GB);
  });
});

// -------------------------------------------------------------------- link

describe("Acting on a subscription that is on two panels", () => {
  it("When staff reset usage, disable, enable and delete, then both panels do it", async () => {
    const store = await twoPanels();
    const { id, username } = await aLive(store);
    store.a.fake.use(username, 5 * GB);
    store.b.fake.use(username, 5 * GB);
    await readAll();
    const act = (action: string) => store.staff.client.post(`${STAFF}/subscriptions/${id}/actions/${action}`);

    const reset = await act("reset_usage");
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal(reset.data.usedBytes, 0);
    assert.equal(on(store.a.fake, username).usedBytes, 0);
    assert.equal(on(store.b.fake, username).usedBytes, 0);
    assert.equal(on(store.a.fake, username).dataLimitBytes, 50 * GB, "the whole volume again, on each");
    assert.equal(on(store.b.fake, username).dataLimitBytes, 50 * GB);

    assert.equal((await act("disable")).data.status, "disabled");
    assert.equal(on(store.a.fake, username).status, "disabled");
    assert.equal(on(store.b.fake, username).status, "disabled");
    assert.equal((await act("enable")).data.status, "active");

    assert.equal((await act("delete")).data.status, "deleted");
    assert.equal(store.a.fake.users.has(username), false);
    assert.equal(store.b.fake.users.has(username), false);
  });

  it("When a renewal is applied, then the new volume is one total and each panel gets its share of it", async () => {
    const store = await twoPanels();
    const { id, customer, username } = await aLive(store);
    store.a.fake.use(username, 10 * GB);
    store.b.fake.use(username, 20 * GB);
    await readAll();
    const expiryBefore = on(store.a.fake, username).expiresAt!.getTime();

    // A paid renewal order for the same plan, as checkout leaves it.
    const [order] = await database()
      .insert(orders)
      .values({ userId: customer.id, kind: "renewal", status: "paid", subscriptionId: id, subtotalToman: 150_000, totalToman: 150_000, expiresAt: new Date(Date.now() + 3600_000), paidAt: new Date() })
      .returning();
    await database().insert(orderItems).values({
      orderId: order!.id,
      planId: store.planId,
      planSnapshot: { id: store.planId, slug: "both", name: "دو پنل ۵۰ گیگ", description: "", dataLimitBytes: 50 * GB, durationDays: 30, deviceLimit: 2, priceToman: 150_000, trafficReset: "no_reset" },
      unitPriceToman: 150_000,
      totalToman: 150_000,
    });

    assert.equal(await applyRenewal(database(), order!.id), "renewed");

    const subscription = await view(store, id);
    assert.equal(subscription.dataLimitBytes, 100 * GB, "30 used + 20 left + 50 bought");
    assert.equal(subscription.usedBytes, 30 * GB);
    assert.equal(on(store.a.fake, username).dataLimitBytes, 10 * GB + 70 * GB);
    assert.equal(on(store.b.fake, username).dataLimitBytes, 20 * GB + 70 * GB);
    assert.equal(on(store.a.fake, username).expiresAt!.getTime() - expiryBefore, 30 * 86400_000);
    assert.equal(on(store.b.fake, username).expiresAt!.getTime(), on(store.a.fake, username).expiresAt!.getTime());

    const rows = await database().select().from(subscriptionPanels).where(eq(subscriptionPanels.subscriptionId, id));
    assert.equal(rows.length, 2);
  });
});
