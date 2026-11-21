import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { forgetCatalog } from "../src/modules/groups/catalog";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import type { FakePanel } from "./helpers/fake-panel";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, type Store } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Our groups, end to end: staff make a group from the panels' groups, pick
 * and rename its hosts, and put hosts and groups in order (drag and drop in
 * the dashboard sends the new order); plans are sold with groups; and the
 * customer's link gives exactly what the groups say, in every format the
 * apps read, whatever order staff choose.
 */

const V1 = "/api/v1/staff";
const GB = 1024 ** 3;

/** The panels' own subscription links, served from the fakes: /<panel key>/<username>-<id>. */
let linkServer: Server;
let linkBase = "";
const byKey = new Map<string, FakePanel>();

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  installFakePanels();
  linkServer = createServer((req, res) => {
    const [, key, rest] = (req.url ?? "").split("?")[0]!.split("/");
    const fake = byKey.get(key ?? "");
    const username = (rest ?? "").slice(0, (rest ?? "").lastIndexOf("-"));
    if (!fake || !fake.users.has(username)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    const { body, contentType } = fake.render(username, req.headers["user-agent"] ?? "");
    res.setHeader("content-type", contentType);
    res.end(body);
  });
  await new Promise<void>((resolve) => linkServer.listen(0, "127.0.0.1", resolve));
  linkBase = `http://127.0.0.1:${(linkServer.address() as AddressInfo).port}`;
});

after(async () => {
  linkServer.close();
  await closeDatabase();
  await stopTestServer();
});

beforeEach(() => forgetCatalog());

// ----------------------------------------------------------------- arrange

/**
 * The panel's groups and hosts in these tests: group 2 ("de") grants the
 * vless and vmess inbounds, group 7 ("nl") the trojan one. Hosts, in the
 * panel's order: DE-1 (vless), DE-2 (vmess), NL (trojan), DE-3 (vless).
 */
const shape = (fake: FakePanel) => {
  fake.groups = [
    { id: 1, name: "tunnel", inboundTags: [] },
    { id: 2, name: "de", inboundTags: ["vless-ws", "vmess-tcp"] },
    { id: 7, name: "nl", inboundTags: ["trojan-grpc"] },
  ];
  fake.hosts = [
    { id: 1, remark: "🇩🇪 DE-1 {USERNAME}", inboundTag: "vless-ws", port: null, priority: 1, disabled: false, statuses: [], address: "de1.example.com" },
    { id: 2, remark: "🇩🇪 DE-2 [{PROTOCOL}]", inboundTag: "vmess-tcp", port: null, priority: 2, disabled: false, statuses: [], address: "de2.example.com" },
    { id: 3, remark: "🇳🇱 NL {DATA_LEFT}", inboundTag: "trojan-grpc", port: null, priority: 3, disabled: false, statuses: [], address: "nl.example.com" },
    { id: 4, remark: "🇩🇪 DE-3", inboundTag: "vless-ws", port: null, priority: 4, disabled: false, statuses: [], address: "de3.example.com" },
  ];
  const key = randomBytes(4).toString("hex");
  byKey.set(key, fake);
  fake.subscriptionBase = `${linkBase}/${key}`;
};

const aShapedStore = async () => {
  const store = await aStore();
  shape(store.fake);
  return store;
};

const api = (store: Store) => store.staff.client;

/** The fake panel's hosts by their number in these tests, read from the names the panel gives them. */
const LABELS: Record<number, string> = { 1: "DE-1", 2: "DE-2", 3: "NL", 4: "DE-3" };
const numberOf = (remark: string) => Number(Object.entries(LABELS).find(([, label]) => remark.split(" ")[1] === label)?.[0]);

type HostRow = { hostId: string; n: number; selected: boolean; forced: boolean; name: string | null; remark: string; panelId: string };

