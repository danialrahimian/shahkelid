import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkConfig, probeHosts } from "../src/modules/subscriptions/configs";

/**
 * The hosts a panel group gives, read from the shop's own subscription, for
 * the staff pages. Their ids are what staff picks and names are kept under;
 * the panel service (Go) makes the same ids when it shapes the customer's
 * link, and pins these same values in panel/internal/configs.
 */

const vmess = `vmess://${Buffer.from(JSON.stringify({ add: "x", ps: "VM", port: "8080", net: "tcp" })).toString("base64")}`;
const LINKS = [
  "vless://u@a.example.com:443?type=ws&path=%2Fws#DE-1",
  "vless://u@b.example.com:443?type=ws&path=%2Fws%3Fed%3D2048#DE-1",
  "trojan://p@n.example.com:2083?type=grpc&serviceName=tg#%F0%9F%87%B3%F0%9F%87%B1%20NL%20%E2%88%9E",
  vmess,
  "ss://YWVzLTI1Ni1nY206cA@s.example.com:8388#SS",
];

describe("Reading a panel group's hosts", () => {
  it("Gives each host the id the panel service gives it", () => {
    const hosts = probeHosts(LINKS.join("\n"));
    assert.deepEqual(
      hosts.map((host) => host.id),
      ["6K3FdTiXmihf", "6K3FdTiXmihf-2", "yWK4Ru09aMKj", "FqnAjBweQ0Nb", "iQLNP3-x739d"],
    );
  });

  it("Reads protocol, port, transport and path, leaving early data out of the path", () => {
    const [first, second, grpc, vm, ss] = probeHosts(LINKS.join("\n"));
    assert.deepEqual([first!.protocol, first!.port, first!.network, first!.path], ["vless", 443, "ws", "/ws"]);
    assert.equal(second!.path, "/ws");
    assert.deepEqual([grpc!.network, grpc!.path, grpc!.name], ["grpc", "tg", "🇳🇱 NL ∞"]);
    assert.deepEqual([vm!.protocol, vm!.port, vm!.network], ["vmess", 8080, null]);
    assert.equal(ss!.protocol, "shadowsocks");
  });

  it("Keeps an id when only an address picked at random changes", () => {
    const [a] = probeHosts("vless://u@x.example.com:443?type=ws#DE");
    const [b] = probeHosts("vless://u@y.example.com:443?type=ws#DE");
    assert.equal(a!.id, b!.id);
    assert.notEqual(probeHosts("vless://u@x.example.com:443?type=ws#DE 2")[0]!.id, a!.id);
  });

  it("Leaves out lines that are not links", () => {
    assert.equal(probeHosts("# a comment\n\nvless://u@a:443#A\nnot a link").length, 1);
    assert.equal(linkConfig("vless://u@[2001:db8::1]:443#v6").server, "2001:db8::1");
  });
});
