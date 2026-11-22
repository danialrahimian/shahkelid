import { createHash } from "node:crypto";

/**
 * The hosts a panel group gives, read from the shop's own subscription on
 * it (groups/catalog.ts), for the staff pages.
 *
 * Each host gets an id made from its protocol, transport and name, so staff
 * picks and names stay with it. Not its address, port, server name or
 * path: PasarGuard picks those at random from a host's lists on every
 * request, and fills variables in a path. A host renamed on the panel is
 * found again from what was saved about it (rekey).
 *
 * The panel service (panel/internal/configs, in Go) makes the same ids and
 * re-keys the same way when it shapes the customer's link: the two must
 * agree, and both test suites pin the same values.
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

/** One name per protocol; PasarGuard's "hysteria" is Hysteria 2 (it makes no other). */
const PROTOCOLS: Record<string, string> = { ss: "shadowsocks", hy2: "hysteria2", hysteria: "hysteria2", wg: "wireguard" };
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

const digest = (...parts: (string | number | null)[]) =>
  createHash("sha1").update(parts.join("\u0000")).digest("base64url").slice(0, 12);

const hostId = (f: Fingerprint) => digest(f.protocol, f.network, f.name);

/** The id earlier releases gave a host (with its port and path): picks saved under it are found again. */
const legacyHostId = (f: Fingerprint) => digest(f.protocol, f.port, f.network, f.path, f.name);

export type ProbeHostWithLegacy = ProbeHost & { legacyId: string };