const hostsOf = async (store: Store, groupId = store.groupId): Promise<HostRow[]> => {
  const response = await api(store).get(`${V1}/groups/${groupId}/hosts`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return (response.data.hosts as Omit<HostRow, "n">[]).map((host) => ({ ...host, n: numberOf(host.remark) }));
};

/** Our id of a host, by its number; one the group does not have gets an id no host has. */
const idOf = async (store: Store, n: number, groupId = store.groupId) =>
  (await hostsOf(store, groupId)).find((host) => host.n === n)?.hostId ?? "not-in-this-group";

const setHost = async (store: Store, n: number, change: { selected?: boolean; name?: string | null }, groupId = store.groupId) =>
  api(store).patch(`${V1}/groups/${groupId}/hosts/${store.panelId}/${await idOf(store, n, groupId)}`, change);

const orderHosts = async (store: Store, order: number[], groupId = store.groupId) => {
  const hosts = await hostsOf(store, groupId);
  return api(store).put(`${V1}/groups/${groupId}/hosts/order`, {
    hosts: order.map((n) => ({ panelId: store.panelId, hostId: hosts.find((host) => host.n === n)!.hostId })),
  });
};

const setSources = (store: Store, sources: { panelGroupId: number; allHosts: boolean; panelId?: string }[], groupId = store.groupId) =>
  api(store).put(`${V1}/groups/${groupId}/sources`, {
    sources: sources.map((source) => ({ panelId: store.panelId, ...source })),
  });

/** A customer's subscription, made on the panel as the worker would. */
const aLive = async (store: Store, planId = store.planId) => {
  const customer = await aCustomerAccount();
  const made = await api(store).post(`${V1}/subscriptions`, { userId: customer.id, planId });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(await provisionSubscription(database(), made.data.id), "provisioned");
  const [row] = await database().select().from(subscriptions).where(eq(subscriptions.id, made.data.id));
  return { id: row!.id, token: row!.accessToken, username: row!.panelUsername };
};


// ------------------------------------------------------------ the groups

describe("Making and naming groups", () => {
  it("When a group is made, renamed and listed, then staff see it with what it takes and what sells it", async () => {
    const store = await aShapedStore();

    const made = await api(store).post(`${V1}/groups`, { name: "  Turkey  " });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.equal(made.data.name, "Turkey", "trimmed");
    assert.deepEqual(made.data.sources, []);

    const renamed = await api(store).put(`${V1}/groups/${made.data.id}`, { name: "Türkiye" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(renamed.data.name, "Türkiye");

    const list = (await api(store).get(`${V1}/groups`)).data as { id: string; name: string; plans: { id: string }[]; sources: unknown[] }[];
    const ours = list.find((group) => group.id === store.groupId)!;
    assert.deepEqual(ours.plans.map((plan) => plan.id), [store.planId], "the plan sold with it");
    assert.equal(ours.sources.length, 1);
    assert.ok(list.some((group) => group.name === "Türkiye"));
  });

  it("When a name is empty, then it is refused on that field", async () => {
    const store = await aShapedStore();
    const response = await api(store).post(`${V1}/groups`, { name: "   " });
    assert.equal(response.status, 400);
    assert.equal(response.data.error.fields[0].path, "name");
  });

  it("When a group is deleted, then it goes; one that sells a plan or serves customers is kept", async () => {
    const store = await aShapedStore();
    const spare = (await api(store).post(`${V1}/groups`, { name: "Spare" })).data;

    assert.equal((await api(store).delete(`${V1}/groups/${spare.id}`)).status, 204);
    assert.equal((await api(store).get(`${V1}/groups/${spare.id}`)).status, 404);

    const selling = await api(store).delete(`${V1}/groups/${store.groupId}`);
    assert.equal(selling.status, 409, "a plan is sold with it");

    // Its customers keep it even when no plan sells it any more.
    await aLive(store);
    const other = (await api(store).post(`${V1}/groups`, { name: "Other" })).data;
    const plan = (await api(store).get(`${V1}/plans/${store.planId}`)).data;
    const moved = await api(store).put(`${V1}/plans/${store.planId}`, {
      slug: plan.slug,
      name: plan.name,
      dataLimitGb: 50,
      durationDays: 30,
      deviceLimit: 2,
      priceToman: 150_000,
      groupIds: [other.id],
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const serving = await api(store).delete(`${V1}/groups/${store.groupId}`);
    assert.equal(serving.status, 409, "a customer has it");
  });

  it("When a plan names a group that does not exist, then it is refused", async () => {
    const store = await aShapedStore();
    const response = await api(store).post(`${V1}/plans`, {
      slug: `x-${randomBytes(3).toString("hex")}`,
      name: "x",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 1,
      groupIds: ["00000000-0000-7000-8000-000000000000"],
    });
    assert.equal(response.status, 400);
    assert.equal(response.data.error.fields[0].path, "groupIds");
  });

  it("When staff without servers:manage ask for the groups, then it is forbidden", async () => {
    const support = await signedInStaff(["support"]);
    assert.equal((await support.client.get(`${V1}/groups`)).status, 403);
    assert.equal((await support.client.post(`${V1}/groups`, { name: "x" })).status, 403);
  });
});

describe("What a group takes from the panels", () => {
  it("When a panel group is taken with all its hosts, then every host of its inbounds is in, and cannot be left out", async () => {
    const store = await aShapedStore();

    const hosts = await hostsOf(store);

    assert.deepEqual(hosts.map((host) => host.n), [1, 2, 4], "the vless and vmess hosts, in the panel's order");
    assert.ok(hosts.every((host) => host.selected && host.forced));
    const refused = await setHost(store, 1, { selected: false });
    assert.equal(refused.status, 409, "turn off 'all hosts' first");
  });

  it("When 'all hosts' is off, then none is in until picked, and the picked ones are kept", async () => {
    const store = await aShapedStore();

    assert.equal((await setSources(store, [{ panelGroupId: 2, allHosts: false }])).status, 200);
    assert.ok((await hostsOf(store)).every((host) => !host.selected && !host.forced));

    assert.equal((await setHost(store, 4, { selected: true })).status, 200);
    assert.equal((await setHost(store, 1, { selected: true })).status, 200);
    assert.equal((await setHost(store, 1, { selected: false })).status, 200);
    const hosts = await hostsOf(store);
    assert.deepEqual(hosts.filter((host) => host.selected).map((host) => host.n), [4]);
  });

  it("When another panel group is added or one is removed, then the hosts follow", async () => {
    const store = await aShapedStore();

    await setSources(store, [{ panelGroupId: 2, allHosts: true }, { panelGroupId: 7, allHosts: true }]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.n), [1, 2, 4, 3], "panel group by panel group, each in the panel's order");

    await setSources(store, [{ panelGroupId: 7, allHosts: true }]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.n), [3]);
  });

  it("When the same panel group is given twice, then it is refused", async () => {
    const store = await aShapedStore();
    const response = await setSources(store, [
      { panelGroupId: 2, allHosts: true },
      { panelGroupId: 2, allHosts: false },
    ]);
    assert.equal(response.status, 400);
  });

  it("When a host is asked for that the group does not take, then it is not found", async () => {
    const store = await aShapedStore();
    assert.equal((await setHost(store, 3, { selected: true })).status, 404);
  });
});

describe("Naming and ordering hosts and groups", () => {
  it("When a host is renamed, then the name is kept; an empty name goes back to the panel's", async () => {
    const store = await aShapedStore();

    assert.equal((await setHost(store, 1, { name: "  Germany {DATA_LEFT}  " })).status, 200);
    assert.equal((await hostsOf(store)).find((host) => host.n === 1)!.name, "Germany {DATA_LEFT}");

    assert.equal((await setHost(store, 1, { name: "" })).status, 200);
    assert.equal((await hostsOf(store)).find((host) => host.n === 1)!.name, null);
  });

  it("When hosts are dragged into a new order, then that order is kept, the rest after them", async () => {
    const store = await aShapedStore();

    const response = await orderHosts(store, [4, 1]);

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual((await hostsOf(store)).map((host) => host.n), [4, 1, 2]);

    // Dragged again: the new order replaces the old one.
    await orderHosts(store, [2, 4, 1]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.n), [2, 4, 1]);
  });

  it("When groups are dragged into a new order, then the list follows it", async () => {
    const store = await aShapedStore();
    const a = (await api(store).post(`${V1}/groups`, { name: "A" })).data.id as string;
    const b = (await api(store).post(`${V1}/groups`, { name: "B" })).data.id as string;
    const c = (await api(store).post(`${V1}/groups`, { name: "C" })).data.id as string;

    const response = await api(store).put(`${V1}/groups/order`, { ids: [c, a, b] });

    assert.equal(response.status, 200, JSON.stringify(response.data));
    const ids = ((await api(store).get(`${V1}/groups`)).data as { id: string }[]).map((group) => group.id);
    assert.deepEqual(ids.slice(0, 3), [c, a, b], "the dragged ones first");
  });
});

// ------------------------------------------------------- the customer's link

// -------------------------------------------- panels a reseller signs in to

describe("A panel signed in to with a reseller's account (no hosts, no inbounds)", () => {
  it("When a group takes its panel groups, then the hosts are read through the shop's own subscription", async () => {
    const store = await aShapedStore();
    store.fake.reseller = true;

    const groups = await api(store).get(`${V1}/panels/${store.panelId}/groups`);
    assert.equal(groups.status, 200);
    assert.equal(groups.data[0].inboundTags, undefined, "ids and names only");

    assert.equal((await setSources(store, [{ panelGroupId: 2, allHosts: true }, { panelGroupId: 7, allHosts: false }])).status, 200);
    const hosts = await hostsOf(store);
    assert.deepEqual(hosts.map((host) => host.n), [1, 2, 4, 3]);
    assert.ok(hosts.every((host) => host.n !== 3 || !host.selected), "a host of a panel group taken without 'all' waits to be picked");

    const probe2 = store.fake.users.get("skprobe_g2")!;
    const probe7 = store.fake.users.get("skprobe_g7")!;
    assert.deepEqual(probe2.groupIds, [2]);
    assert.deepEqual(probe7.groupIds, [7]);
    assert.equal(probe2.dataLimitBytes, null, "unlimited where the account may");
    assert.equal(probe2.expiresAt, null);
    assert.equal(probe2.status, "active");
  });

  it("When the account's limits forbid an unlimited user, then the probe gets the least it may", async () => {
    const store = await aShapedStore();
    store.fake.limited = true;

    await setSources(store, [{ panelGroupId: 7, allHosts: true }]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.n), [3]);

    const probe = store.fake.users.get("skprobe_g7")!;
    assert.equal(probe.dataLimitBytes, GB);
    assert.ok(probe.expiresAt && probe.expiresAt.getTime() > Date.now() + 29 * 86_400_000);
  });

  it("When the probe user is deleted, switched off or runs out on the panel, then it is put right at the next read", async () => {
    const store = await aShapedStore();
    await hostsOf(store);
    store.fake.users.delete("skprobe_g2");
    assert.equal((await hostsOf(store)).length, 3, "made again");

    const probe = store.fake.users.get("skprobe_g2")!;
    probe.status = "expired";
    probe.groupIds = [1];
    await hostsOf(store);
    assert.equal(store.fake.users.get("skprobe_g2")!.status, "active");
    assert.deepEqual(store.fake.users.get("skprobe_g2")!.groupIds, [2]);
  });
});
