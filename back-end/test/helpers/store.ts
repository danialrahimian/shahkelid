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

/** A panel, a location, servers and a plan sold on them, made through the API. */
export const aStore = async ({
  servers = [{ capacity: 10, priority: 0 }],
  planGroups = [] as number[],
}: {
  servers?: { capacity: number; priority: number }[];
  planGroups?: number[];
} = {}) => {
  const staff = await owner();
  const tag = randomBytes(3).toString("hex");
  const baseUrl = `https://panel-${tag}.test`;
  const fake = fakeFor(baseUrl);
  fake.groups = [
    { id: 1, name: "tunnel" },
    { id: 2, name: "de" },
    { id: 7, name: "extra" },
  ];

  const panel = await staff.client.post(`${V1}/panels`, {
    name: `Panel ${tag}`,
    driver: "pasarguard",
    baseUrl,
    credentials: { kind: "password", username: "operator", password: "right" },
  });
  assert.equal(panel.status, 201, JSON.stringify(panel.data));

  const location = await staff.client.post(`${V1}/locations`, {
    code: `DE-${tag.toUpperCase()}`,
    nameFa: "آلمان",
    nameEn: "Germany",
  });
  assert.equal(location.status, 201, JSON.stringify(location.data));

  const serverIds: string[] = [];
  for (const [index, server] of servers.entries()) {
    const made = await staff.client.post(`${V1}/servers`, {
      panelId: panel.data.id,
      locationId: location.data.id,
      name: `de-${tag}-${index}`,
      host: `de${index}.example.com`,
      panelGroupId: 2,
      capacityUsers: server.capacity,
      priority: server.priority,
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    serverIds.push(made.data.id);
  }

  const plan = await staff.client.post(`${V1}/plans`, {
    slug: `monthly-${tag}`,
    name: "ماهانه ۵۰ گیگ",
    dataLimitGb: 50,
    durationDays: 30,
    deviceLimit: 2,
    priceToman: 150_000,
    panels: [{ panelId: panel.data.id, groupIds: planGroups }],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.data));

  return { staff, fake, panelId: panel.data.id as string, serverIds, planId: plan.data.id as string };
};
