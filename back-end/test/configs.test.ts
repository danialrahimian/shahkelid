import assert from "node:assert/strict";
import { describe, it } from "node:test";

import yaml from "js-yaml";

import {
  matchHosts,
  probeHosts,
  readableSize,
  renderName,
  shapeConfigs,
  type Fingerprint,
  type PanelPlan,
  type ProbeHost,
  type Totals,
} from "../src/modules/subscriptions/configs";

/**
 * Shaping the panels' answers by our groups, without a database: matching
 * configs to hosts, PasarGuard's variables, and each format apps read.
 */

const GB = 1024 ** 3;

const totals: Totals = {
  username: "sk_abc",
  status: "active",
  usedBytes: 10 * GB,
  dataLimitBytes: 50 * GB,
  expiresAt: new Date("2026-12-31T00:00:00Z"),
  onHoldDurationSeconds: null,
};
const now = new Date("2026-12-01T00:00:00Z");

const link = (name: string, scheme = "vless", server = "a.example.com", port = 443) =>
  `${scheme}://id@${server}:${port}?type=ws&path=%2Fws#${encodeURIComponent(name)}`;
const b64 = (lines: string[]) => Buffer.from(lines.join("\n")).toString("base64");

/** Hosts as the shop's own subscription reads them. */
const probe = (...lines: string[]) => probeHosts(lines.join("\n"));

/** A plan picking hosts by their (probe) name: [name, rank, our name]. */
const plan = (hosts: ProbeHost[], wanted: [string, number, string | null][], keepUnknown = false): PanelPlan => ({
  hosts,
  wanted: new Map(wanted.map(([name, rank, ours]) => [hosts.find((host) => host.name === name)!.id, { rank, name: ours }])),
  keepUnknown,
});

const fp = (name: string, extra: Partial<Fingerprint> = {}): Fingerprint => ({
  name,
  protocol: "vless",
  server: "a.example.com",
  port: 443,
  network: "ws",
  path: "/ws",
  sni: null,
  ...extra,
});

const namesOf = (body: string) =>
  Buffer.from(body, "base64")
    .toString("utf8")
    .split("\n")
    .map((line) => decodeURIComponent(line.slice(line.indexOf("#") + 1)));

describe("Matching configs to hosts", () => {
  it("When names carry the customer's own values, then each config still finds its host", () => {
    const hosts = probe(link("DE skprobe_g2 [∞ left]"), link("NL skprobe_g2 [∞ left]", "trojan"));
    const found = matchHosts(
      [fp("NL sk_abc [40 GB left]", { protocol: "trojan" }), fp("DE sk_abc [40 GB left]")],
      hosts,
      ["sk_abc", "skprobe_g2"],
    );
    assert.deepEqual(found.map((each) => each?.name), ["NL skprobe_g2 [∞ left]", "DE skprobe_g2 [∞ left]"]);
  });

  it("When two hosts differ only by name, then each config goes to the one named like it", () => {
    const hosts = probe(link("Germany 1"), link("Germany 2"), link("Turkey"));
    const found = matchHosts([fp("Turkey"), fp("Germany 2"), fp("Germany 1")], hosts);
    assert.deepEqual(found.map((each) => each?.name), ["Turkey", "Germany 2", "Germany 1"]);
  });

  it("When two hosts share a name, then the address tells them apart", () => {
    const hosts = probe(link("Iran", "vless", "a.example.com"), link("Iran", "vless", "b.example.com"));
    const found = matchHosts([fp("Iran", { server: "b.example.com" }), fp("Iran", { server: "a.example.com" })], hosts);
    assert.deepEqual(found.map((each) => each?.server), ["b.example.com", "a.example.com"]);
  });

  it("When the port or transport differs, then it is not that host", () => {
    const hosts = probe(link("DE"));
    assert.deepEqual(matchHosts([fp("DE", { port: 8443 })], hosts), [null]);
    assert.deepEqual(matchHosts([fp("DE", { network: "grpc" })], hosts), [null]);
  });

  it("A host's id stays the same while it does; twins are numbered by place", () => {
    const first = probe(link("DE", "vless", "a.example.com"), link("DE", "vless", "a.example.com"));
    const again = probe(link("DE", "vless", "x.example.com"), link("DE", "vless", "y.example.com"));
    assert.equal(first[0]!.id, again[0]!.id, "an address picked at random does not change it");
    assert.equal(first[1]!.id, `${first[0]!.id}-2`);
    assert.notEqual(probe(link("DE 2"))[0]!.id, first[0]!.id);
  });
});

