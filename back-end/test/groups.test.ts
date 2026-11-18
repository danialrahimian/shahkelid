import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";
import yaml from "js-yaml";

import { forgetCatalog } from "../src/modules/groups/catalog";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { syncAllPanels } from "../src/modules/provisioning/sync";
import { subscriptionPanels, subscriptions } from "../src/modules/subscriptions/schema";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import type { FakePanel } from "./helpers/fake-panel";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, fakeFor, installFakePanels, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

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

const hostsOf = async (store: Store, groupId = store.groupId) => {
  const response = await api(store).get(`${V1}/groups/${groupId}/hosts`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.hosts as { hostId: number; selected: boolean; forced: boolean; name: string | null; remark: string; panelId: string }[];
};

const setHost = (store: Store, hostId: number, change: { selected?: boolean; name?: string | null }, groupId = store.groupId) =>
  api(store).patch(`${V1}/groups/${groupId}/hosts/${store.panelId}/${hostId}`, change);

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

const fetchLink = async (token: string, userAgent: string) => {
  forgetCatalog();
  const response = await fetch(`${getBaseUrl()}/s/${token}`, { headers: { "user-agent": userAgent } });
  return { status: response.status, body: await response.text() };
};

/** The names in a base64 list of links, in order. */
const linkNames = (body: string) =>
  Buffer.from(body, "base64")
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      line.startsWith("vmess://")
        ? (JSON.parse(Buffer.from(line.slice(8), "base64").toString("utf8")) as { ps: string }).ps
        : decodeURIComponent(line.slice(line.indexOf("#") + 1)),
    );

