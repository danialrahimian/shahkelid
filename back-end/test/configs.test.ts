import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkConfig, probeHosts, rekey, settle, type Saved } from "../src/modules/subscriptions/configs";

/**
 * The hosts a panel group gives, read from the shop's own subscription, for
 * the staff pages. Their ids are what staff picks and names are kept under;
 * the panel service (Go) makes the same ids and re-keys the same way when it
 * shapes the customer's link, and pins these same values in
 * panel/internal/configs.
 */

const vmess = `vmess://${Buffer.from(JSON.stringify({ add: "x", ps: "VM", port: "8080", net: "tcp" })).toString("base64")}`;
const LINKS = [
  "vless://u@a.example.com:443?type=ws&path=%2Fws#DE-1",
  "vless://u@b.example.com:8443?type=ws&path=%2Fws%3Fed%3D2048#DE-1",
  "trojan://p@n.example.com:2083?type=grpc&serviceName=tg#%F0%9F%87%B3%F0%9F%87%B1%20NL%20%E2%88%9E",
  vmess,
  "ss://YWVzLTI1Ni1nY206cA@s.example.com:8388#SS",
  "hysteria2://p@h.example.com:443#HY",
];

describe("Reading a panel group's hosts", () => {
  it("Gives each host the ids the panel service gives it (and the one earlier releases gave)", () => {
    const hosts = probeHosts(LINKS.join("\n"));
    assert.deepEqual(
      hosts.map((host) => [host.id, host.legacyId]),
      [
        ["nQKKpF6UxsQg", "6K3FdTiXmihf"],
        ["nQKKpF6UxsQg-2", "vAJjwJ3-3urX-2"],
        ["v5CXst6CvdAs", "yWK4Ru09aMKj"],
        ["M4wnKhw10xUp", "FqnAjBweQ0Nb"],
        ["TGNMA2wPincl", "iQLNP3-x739d"],
        ["wZDR2vid1Avh", "qx9jYoW3P76I"],
      ],
    );
  });

  it("Reads PasarGuard's Xray JSON, which carries every host, to the same ids", () => {
    const xray = JSON.stringify([
      {
        remarks: "DE-1",
        outbounds: [
          {
            protocol: "vless",
            settings: { vnext: [{ address: "a.example.com", port: 443 }] },
            streamSettings: { network: "ws", wsSettings: { path: "/ws" } },
          },
        ],
      },
      {
        remarks: "XH",
        outbounds: [
          {
            protocol: "vless",
            settings: { vnext: [{ address: "x.example.com", port: 443 }] },
            streamSettings: { network: "xhttp", xhttpSettings: { path: "/x" } },
          },
        ],
      },
      { remarks: "HY", outbounds: [{ protocol: "hysteria", settings: { version: 2, address: "h.example.com", port: 443 } }] },
    ]);
    assert.deepEqual(
      probeHosts(xray).map((host) => `${host.id} ${host.name} ${host.network ?? ""}`),
      ["nQKKpF6UxsQg DE-1 ws", "VGCBsn4-Oq0r XH xhttp", "wZDR2vid1Avh HY "],
    );
  });

  it("Reads protocol, port, transport and path, leaving early data out of the path", () => {
    const [first, second, grpc, vm, ss, hy] = probeHosts(LINKS.join("\n"));
    assert.deepEqual([first!.protocol, first!.port, first!.network, first!.path], ["vless", 443, "ws", "/ws"]);
    assert.equal(second!.path, "/ws");
    assert.deepEqual([grpc!.network, grpc!.path, grpc!.name], ["grpc", "tg", "🇳🇱 NL ∞"]);
    assert.deepEqual([vm!.protocol, vm!.port, vm!.network], ["vmess", 8080, null]);
    assert.equal(ss!.protocol, "shadowsocks");
    assert.equal(hy!.protocol, "hysteria2");
  });

  it("Keeps an id when what PasarGuard picks at random changes: address, port, path", () => {
    const [a] = probeHosts("vless://u@x.example.com:443?type=ws&path=%2Fa#DE");
    const [b] = probeHosts("vless://u@y.example.com:2053?type=ws&path=%2Fb#DE");
    assert.equal(a!.id, b!.id);
    assert.notEqual(probeHosts("vless://u@x.example.com:443?type=ws#DE 2")[0]!.id, a!.id);
  });

  it("Leaves out lines that are not links", () => {
    assert.equal(probeHosts("# a comment\n\nvless://u@a:443#A\nnot a link").length, 1);
    assert.equal(linkConfig("vless://u@[2001:db8::1]:443#v6").server, "2001:db8::1");
  });
});