describe("PasarGuard's variables in our names", () => {
  it("When a name uses them, then they are filled in from the subscription as a whole", () => {
    const name = renderName(
      "{USERNAME} {DATA_USAGE}/{DATA_LIMIT} {DATA_LEFT} {USAGE_PERCENTAGE}% {DAYS_LEFT}d {EXPIRE_DATE} {STATUS_EMOJI} {PROTOCOL}+{TRANSPORT} @{SERVER_IP}",
      totals,
      { protocol: "vless", network: "ws", server: "1.2.3.4" },
      now,
    );
    assert.equal(name, "sk_abc 10 GB/50 GB 40 GB 20% 30d 2026-12-31 ✅ vless+ws @1.2.3.4");
  });

  it("When the volume or the time is unlimited, or the clock has not started, then they read as such", () => {
    const unlimited = { ...totals, dataLimitBytes: null, expiresAt: null, status: "on_hold", onHoldDurationSeconds: 7 * 86400 };
    assert.equal(renderName("{DATA_LEFT} {DATA_LIMIT} {DAYS_LEFT} {EXPIRE_DATE} {STATUS_EMOJI}", unlimited, { protocol: null, network: null, server: null }, now), "∞ ∞ 7 ∞ 🔌");
  });

  it("When the Jalali date is asked for, then it is the Persian calendar", () => {
    assert.equal(renderName("{JALALI_EXPIRE_DATE}", totals, { protocol: null, network: null, server: null }, now), "1405/10/10");
  });

  it("When a variable is unknown, then it is left as written", () => {
    assert.equal(renderName("{NOPE} x", totals, { protocol: null, network: null, server: null }, now), "{NOPE} x");
  });

  it("Sizes read as PasarGuard writes them", () => {
    assert.equal(readableSize(0), "0 B");
    assert.equal(readableSize(1536), "1.5 KB");
    assert.equal(readableSize(1.25 * GB), "1.25 GB");
  });
});

