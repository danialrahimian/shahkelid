import yaml from "js-yaml";

import { createHash } from "node:crypto";

/**
 * Shaping what the panels answer to the customer's link by our groups.
 *
 * A panel gives a user one config per host of its groups. Our groups say
 * which of those the customer gets, under what name, and in what order. So
 * each config in the panel's answer is matched to a host, then:
 *
 * - a host the groups did not pick is left out;
 * - a host with a name of ours is renamed (PasarGuard's variables, like
 *   {DATA_LEFT}, filled in from the subscription as a whole, all panels
 *   together);
 * - the configs are put in the groups' order, the hosts' order within each.
 *
 * The answer keeps its format: a list of links (plain or base64), xray JSON,
 * a sing-box profile or a Clash profile. For the last two the profile's
 * selectors are kept, listing the configs that are left, renamed and in
 * order.
 *
 * Where the hosts come from: a panel account of a reseller cannot read the
 * panel's hosts, so the shop keeps a subscription of its own on each panel
 * group (groups/catalog.ts) and reads what that gives: its configs are the
 * group's hosts. A customer's config is the host with the same protocol,
 * port, transport and path, and of those the one whose name and address
 * are closest. One that matches no host is kept only where the groups take
 * every host the panel gives; where hosts are picked, giving a config no
 * one picked would be wrong. A panel that cannot be read gives its configs
 * as they are.
 */

export type HostWanted = { rank: number; name: string | null };

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

export type PanelPlan = {
  /** The hosts this panel may give the user; null: unknown (the panel could not be read). */
  hosts: ProbeHost[] | null;
  /** The hosts the groups picked, by host id. */
  wanted: Map<string, HostWanted>;
  /** Whether a config that matches no host is kept. */
  keepUnknown: boolean;
};

export type Totals = {
  username: string;
  status: string;
  usedBytes: number;
  dataLimitBytes: number | null;
  expiresAt: Date | null;
  onHoldDurationSeconds: number | null;
};

// ------------------------------------------------------------ the variables

export const readableSize = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 100) / 100} ${units[unit]}`;
};

const STATUS_EMOJI: Record<string, string> = {
  active: "✅",
  on_hold: "🔌",
  limited: "🪫",
  expired: "⌛️",
  disabled: "❌",
};

/** PasarGuard's remark variables, from the subscription as a whole. */
export const renderName = (
  template: string,
  totals: Totals,
  config: { protocol: string | null; network: string | null; server: string | null },
  now = new Date(),
) => {
  const left = totals.dataLimitBytes === null ? null : Math.max(0, totals.dataLimitBytes - totals.usedBytes);
  const seconds = totals.expiresAt
    ? Math.max(0, (totals.expiresAt.getTime() - now.getTime()) / 1000)
    : totals.onHoldDurationSeconds;
  const days = seconds === null ? null : Math.floor(seconds / 86400);
  const values: Record<string, string> = {
    USERNAME: totals.username,
    DATA_USAGE: readableSize(totals.usedBytes),
    DATA_LEFT: left === null ? "∞" : readableSize(left),
    DATA_LIMIT: totals.dataLimitBytes === null ? "∞" : readableSize(totals.dataLimitBytes),
    USAGE_PERCENTAGE: totals.dataLimitBytes ? `${Math.min(100, Math.round((totals.usedBytes / totals.dataLimitBytes) * 100))}` : "0",
    DAYS_LEFT: days === null ? "∞" : `${days}`,
    TIME_LEFT:
      seconds === null ? "∞" : days! > 0 ? `${days}d ${Math.floor((seconds % 86400) / 3600)}h` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`,
    EXPIRE_DATE: totals.expiresAt ? totals.expiresAt.toISOString().slice(0, 10) : "∞",
    JALALI_EXPIRE_DATE: totals.expiresAt
      ? (() => {
          const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" })
            .formatToParts(totals.expiresAt);
          const part = (type: string) => parts.find((each) => each.type === type)?.value ?? "";
          return `${part("year")}/${part("month")}/${part("day")}`;
        })()
      : "∞",
    STATUS_EMOJI: STATUS_EMOJI[totals.status] ?? "",
    STATUS_TEXT: totals.status,
    PROTOCOL: config.protocol ?? "",
    TRANSPORT: config.network ?? "",
    SERVER_IP: config.server ?? "",
  };
  return template.replace(/\{([A-Z_]+)\}/g, (whole, name: string) => values[name] ?? whole);
};

// --------------------------------------------------------------- matching

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