describe("Finding a renamed host again", () => {
  const hosts = probeHosts(
    [
      "vless://u@a.example.com:443?type=ws&path=%2Fws#Germany 1",
      "vless://u@b.example.com:443?type=ws&path=%2Fws#Turkey",
      "trojan://p@a.example.com:443?type=ws&path=%2Fws#NL",
    ].join("\n"),
  );
  const saved = (hostId: string, name: string, server: string, protocol: string): Saved => ({
    hostId,
    name,
    server,
    protocol,
    network: "ws",
    port: 443,
    path: "/ws",
  });

  it("Re-keys as the panel service does", () => {
    assert.equal(hosts[0]!.id, "uhHlaNq-U-ud");
    assert.equal(hosts[2]!.id, "ookVR1Escfj5");
    assert.equal(rekey([saved("old-de", "DE-1", "a.example.com", "vless")], hosts).get("old-de"), "uhHlaNq-U-ud");
    assert.equal(rekey([saved("old-x", "Unrelated", "z.example.com", "vless")], hosts.slice(0, 2)).get("old-x"), undefined);
    assert.equal(rekey([saved("old-nl", "Holland", "a.example.com", "trojan")], hosts).get("old-nl"), "ookVR1Escfj5");
    assert.equal(rekey([saved("old-nl", "Holland", "q.example.com", "trojan")], hosts).get("old-nl"), undefined, "nothing but its protocol agrees");
    assert.equal(rekey([{ hostId: "old-nofp" }], hosts).get("old-nofp"), undefined);
  });

  it("Gives one host to one setting only", () => {
    const moves = rekey(
      [saved("a", "DE-1", "a.example.com", "vless"), saved("b", "DE-2", "a.example.com", "vless")],
      hosts.slice(0, 1),
    );
    assert.equal(moves.size, 1);
  });
});

describe("Settling what a group saved against what the panel gives now", () => {
  const hosts = probeHosts(
    [
      "vless://u@de1.example.com:443?type=ws&path=%2Fws#DE-1",
      "vless://u@de2.example.com:443?type=ws&path=%2Fws#DE-2",
      "trojan://p@nl.example.com:443?type=ws&path=%2Fws#NL",
    ].join("\n"),
  );
  const row = (host: (typeof hosts)[number], hostId = host.id): Saved => ({ ...host, hostId });

  it("Records the hosts it has not seen, and moves nothing when nothing changed", () => {
    const first = settle([row(hosts[0]!)], hosts);
    assert.deepEqual([first.moves.size, first.fresh.map((host) => host.name), first.fill], [0, ["DE-2", "NL"], []]);
    const again = settle(hosts.map((host) => row(host)), hosts);
    assert.deepEqual([again.moves.size, again.fresh.length, again.fill.length], [0, 0, 0]);
  });

  it("A host deleted on the panel leaves its siblings alone", () => {
    const { moves, fresh } = settle(hosts.map((host) => row(host)), [hosts[0]!, hosts[2]!]);
    assert.deepEqual([moves.size, fresh.length], [0, 0]);
  });

  it("A host renamed on the panel takes its settings along; one saved under an old id is moved", () => {
    const renamed = probeHosts("vless://u@de2.example.com:443?type=ws&path=%2Fws#DE-2 Fast")[0]!;
    const { moves, fresh } = settle(hosts.map((host) => row(host)), [hosts[0]!, renamed, hosts[2]!]);
    assert.deepEqual([[...moves], fresh.length], [[[hosts[1]!.id, renamed.id]], 0]);

    const legacy = settle([{ hostId: hosts[2]!.legacyId }], hosts);
    assert.deepEqual([...legacy.moves], [[hosts[2]!.legacyId, hosts[2]!.id]]);
    assert.deepEqual(legacy.fresh.map((host) => host.name), ["DE-1", "DE-2"]);
  });

  it("A row saved before fingerprints were kept gets its host's", () => {
    assert.deepEqual(settle([{ hostId: hosts[0]!.id }], hosts).fill, [hosts[0]!.id]);
  });
});