describe("Shaping an answer", () => {
  const hosts = probe(link("DE-1"), link("DE-2"), link("NL", "trojan"));
  const body = b64([link("DE-1"), link("DE-2"), link("NL", "trojan")]);

  it("When hosts are picked, renamed and ordered, then a base64 list is given back as base64, shaped", () => {
    const shaped = shapeConfigs([body], [plan(hosts, [["NL", 0, null], ["DE-1", 1, "Germany {DATA_LEFT}"]])], totals, now)!;
    assert.deepEqual(namesOf(shaped), ["NL", "Germany 40 GB"]);
  });

  it("When the answer is plain links, then it stays plain", () => {
    const plain = [link("DE-1"), link("DE-2")].join("\n");
    const shaped = shapeConfigs([plain], [plan(hosts, [["DE-2", 0, null]])], totals, now)!;
    assert.equal(shaped, link("DE-2"));
  });

  it("When a vmess link is renamed, then its name inside the JSON changes", () => {
    const vmess = `vmess://${Buffer.from(JSON.stringify({ add: "x", ps: "VM", port: 1, net: "tcp" })).toString("base64")}`;
    const shaped = shapeConfigs([vmess], [plan(probe(vmess), [["VM", 0, "Renamed"]])], totals, now)!;
    assert.equal(JSON.parse(Buffer.from(shaped.slice(8), "base64").toString("utf8")).ps, "Renamed");
  });

  it("When a config matches no host, then it is kept only where every host is taken", () => {
    const withExtra = b64([link("DE-1"), link("Mystery")]);
    assert.deepEqual(namesOf(shapeConfigs([withExtra], [plan(hosts, [["DE-1", 0, null]], false)], totals, now)!), ["DE-1"]);
    assert.deepEqual(namesOf(shapeConfigs([withExtra], [plan(hosts, [["DE-1", 0, null]], true)], totals, now)!), ["DE-1", "Mystery"]);
  });

  it("When a panel cannot be read, then its configs are given as they are, after the others", () => {
    const other = b64([link("Far")]);
    const unknown: PanelPlan = { hosts: null, wanted: new Map(), keepUnknown: true };
    const shaped = shapeConfigs([other, body], [unknown, plan(hosts, [["DE-2", 0, null]])], totals, now)!;
    assert.deepEqual(namesOf(shaped), ["DE-2", "Far"]);
  });

  it("When two panels answer, then their configs are one list in the groups' order", () => {
    const a = b64([link("DE-1")]);
    const b = b64([link("NL", "trojan")]);
    const shaped = shapeConfigs([a, b], [plan(hosts, [["DE-1", 1, null]]), plan(hosts, [["NL", 0, null]])], totals, now)!;
    assert.deepEqual(namesOf(shaped), ["NL", "DE-1"]);
  });

  it("When the answer is in no format we read, or the panels differ, then nothing is shaped", () => {
    assert.equal(shapeConfigs(["<html></html>"], [plan(hosts, [])], totals, now), null);
    assert.equal(shapeConfigs([body, "{\"outbounds\":[]}"], [plan(hosts, []), plan(hosts, [])], totals, now), null);
  });

  it("When it is xray JSON, then the configs are picked and renamed by their remarks", () => {
    const xray = JSON.stringify([
      { remarks: "DE-1", outbounds: [{ protocol: "vless", settings: { vnext: [{ address: "a.example.com", port: 443 }] }, streamSettings: { network: "ws", wsSettings: { path: "/ws" } } }] },
      { remarks: "NL", outbounds: [{ protocol: "trojan", settings: { servers: [{ address: "a.example.com", port: 443 }] }, streamSettings: { network: "ws", wsSettings: { path: "/ws?ed=2048" } } }] },
    ]);
    const shaped = JSON.parse(shapeConfigs([xray], [plan(hosts, [["NL", 0, "Holland"]])], totals, now)!);
    assert.deepEqual(shaped.map((config: { remarks: string }) => config.remarks), ["Holland"]);
  });

  it("When two sing-box configs end up with one name, then the second is numbered, and the selectors list both", () => {
    const profile = (tags: string[]) =>
      JSON.stringify({
        outbounds: [
          { type: "selector", tag: "Select", outbounds: ["Auto", ...tags], default: tags[0] },
          { type: "urltest", tag: "Auto", outbounds: tags },
          ...tags.map((tag) => ({ type: "vless", tag, server: "a.example.com", server_port: 443, transport: { type: "ws", path: "/ws" } })),
          { type: "direct", tag: "direct" },
        ],
      });
    const shaped = JSON.parse(
      shapeConfigs([profile(["DE-1", "DE-2"])], [plan(hosts, [["DE-1", 0, "Germany"], ["DE-2", 1, "Germany"]])], totals, now)!,
    ) as { outbounds: { tag: string; outbounds?: string[]; default?: string }[] };
    assert.deepEqual(shaped.outbounds.map((outbound) => outbound.tag), ["Select", "Auto", "Germany", "Germany 2", "direct"]);
    assert.deepEqual(shaped.outbounds[0]!.outbounds, ["Auto", "Germany", "Germany 2"]);
    assert.equal(shaped.outbounds[0]!.default, undefined, "a default naming a config renamed away is dropped");
  });

  it("When Clash proxies are left out, then the proxy groups no longer name them", () => {
    const clash = yaml.dump({
      proxies: [
        { name: "DE-1", type: "vless", server: "a.example.com", port: 443, network: "ws", "ws-opts": { path: "/ws" } },
        { name: "NL", type: "trojan", server: "a.example.com", port: 443, network: "ws", "ws-opts": { path: "/ws" } },
      ],
      "proxy-groups": [{ name: "Select", type: "select", proxies: ["DE-1", "NL", "DIRECT"] }],
    });
    const shaped = yaml.load(shapeConfigs([clash], [plan(hosts, [["NL", 0, null]])], totals, now)!) as {
      proxies: { name: string }[];
      "proxy-groups": { proxies: string[] }[];
    };
    assert.deepEqual(shaped.proxies.map((proxy) => proxy.name), ["NL"]);
    assert.deepEqual(shaped["proxy-groups"][0]!.proxies, ["NL", "DIRECT"]);
  });
});