const V2RAYNG = "v2rayNG/1.9.0";
const HIDDIFY = "HiddifyNext/2.5.7";
const CLASH = "ClashMetaForAndroid/2.11.0";

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

    assert.deepEqual(hosts.map((host) => host.hostId), [1, 2, 4], "the vless and vmess hosts, in the panel's order");
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
    assert.deepEqual(hosts.filter((host) => host.selected).map((host) => host.hostId), [4]);
  });

  it("When another panel group is added or one is removed, then the hosts follow", async () => {
    const store = await aShapedStore();

    await setSources(store, [{ panelGroupId: 2, allHosts: true }, { panelGroupId: 7, allHosts: true }]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.hostId), [1, 2, 3, 4]);

    await setSources(store, [{ panelGroupId: 7, allHosts: true }]);
    assert.deepEqual((await hostsOf(store)).map((host) => host.hostId), [3]);
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
    assert.equal((await hostsOf(store)).find((host) => host.hostId === 1)!.name, "Germany {DATA_LEFT}");

    assert.equal((await setHost(store, 1, { name: "" })).status, 200);
    assert.equal((await hostsOf(store)).find((host) => host.hostId === 1)!.name, null);
  });

  it("When hosts are dragged into a new order, then that order is kept, the rest after them", async () => {
    const store = await aShapedStore();

    const response = await api(store).put(`${V1}/groups/${store.groupId}/hosts/order`, {
      hosts: [
        { panelId: store.panelId, hostId: 4 },
        { panelId: store.panelId, hostId: 1 },
      ],
    });

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual((await hostsOf(store)).map((host) => host.hostId), [4, 1, 2]);

    // Dragged again: the new order replaces the old one.
    await api(store).put(`${V1}/groups/${store.groupId}/hosts/order`, {
      hosts: [2, 4, 1].map((hostId) => ({ panelId: store.panelId, hostId })),
    });
    assert.deepEqual((await hostsOf(store)).map((host) => host.hostId), [2, 4, 1]);
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

describe("The customer's link follows their groups", () => {
  it("When every host is taken, then the link gives them all, as the panel names and orders them", async () => {
    const store = await aShapedStore();
    const { token, username } = await aLive(store);

    const { status, body } = await fetchLink(token, V2RAYNG);

    assert.equal(status, 200);
    assert.deepEqual(linkNames(body), [`🇩🇪 DE-1 ${username}`, "🇩🇪 DE-2 [vmess]", "🇩🇪 DE-3"]);
  });

  it("When some hosts are picked, then only those are given", async () => {
    const store = await aShapedStore();
    const { token } = await aLive(store);
    await setSources(store, [{ panelGroupId: 2, allHosts: false }]);
    await setHost(store, 2, { selected: true });
    await setHost(store, 4, { selected: true });

    assert.deepEqual(linkNames((await fetchLink(token, V2RAYNG)).body), ["🇩🇪 DE-2 [vmess]", "🇩🇪 DE-3"]);
  });

  it("When a host is renamed with variables, then the customer sees our name, filled in from their subscription", async () => {
    const store = await aShapedStore();
    const { token, username } = await aLive(store);
    store.fake.use(username, 10 * GB);
    await syncAllPanels(database());
    await setHost(store, 1, { name: "Germany · {DATA_LEFT} left · {PROTOCOL}" });
    await setHost(store, 2, { name: "Fast {STATUS_EMOJI}" });

    const names = linkNames((await fetchLink(token, V2RAYNG)).body);

    assert.deepEqual(names, ["Germany · 40 GB left · vless", "Fast ✅", "🇩🇪 DE-3"]);
  });

  it("When hosts are reordered, then the link follows the new order and keeps working", async () => {
    const store = await aShapedStore();
    const { token } = await aLive(store);

    for (const order of [
      [4, 2, 1],
      [2, 1, 4],
      [1, 4, 2],
    ]) {
      const moved = await api(store).put(`${V1}/groups/${store.groupId}/hosts/order`, {
        hosts: order.map((hostId) => ({ panelId: store.panelId, hostId })),
      });
      assert.equal(moved.status, 200);
      const { status, body } = await fetchLink(token, V2RAYNG);
      assert.equal(status, 200, "the link never breaks");
      const expected = order.map((id) => ({ 1: "DE-1", 2: "DE-2", 4: "DE-3" })[id as 1 | 2 | 4]);
      assert.deepEqual(
        linkNames(body).map((name) => name.split(" ")[1]),
        expected,
      );
    }
  });

  it("When a plan has two groups and staff reorder the groups, then the link gives the groups in that order", async () => {
    const store = await aShapedStore();
    const nl = (await api(store).post(`${V1}/groups`, { name: "Netherlands" })).data.id as string;
    await setSources(store, [{ panelGroupId: 7, allHosts: true }], nl);
    const plan = await api(store).post(`${V1}/plans`, {
      slug: `two-${randomBytes(3).toString("hex")}`,
      name: "two",
      dataLimitGb: 50,
      durationDays: 30,
      deviceLimit: 2,
      priceToman: 1000,
      groupIds: [store.groupId, nl],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));
    const { token, username } = await aLive(store, plan.data.id);
    assert.deepEqual(store.fake.users.get(username)!.groupIds, [2, 7], "the panel user has both panel groups");

    await api(store).put(`${V1}/groups/order`, { ids: [store.groupId, nl] });
    const first = linkNames((await fetchLink(token, V2RAYNG)).body).map((name) => name.split(" ")[1]);
    assert.deepEqual(first, ["DE-1", "DE-2", "DE-3", "NL"]);

    await api(store).put(`${V1}/groups/order`, { ids: [nl, store.groupId] });
    const second = linkNames((await fetchLink(token, V2RAYNG)).body).map((name) => name.split(" ")[1]);
    assert.deepEqual(second, ["NL", "DE-1", "DE-2", "DE-3"]);
  });

  it("When a sing-box app (Hiddify) fetches it, then the profile's configs and selectors are picked, renamed and ordered", async () => {
    const store = await aShapedStore();
    const { token } = await aLive(store);
    await setSources(store, [{ panelGroupId: 2, allHosts: false }]);
    await setHost(store, 1, { selected: true, name: "Germany" });
    await setHost(store, 4, { selected: true });
    await api(store).put(`${V1}/groups/${store.groupId}/hosts/order`, {
      hosts: [4, 1].map((hostId) => ({ panelId: store.panelId, hostId })),
    });

    const { status, body } = await fetchLink(token, HIDDIFY);

    assert.equal(status, 200);
    const profile = JSON.parse(body) as { outbounds: { tag: string; type: string; outbounds?: string[]; server?: string }[] };
    const proxies = profile.outbounds.filter((outbound) => outbound.type === "vless" || outbound.type === "vmess");
    assert.deepEqual(proxies.map((proxy) => proxy.tag), ["🇩🇪 DE-3", "Germany"]);
    assert.deepEqual(proxies.map((proxy) => proxy.server), ["de3.example.com", "de1.example.com"]);
    assert.deepEqual(profile.outbounds.find((outbound) => outbound.tag === "Select")!.outbounds, ["Auto", "🇩🇪 DE-3", "Germany"]);
    assert.deepEqual(profile.outbounds.find((outbound) => outbound.tag === "Auto")!.outbounds, ["🇩🇪 DE-3", "Germany"]);
    assert.ok(profile.outbounds.some((outbound) => outbound.tag === "direct"), "the rest of the profile is kept");
  });

  it("When a Clash app fetches it, then the proxies and proxy groups are picked, renamed and ordered", async () => {
    const store = await aShapedStore();
    const { token } = await aLive(store);
    await setHost(store, 2, { name: "Fast" });
    await api(store).put(`${V1}/groups/${store.groupId}/hosts/order`, {
      hosts: [2, 4, 1].map((hostId) => ({ panelId: store.panelId, hostId })),
    });

    const { status, body } = await fetchLink(token, CLASH);

    assert.equal(status, 200);
    const profile = yaml.load(body) as { proxies: { name: string; type: string }[]; "proxy-groups": { name: string; proxies: string[] }[]; rules: string[] };
    const names = profile.proxies.map((proxy) => proxy.name);
    assert.equal(names[0], "Fast");
    assert.deepEqual(names.slice(1).map((name) => name.split(" ")[1]), ["DE-3", "DE-1"]);
    assert.deepEqual(profile["proxy-groups"][0]!.proxies, ["Auto", ...names]);
    assert.deepEqual(profile["proxy-groups"][1]!.proxies, names);
    assert.deepEqual(profile.rules, ["MATCH,Select"]);
  });

  it("When staff take another panel group into the group, then the sync gives it to existing customers", async () => {
    const store = await aShapedStore();
    const { token, username } = await aLive(store);
    assert.deepEqual(store.fake.users.get(username)!.groupIds, [2]);

    await setSources(store, [{ panelGroupId: 2, allHosts: true }, { panelGroupId: 7, allHosts: true }]);
    await syncAllPanels(database());

    assert.deepEqual(store.fake.users.get(username)!.groupIds, [2, 7], "the panel user got the new group");
    assert.ok(linkNames((await fetchLink(token, V2RAYNG)).body).some((name) => name.startsWith("🇳🇱 NL")));

    await setSources(store, [{ panelGroupId: 7, allHosts: true }]);
    await syncAllPanels(database());
    assert.deepEqual(store.fake.users.get(username)!.groupIds, [7], "and lost the one taken out");
    assert.deepEqual(linkNames((await fetchLink(token, V2RAYNG)).body).map((name) => name.split(" ")[1]), ["NL"]);
  });

  it("When staff take a group from another panel into the group, then the sync makes the customer there too", async () => {
    const store = await aShapedStore();
    const { id, username } = await aLive(store);
    const otherUrl = `https://panel-other-${randomBytes(3).toString("hex")}.test`;
    const other = fakeFor(otherUrl);
    shape(other);
    const panel = await api(store).post(`${V1}/panels`, {
      name: `Other ${randomBytes(2).toString("hex")}`,
      driver: "pasarguard",
      baseUrl: otherUrl,
      credentials: { kind: "password", username: "operator", password: "right" },
    });
    assert.equal(panel.status, 201, JSON.stringify(panel.data));

    const added = await setSources(store, [
      { panelGroupId: 2, allHosts: true },
      { panelGroupId: 7, allHosts: true, panelId: panel.data.id },
    ]);
    assert.equal(added.status, 200, JSON.stringify(added.data));
    await syncAllPanels(database());

    assert.deepEqual(other.users.get(username)?.groupIds, [7], "made on the other panel with its group");
    const members = await database().select().from(subscriptionPanels).where(eq(subscriptionPanels.subscriptionId, id));
    assert.equal(members.length, 2);
    assert.ok(members.every((member) => member.panelUserId !== null));
  });
});
