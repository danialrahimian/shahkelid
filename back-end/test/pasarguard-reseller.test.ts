import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PasarGuardDriver } from "../src/modules/provisioning/pasarguard";

/**
 * The PasarGuard driver signed in with a reseller's account (PasarGuard's
 * "operator" role): it may read groups' ids and names only, and the panel
 * may have switched some subscription formats off. Answers stand in for the
 * panel's, as PasarGuard v5.6 gives them.
 */

const BASE = "https://panel.test";

const panel = (routes: Record<string, (init: RequestInit | undefined) => Response>) => {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url.replace(BASE, ""));
    const route = routes[url.replace(BASE, "")];
    return route ? route(init) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { driver: new PasarGuardDriver(BASE, { kind: "api_key", apiKey: "k" }, fetchImpl), asked };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PasarGuard with a reseller's account", () => {
  it("When the full group list is forbidden, then the simple one is read: ids and names", async () => {
    const { driver } = panel({
      "/api/groups": () => json({ detail: "Permission denied: groups.read" }, 403),
      "/api/groups/simple": () => json({ groups: [{ id: 2, name: "de" }, { id: 7, name: "nl" }], total: 2 }),
    });

    assert.deepEqual(await driver.listGroups(), [
      { id: 2, name: "de" },
      { id: 7, name: "nl" },
    ]);
  });

  it("When an owner's account reads them, then the groups come with their inbounds", async () => {
    const { driver, asked } = panel({
      "/api/groups": () => json({ groups: [{ id: 2, name: "de", inbound_tags: ["vless-ws"] }], total: 1 }),
    });

    assert.deepEqual(await driver.listGroups(), [{ id: 2, name: "de", inboundTags: ["vless-ws"] }]);
    assert.ok(!asked.includes("/api/groups/simple"));
  });

  it("When the plain list of links is switched off, then the base64 one is read and decoded", async () => {
    const links = "vless://u@a.example.com:443?type=ws#DE\ntrojan://p@b.example.com:443?type=grpc#NL";
    const { driver, asked } = panel({
      "/sub/abc/links": () => json({ detail: "Client not supported" }, 406),
      "/sub/abc/links_base64": () => new Response(Buffer.from(links).toString("base64")),
    });

    assert.equal(await driver.readLinks(`${BASE}/sub/abc`), links);
    assert.deepEqual(asked, ["/sub/abc/links", "/sub/abc/links_base64"]);
  });

  it("When both are switched off, then it is read as a links app reads it", async () => {
    const { driver } = panel({
      "/sub/abc/links": () => json({}, 406),
      "/sub/abc/links_base64": () => json({}, 406),
      "/sub/abc": (init) =>
        new Headers(init?.headers).get("user-agent")?.startsWith("v2rayNG")
          ? new Response(Buffer.from("vless://u@a:443#DE").toString("base64"))
          : new Response("<html>", { status: 200 }),
    });

    assert.equal(await driver.readLinks(`${BASE}/sub/abc/`), "vless://u@a:443#DE");
  });

  it("When the link gives nothing readable, then it is an error, not an empty group", async () => {
    const { driver } = panel({
      "/sub/abc/links": () => json({}, 406),
      "/sub/abc/links_base64": () => json({}, 406),
      "/sub/abc": () => new Response("<html>", { status: 200 }),
    });

    await assert.rejects(driver.readLinks(`${BASE}/sub/abc`));
  });
});
