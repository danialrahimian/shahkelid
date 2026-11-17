import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { setDriverFactory } from "../../src/modules/provisioning/drivers";
import { signedInStaff } from "./accounts";
import { FakePanel } from "./fake-panel";

/**
 * A store ready to sell: a panel (a fake one), a location, servers and a
 * plan, all made through the staff API as staff would make them.
 */

const V1 = "/api/v1/staff";

/** One fake panel per base URL, so each test's panel is its own. */
const fakes = new Map<string, FakePanel>();
export const fakeFor = (baseUrl: string) => {
  let fake = fakes.get(baseUrl);
  if (!fake) {
    fake = new FakePanel();
    fakes.set(baseUrl, fake);
  }
  return fake;
};

/**
 * Panels made by the tests talk to fakes: one per base URL. The password
 * "wrong" makes a panel that refuses every sign-in.
 */
export const installFakePanels = () =>
  setDriverFactory((panel, credentials) => {
    if (credentials.kind === "password" && credentials.password === "wrong") {
      return Object.assign(new FakePanel(), { refuse: true });
    }
    return fakeFor(panel.baseUrl);
  });

export type Staff = Awaited<ReturnType<typeof signedInStaff>>;
let ownerCache: Staff | undefined;
export const owner = async () => (ownerCache ??= await signedInStaff(["owner"]));

export type Store = Awaited<ReturnType<typeof aStore>>;

/**
 * A panel and a plan sold on it through one of our groups, made through the
 * API. The group takes the panel's group 2 ("de"), and the plan's extra
 * panel groups when given.
 */
export const aStore = async ({ planGroups = [] as number[] }: { planGroups?: number[] } = {}) => {
  const staff = await owner();
  const tag = randomBytes(3).toString("hex");
  const baseUrl = `https://panel-${tag}.test`;
  const fake = fakeFor(baseUrl);
  fake.groups = [
    { id: 1, name: "tunnel", inboundTags: ["vless-ws"] },
    { id: 2, name: "de", inboundTags: ["vmess-tcp"] },
    { id: 7, name: "extra", inboundTags: ["trojan-grpc"] },
  ];

  const panel = await staff.client.post(`${V1}/panels`, {
    name: `Panel ${tag}`,
    driver: "pasarguard",
    baseUrl,
    credentials: { kind: "password", username: "operator", password: "right" },
  });
  assert.equal(panel.status, 201, JSON.stringify(panel.data));

  const group = await staff.client.post(`${V1}/groups`, { name: `Germany ${tag}` });
  assert.equal(group.status, 201, JSON.stringify(group.data));
  const sources = await staff.client.put(`${V1}/groups/${group.data.id}/sources`, {
    sources: [2, ...planGroups].map((panelGroupId) => ({ panelId: panel.data.id, panelGroupId, allHosts: true })),
  });
  assert.equal(sources.status, 200, JSON.stringify(sources.data));

  const plan = await staff.client.post(`${V1}/plans`, {
    slug: `monthly-${tag}`,
    name: "ماهانه ۵۰ گیگ",
    dataLimitGb: 50,
    durationDays: 30,
    deviceLimit: 2,
    priceToman: 150_000,
    groupIds: [group.data.id],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.data));

  return { staff, fake, panelId: panel.data.id as string, groupId: group.data.id as string, planId: plan.data.id as string };
};

/** Takes everything out of the store's group: its plan then cannot be made anywhere. */
export const emptyGroup = async (store: Store) => {
  const response = await store.staff.client.put(`${V1}/groups/${store.groupId}/sources`, { sources: [] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
};

/** Puts the panel's group 2 back into the store's group. */
export const refillGroup = async (store: Store) => {
  const response = await store.staff.client.put(`${V1}/groups/${store.groupId}/sources`, {
    sources: [{ panelId: store.panelId, panelGroupId: 2, allHosts: true }],
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
};
