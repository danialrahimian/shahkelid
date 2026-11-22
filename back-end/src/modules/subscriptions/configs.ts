import { createHash } from "node:crypto";

/**
 * The hosts a panel group gives, read from the shop's own subscription on
 * it (groups/catalog.ts), for the staff pages.
 *
 * Each host gets an id made from its config (protocol, port, transport,
 * path and name), so staff picks and names stay with it. The panel service
 * (panel/internal/configs, in Go) makes the same ids when it shapes the
 * customer's link: the two must agree, and its tests pin the values made
 * here.
 */

/** What identifies a config apart from whose it is. */
export type Fingerprint = {
  name: string;
  protocol: string | null;
  server: string | null;
  port: number | null;
  network: string | null;
  path: string | null;
  sni: string | null;
};

/** A host as read from the shop's own subscription: a config with an id of ours. */
export type ProbeHost = Fingerprint & { id: string };

const PROTOCOLS: Record<string, string> = { ss: "shadowsocks", hy2: "hysteria2", wg: "wireguard" };
export const protocolName = (name: string) => PROTOCOLS[name.toLowerCase()] ?? name.toLowerCase();

/** tcp and raw are what no transport means. */
const networkName = (value: unknown) => {
  const name = typeof value === "string" ? value.toLowerCase() : "";
  return name === "" || name === "tcp" || name === "raw" || name === "none" ? null : name;
};

/** Early-data and other query parts are left out: the path itself is what matters. */
const pathName = (value: unknown) => {
  if (typeof value !== "string" || value === "") return null;
  let path = value.split("?")[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    // as it is
  }
  path = path.replace(/\/+$/, "");
  return path === "" ? null : path;
};

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
const portOf = (value: unknown) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : null;
};

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

const vmessJson = (line: string) => {
  try {
    return JSON.parse(Buffer.from(line.slice("vmess://".length), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** A config link's fingerprint (vless://, vmess://, trojan://, ss://…). */
export const linkConfig = (line: string): Fingerprint => {
  const scheme = SCHEME.exec(line)![1]!.toLowerCase();
  if (scheme === "vmess") {
    const json = vmessJson(line);
    if (json) {
      return {
        name: String(json.ps ?? ""),
        protocol: "vmess",
        server: text(json.add),
        port: portOf(json.port),
        network: networkName(json.net),
        path: pathName(json.path),
        sni: text(json.sni) ?? text(json.host),
      };
    }
  }
  const hash = line.indexOf("#");
  let name = "";
  if (hash >= 0) {
    try {
      name = decodeURIComponent(line.slice(hash + 1));
    } catch {
      name = line.slice(hash + 1);
    }
  }
  let url: URL | null = null;
  try {
    url = new URL(hash >= 0 ? line.slice(0, hash) : line);
  } catch {
    url = null;
  }
  const query = url?.searchParams;
  return {
    name,
    protocol: protocolName(scheme),
    server: url?.hostname ? url.hostname.replace(/^\[|\]$/g, "") : null,
    port: portOf(url?.port),
    network: networkName(query?.get("type")),
    path: pathName(query?.get("path") ?? query?.get("serviceName")),
    sni: text(query?.get("sni")) ?? text(query?.get("host")),
  };
};

const linesOf = (body: string) =>
  body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const hostId = (fingerprint: Fingerprint) =>
  createHash("sha1")
    .update([fingerprint.protocol, fingerprint.port, fingerprint.network, fingerprint.path, fingerprint.name].join("\u0000"))
    .digest("base64url")
    .slice(0, 12);

/**
 * The hosts a subscription's links stand for, each with an id that stays
 * the same as long as the host does. Two configs alike in all of those are
 * told apart by their place.
 */
export const probeHosts = (links: string): ProbeHost[] => {
  const seen = new Map<string, number>();
  return linesOf(links)
    .filter((line) => SCHEME.test(line))
    .map((line) => {
      const fingerprint = linkConfig(line);
      const base = hostId(fingerprint);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return { ...fingerprint, id: count === 1 ? base : `${base}-${count}` };
    });
};
