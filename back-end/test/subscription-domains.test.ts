import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { CHECK_ANSWER, checkSubscriptionDomain, resetSubscriptionDomains } from "../src/modules/infrastructure/domains";
import { subscriptionDomains } from "../src/modules/infrastructure/schema";
import { loadSettings } from "../src/modules/settings/live";
import { linkFor } from "../src/modules/subscriptions/service";
import config from "../src/config";
import { closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The shop's own domains for customers' subscription links, apart from the
 * site (as PasarGuard's subscription domain): staff add them under Panels,
 * links are made on the primary one, and the panel service and Caddy serve
 * only links on them (tested in panel/internal/link and by hand with Caddy).
 */

const V1 = "/api/v1/staff/subscription-domains";

before(async () => {
  await resetTestDatabase();
  await startTestServer();
});

after(async () => {
  resetSubscriptionDomains();
  await closeDatabase();
  await stopTestServer();
});

describe("Subscription domains", () => {
  it("When domains are added, then the first is where links are made; a pasted link is read as its domain", async () => {
    const { client } = await signedInStaff(["owner"]);
    assert.equal(linkFor("tok", null), `${config.provisioning.publicUrl}/s/tok`, "none yet: the site's address");

    const first = await client.post(V1, { domain: "  https://Sub.Example.com/s/abc " });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const second = await client.post(V1, { domain: "sub2.example.com" });

    assert.deepEqual(
      second.data.domains.map((d: { domain: string; isPrimary: boolean }) => [d.domain, d.isPrimary]),
      [
        ["sub.example.com", true],
        ["sub2.example.com", false],
      ],
    );
    assert.equal(second.data.linkBase, "https://sub.example.com");
    assert.equal(linkFor("tok", null), "https://sub.example.com/s/tok");
    assert.equal(linkFor("tok", "https://panel-sub.example.com"), "https://panel-sub.example.com/s/tok", "a panel's own domain still wins");
  });

  it("When the primary is changed or removed, then links follow; with none left they are on the site again", async () => {
    const { client } = await signedInStaff(["owner"]);

    const moved = await client.put(`${V1}/sub2.example.com/primary`);
    assert.equal(moved.status, 200);
    assert.equal(linkFor("tok", null), "https://sub2.example.com/s/tok");

    const removed = await client.delete(`${V1}/sub2.example.com`);
    assert.equal(removed.data.linkBase, "https://sub.example.com", "the one left becomes primary");
    await client.delete(`${V1}/sub.example.com`);
    assert.equal(linkFor("tok", null), `${config.provisioning.publicUrl}/s/tok`);
    assert.equal((await client.delete(`${V1}/sub.example.com`)).status, 404);
  });

  it("When the domain is the site's own, added already, or not a domain, then it is refused on its field", async () => {
    const { client } = await signedInStaff(["owner"]);
    const site = await client.post(V1, { domain: "www.shop.test" });
    assert.deepEqual([site.status, site.data.error.code], [409, "DOMAIN_TAKEN"]);

    await client.post(V1, { domain: "links.example.com" });
    const again = await client.post(V1, { domain: "LINKS.example.com" });
    assert.deepEqual([again.status, again.data.error.fields[0].code], [409, "DOMAIN_TAKEN"]);

    for (const domain of ["1.2.3.4", "*.example.com", "localhost", "a b.com", ""]) {
      const bad = await client.post(V1, { domain });
      assert.equal(bad.status, 400, domain);
    }
  });

  it("When another process adds a domain, then this one makes links on it within its settings refresh", async () => {
    resetSubscriptionDomains();
    assert.equal(linkFor("tok", null), `${config.provisioning.publicUrl}/s/tok`);
    await loadSettings(database());
    assert.equal(linkFor("tok", null), "https://links.example.com/s/tok");
  });

  it("When a domain is checked, then it says whether this server answers on it", async () => {
    const answers = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    assert.deepEqual(await checkSubscriptionDomain(database(), "links.example.com", answers(CHECK_ANSWER)), { ok: true, error: null });
    assert.equal((await checkSubscriptionDomain(database(), "links.example.com", answers("<html>", 200))).ok, false);
    const down = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as unknown as typeof fetch;
    assert.deepEqual(await checkSubscriptionDomain(database(), "links.example.com", down), { ok: false, error: "ENOTFOUND" });
    const [row] = await database().select().from(subscriptionDomains).where(eq(subscriptionDomains.domain, "links.example.com"));
    assert.ok(row);
  });

  it("When staff without servers:manage ask, then it is forbidden", async () => {
    const support = await signedInStaff(["support"]);
    assert.equal((await support.client.get(V1)).status, 403);
    assert.equal((await support.client.post(V1, { domain: "x.example.com" })).status, 403);
  });
});