/** A full Xray config's fingerprint (PasarGuard's "xray" format): its first outbound is the proxy. */
const xrayConfig = (config: Record<string, unknown>): Fingerprint => {
  const outbound = ((config.outbounds as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
  const settings = (outbound.settings ?? {}) as Record<string, unknown>;
  const list = (settings.vnext ?? settings.servers) as Record<string, unknown>[] | undefined;
  const target = (Array.isArray(list) && list.length > 0 ? list[0]! : settings) as Record<string, unknown>;
  const stream = (outbound.streamSettings ?? {}) as Record<string, unknown>;
  const network = networkName(stream.network);
  const transport = (network ? stream[`${network}Settings`] : undefined) as Record<string, unknown> | undefined;
  const security = (stream.tlsSettings ?? stream.realitySettings ?? {}) as Record<string, unknown>;
  return {
    name: typeof config.remarks === "string" ? config.remarks : "",
    protocol: typeof outbound.protocol === "string" ? protocolName(outbound.protocol) : null,
    server: text(target.address),
    port: portOf(target.port),
    network,
    path: pathName(transport?.path ?? transport?.serviceName),
    sni: text(security.serverName),
  };
};

const fingerprintsOf = (body: string): Fingerprint[] => {
  try {
    const json = JSON.parse(body) as unknown;
    if (Array.isArray(json) && json.every((item) => item && typeof item === "object" && "remarks" in item)) {
      return (json as Record<string, unknown>[]).map(xrayConfig);
    }
  } catch {
    // not JSON: links
  }
  return linesOf(body)
    .filter((line) => SCHEME.test(line))
    .map(linkConfig);
};

/**
 * The hosts the shop's own subscription gives: from PasarGuard's Xray JSON
 * (which carries every host, whatever its transport), or from a list of
 * links. Two alike in protocol, transport and name are told apart by their
 * place.
 */
export const probeHosts = (body: string): ProbeHostWithLegacy[] => {
  const seen = new Map<string, number>();
  return fingerprintsOf(body).map((fingerprint) => {
    const base = hostId(fingerprint);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const legacy = legacyHostId(fingerprint);
    return count === 1
      ? { ...fingerprint, id: base, legacyId: legacy }
      : { ...fingerprint, id: `${base}-${count}`, legacyId: `${legacy}-${count}` };
  });
};

/** How alike two names are, 0 to 1: their common start and end against the longer, in characters. */
const likeness = (a: string, b: string) => {
  if (a === b) return 1;
  const x = [...a];
  const y = [...b];
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start += 1;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end += 1;
  return (start + end) / longest;
};

/** What was saved about a host with a group's settings for it, to find it again. */
export type Saved = { hostId: string } & Partial<Fingerprint>;

/**
 * Which new hosts the settings of hosts that are gone now belong to: a host
 * the panel renamed gets a new id, and what was saved about the old one
 * finds it again. A setting goes only to a host of the same protocol and
 * transport whose name is much like the saved one or whose address or
 * server name is the saved one, and only when plainly the one (the only
 * such host, or clearly the most alike). Gives orphan host id → new host
 * id. The panel service does the same (configs.Rekey).
 */
export const rekey = (orphans: Saved[], free: ProbeHost[]): Map<string, string> => {
  const out = new Map<string, string>();
  const taken = new Set<number>();
  for (const orphan of orphans) {
    if (!orphan.protocol) continue; // saved before fingerprints were kept
    const candidates: { index: number; score: number }[] = [];
    free.forEach((host, index) => {
      if (taken.has(index) || host.protocol !== orphan.protocol || (host.network ?? null) !== (orphan.network ?? null)) return;
      const alike = likeness((orphan.name ?? "").toLowerCase(), host.name.toLowerCase());
      const sameServer = Boolean(orphan.server) && orphan.server === host.server;
      const sameSni = Boolean(orphan.sni) && orphan.sni === host.sni;
      if (alike < 0.5 && !sameServer && !sameSni) return;
      let score = 3 * alike;
      if (sameServer) score += 1;
      if (orphan.port != null && orphan.port === host.port) score += 0.5;
      if (orphan.path && orphan.path === host.path) score += 0.5;
      if (orphan.sni && orphan.sni === host.sni) score += 0.5;
      candidates.push({ index, score });
    });
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.score - a.score);
    const [best, second] = candidates;
    const clear = second === undefined ? best!.score >= 1 : best!.score >= 1.5 && best!.score - second.score >= 1;
    if (!clear) continue;
    taken.add(best!.index);
    out.set(orphan.hostId, free[best!.index]!.id);
  }
  return out;
};

/** What settling a group's saved hosts against what a panel gives now changes. */
export type Settlement = {
  /** A saved host's id → the id its host has now (earlier releases' id, or renamed on the panel). */
  moves: Map<string, string>;
  /** Hosts the group has not seen before: to be recorded. */
  fresh: ProbeHostWithLegacy[];
  /** Saved hosts given now whose fingerprint was not kept yet. */
  fill: string[];
};

/**
 * Settles what a group has saved about one panel's hosts against what that
 * panel gives now. The group keeps a row for every host it has seen, so a
 * host that is gone is told apart from one that is new: a row whose host
 * is gone is moved only to a host never seen before (renamed on the panel,
 * or under the id earlier releases gave), never to one the group already
 * knows (a host deleted on the panel leaves its sibling's settings alone).
 * A row whose host is gone and not found again stays, for if it comes
 * back. The panel service does the same (configs.Settle).
 */
export const settle = (rows: Saved[], hosts: ProbeHostWithLegacy[]): Settlement => {
  const ids = new Set(hosts.map((host) => host.id));
  const saved = new Set(rows.map((row) => row.hostId));
  const moves = new Map<string, string>();
  const claimed = new Set<string>();
  for (const host of hosts) {
    if (saved.has(host.id) || claimed.has(host.id)) continue;
    if (saved.has(host.legacyId) && !ids.has(host.legacyId) && !moves.has(host.legacyId)) {
      moves.set(host.legacyId, host.id);
      claimed.add(host.id);
    }
  }
  const orphans = rows.filter((row) => !ids.has(row.hostId) && !moves.has(row.hostId));
  const unseen = hosts.filter((host) => !saved.has(host.id) && !claimed.has(host.id));
  for (const [from, to] of rekey(orphans, unseen)) {
    moves.set(from, to);
    claimed.add(to);
  }
  return {
    moves,
    fresh: unseen.filter((host) => !claimed.has(host.id)),
    fill: rows.filter((row) => ids.has(row.hostId) && !row.protocol).map((row) => row.hostId),
  };
};

export const settled = (settlement: Settlement) =>
  settlement.moves.size === 0 && settlement.fresh.length === 0 && settlement.fill.length === 0;