const hostId = (fingerprint: Fingerprint) =>
  createHash("sha1")
    .update([fingerprint.protocol, fingerprint.port, fingerprint.network, fingerprint.path, fingerprint.name].join("\u0000"))
    .digest("base64url")
    .slice(0, 12);

/**
 * The hosts a subscription's configs stand for, each with an id that stays
 * the same as long as the host does (its name, protocol, port, transport and
 * path). Two configs alike in all of those are told apart by their place.
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

const loose = (name: string, usernames: string[]) => {
  let out = name.toLowerCase();
  for (const username of usernames) if (username) out = out.split(username.toLowerCase()).join("");
  return out;
};

/** How alike two names are, 0 to 1: their common start and end against the longer. */
const likeness = (a: string, b: string) => {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return (start + end) / longest;
};

const ENOUGH = 1.5;

const same = (a: unknown, b: unknown) => a === null || b === null || a === b;

/**
 * Which host each config is. Only a host of the same protocol, port,
 * transport and path can be it (a part one side does not say is not held
 * against it); of those, the one with the closest name, then the same
 * address and server name, then the first not taken; and only if the name
 * is at least half alike (or the same address and server name back it).
 */
export const matchHosts = (configs: Fingerprint[], hosts: ProbeHost[], usernames: string[] = []) => {
  const used = new Set<number>();
  return configs.map((config) => {
    let best = -1;
    let bestScore = -1;
    for (const [index, host] of hosts.entries()) {
      if (used.has(index)) continue;
      if (config.protocol && host.protocol && config.protocol !== host.protocol) continue;
      if (!same(config.port, host.port) || !same(config.network, host.network) || !same(config.path, host.path)) continue;
      const score =
        (config.name === host.name ? 4 : 3 * likeness(loose(config.name, usernames), loose(host.name, usernames))) +
        (config.server !== null && config.server === host.server ? 1 : 0) +
        (config.sni !== null && config.sni === host.sni ? 0.5 : 0);
      // Alike enough to be it: mostly by name. A config no host's name is
      // like (one the panel added since) is not given someone else's place.
      if (score >= ENOUGH && score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    if (best < 0) return null;
    used.add(best);
    return hosts[best]!;
  });
};

// ---------------------------------------------------------------- formats

type Parsed<Doc, Item> = { doc: Doc; items: Item[]; configs: Fingerprint[] };

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

const fromBase64 = (text: string) => {
  const compact = text.replace(/\s+/g, "");
  if (compact === "" || !/^[A-Za-z0-9+/_-]+=*$/.test(compact)) return null;
  const decoded = Buffer.from(compact, "base64").toString("utf8");
  return decoded.includes("://") ? decoded : null;
};

const vmessJson = (line: string) => {
  try {
    return JSON.parse(Buffer.from(line.slice("vmess://".length), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const linkConfig = (line: string): Fingerprint => {
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

const renameLink = (line: string, name: string) => {
  if (/^vmess:\/\//i.test(line)) {
    const json = vmessJson(line);
    if (json) return `vmess://${Buffer.from(JSON.stringify({ ...json, ps: name }), "utf8").toString("base64")}`;
  }
  const hash = line.indexOf("#");
  return `${hash >= 0 ? line.slice(0, hash) : line}#${encodeURIComponent(name)}`;
};

const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const asLinks = (body: string): Parsed<{ base64: boolean }, string> | null => {
  const decoded = fromBase64(body);
  const lines = linesOf(decoded ?? body);
  if (lines.length === 0 || !lines.every((line) => SCHEME.test(line))) return null;
  return { doc: { base64: decoded !== null }, items: lines, configs: lines.map(linkConfig) };
};

const PROXY_TYPES = new Set([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "ss",
  "hysteria",
  "hysteria2",
  "tuic",
  "wireguard",
  "shadowtls",
  "socks",
  "socks5",
  "http",
  "ssh",
  "anytls",
  "naive",
]);

type Outbound = Record<string, unknown> & { tag?: string; type?: string; outbounds?: unknown[] };
type SingBox = Record<string, unknown> & { outbounds: Outbound[] };

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const asSingBox = (body: string): Parsed<SingBox, Outbound> | null => {
  const json = parseJson(body) as SingBox | undefined;
  if (!json || typeof json !== "object" || Array.isArray(json) || !Array.isArray(json.outbounds)) return null;
  const items = json.outbounds.filter((outbound) => PROXY_TYPES.has(String(outbound.type)) && typeof outbound.tag === "string");
  return {
    doc: json,
    items,
    configs: items.map((item) => {
      const transport = (item.transport ?? {}) as Record<string, unknown>;
      const tls = (item.tls ?? {}) as Record<string, unknown>;
      return {
        name: item.tag!,
        protocol: protocolName(String(item.type)),
        server: text(item.server),
        port: portOf(item.server_port),
        network: networkName(transport.type),
        path: pathName(transport.path ?? transport.service_name),
        sni: text(tls.server_name) ?? text((transport.headers as Record<string, unknown> | undefined)?.Host),
      };
    }),
  };
};

type XrayConfig = Record<string, unknown> & { remarks?: string; outbounds?: { protocol?: string; settings?: unknown }[] };

const asXray = (body: string): Parsed<null, XrayConfig> | null => {
  const json = parseJson(body);
  if (!Array.isArray(json) || json.length === 0 || !json.every((item) => item && typeof item === "object" && "remarks" in item)) return null;
  const items = json as XrayConfig[];
  return {
    doc: null,
    items,
    configs: items.map((item) => {
      const outbound = (item.outbounds?.[0] ?? {}) as Record<string, unknown>;
      const settings = (outbound.settings ?? {}) as Record<string, unknown>;
      const target = ((settings.vnext ?? settings.servers) as Record<string, unknown>[] | undefined)?.[0] ?? settings;
      const stream = (outbound.streamSettings ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
      const network = networkName(stream.network);
      const transport = (network ? stream[`${network === "xhttp" ? "xhttp" : network}Settings`] : undefined) as Record<string, unknown> | undefined;
      const security = (stream.tlsSettings ?? stream.realitySettings ?? {}) as Record<string, unknown>;
      return {
        name: String(item.remarks ?? ""),
        protocol: typeof outbound.protocol === "string" ? protocolName(outbound.protocol) : null,
        server: text(target.address),
        port: portOf(target.port),
        network,
        path: pathName(transport?.path ?? transport?.serviceName),
        sni: text(security.serverName),
      };
    }),
  };
};

type ClashProxy = Record<string, unknown> & { name: string; type?: string; server?: string };
type Clash = Record<string, unknown> & { proxies: ClashProxy[]; "proxy-groups"?: (Record<string, unknown> & { proxies?: unknown[] })[] };

const asClash = (body: string): Parsed<Clash, ClashProxy> | null => {
  if (parseJson(body) !== undefined) return null;
  let doc: unknown;
  try {
    doc = yaml.load(body);
  } catch {
    return null;
  }
  const clash = doc as Clash | undefined;
  if (!clash || typeof clash !== "object" || !Array.isArray(clash.proxies)) return null;
  const items = clash.proxies.filter((proxy) => proxy && typeof proxy.name === "string");
  return {
    doc: clash,
    items,
    configs: items.map((item) => {
      const ws = (item["ws-opts"] ?? {}) as Record<string, unknown>;
      const grpc = (item["grpc-opts"] ?? {}) as Record<string, unknown>;
      const http = (item["h2-opts"] ?? item["http-opts"] ?? {}) as Record<string, unknown>;
      return {
        name: item.name,
        protocol: item.type ? protocolName(item.type) : null,
        server: text(item.server),
        port: portOf(item.port),
        network: networkName(item.network),
        path: pathName(ws.path ?? grpc["grpc-service-name"] ?? (Array.isArray(http.path) ? http.path[0] : http.path)),
        sni: text(item.servername) ?? text(item.sni),
      };
    }),
  };
};

/**
 * A list of references (a selector's outbounds, a proxy group's proxies)
 * with the configs replaced by the ones kept: in their order, where the
 * first config stood. Other references (another selector, "direct") stay.
 */
const relist = (refs: unknown[], wasConfig: Set<string>, kept: string[]) => {
  const out: unknown[] = [];
  let placed = false;
  for (const ref of refs) {
    if (typeof ref === "string" && wasConfig.has(ref)) {
      if (!placed) out.push(...kept);
      placed = true;
    } else out.push(ref);
  }
  return out;
};

/** Names must be unique inside a profile: a second "Germany" becomes "Germany 2". */
const uniqueNames = (names: string[]) => {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} ${count}`;
  });
};

// ------------------------------------------------------------------ shaping

type Format = "links" | "xray" | "singbox" | "clash";

const parse = (body: string) => {
  const links = asLinks(body);
  if (links) return { format: "links" as const, parsed: links };
  const singbox = asSingBox(body);
  if (singbox) return { format: "singbox" as const, parsed: singbox };
  const xray = asXray(body);
  if (xray) return { format: "xray" as const, parsed: xray };
  const clash = asClash(body);
  if (clash) return { format: "clash" as const, parsed: clash };
  return null;
};

type Kept = { item: unknown; name: string; rank: number; renamed: boolean };

/**
 * The panels' answers (one per panel, the main panel first) as one answer,
 * shaped by the groups. null when an answer is in no format we can read,
 * or the panels answered in different formats: the caller then passes the
 * answers on as they are.
 */
export const shapeConfigs = (
  bodies: string[],
  plans: PanelPlan[],
  totals: Totals,
  now = new Date(),
  /** Names the configs carry that say whose they are (the customer's and the shop's own usernames). */
  usernames: string[] = [totals.username],
): string | null => {
  const read = bodies.map(parse);
  if (read.some((entry) => entry === null)) return null;
  const format = read[0]!.format as Format;
  if (read.some((entry) => entry!.format !== format)) return null;

  const kept: Kept[] = [];
  for (const [panelIndex, entry] of read.entries()) {
    const plan = plans[panelIndex]!;
    const { items, configs } = entry!.parsed as Parsed<unknown, unknown>;
    const hosts = plan.hosts ? matchHosts(configs, plan.hosts, usernames) : configs.map(() => null);
    for (const [index, config] of configs.entries()) {
      const host = hosts[index];
      const fallbackRank = 1e12 + panelIndex * 1e6 + index;
      if (!plan.hosts) {
        kept.push({ item: items[index], name: config.name, rank: fallbackRank, renamed: false });
        continue;
      }
      if (!host) {
        if (plan.keepUnknown) kept.push({ item: items[index], name: config.name, rank: fallbackRank, renamed: false });
        continue;
      }
      const wanted = plan.wanted.get(host.id);
      if (!wanted) continue;
      const name = wanted.name
        ? renderName(wanted.name, totals, { protocol: config.protocol ?? host.protocol, network: config.network ?? host.network, server: config.server }, now)
        : config.name;
      kept.push({ item: items[index], name, rank: wanted.rank * 1e6 + index, renamed: name !== config.name });
    }
  }
  kept.sort((a, b) => a.rank - b.rank);

  if (format === "links") {
    const lines = kept.map((entry) => (entry.renamed ? renameLink(entry.item as string, entry.name) : (entry.item as string)));
    const text = [...new Set(lines)].join("\n");
    return (read[0]!.parsed.doc as { base64: boolean }).base64 ? Buffer.from(text, "utf8").toString("base64") : text;
  }

  if (format === "xray") {
    return JSON.stringify(kept.map((entry) => (entry.renamed ? { ...(entry.item as XrayConfig), remarks: entry.name } : entry.item)));
  }

  const names = uniqueNames(kept.map((entry) => entry.name));
  // Every config name any panel used, so selectors drop the ones left out.
  const wasConfig = new Set(read.flatMap((entry) => entry!.parsed.configs.map((config) => config.name)));

  if (format === "singbox") {
    const base = read[0]!.parsed.doc as SingBox;
    const proxies = kept.map((entry, index) => ({ ...(entry.item as Outbound), tag: names[index] }));
    const outbounds: Outbound[] = [];
    let placed = false;
    for (const outbound of base.outbounds) {
      if (typeof outbound.tag === "string" && wasConfig.has(outbound.tag) && PROXY_TYPES.has(String(outbound.type))) {
        if (!placed) outbounds.push(...proxies);
        placed = true;
        continue;
      }
      if (Array.isArray(outbound.outbounds)) {
        const next: Outbound = { ...outbound, outbounds: relist(outbound.outbounds, wasConfig, names) };
        if (typeof next.default === "string" && wasConfig.has(next.default) && !names.includes(next.default)) delete next.default;
        outbounds.push(next);
      } else outbounds.push(outbound);
    }
    if (!placed) outbounds.push(...proxies);
    return JSON.stringify({ ...base, outbounds }, null, 2);
  }

  const base = read[0]!.parsed.doc as Clash;
  const proxies = kept.map((entry, index) => ({ ...(entry.item as ClashProxy), name: names[index]! }));
  const groups = (base["proxy-groups"] ?? []).map((group) =>
    Array.isArray(group.proxies) ? { ...group, proxies: relist(group.proxies, wasConfig, names) } : group,
  );
  return yaml.dump({ ...base, proxies, ...(base["proxy-groups"] ? { "proxy-groups": groups } : {}) }, { lineWidth: -1, noRefs: true });
};

