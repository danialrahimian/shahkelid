import type { PanelGroup } from "@shah-kelid/contracts";
import yaml from "js-yaml";

import {
  PanelRejectedError,
  PanelUnavailableError,
  type LimitsChange,
  type NewPanelUser,
  type PanelDriver,
  type PanelUser,
} from "../../src/modules/provisioning/driver";

/** A host on the fake panel: one config for each user whose groups grant its inbound. */
export type FakeHost = {
  id: number;
  remark: string;
  inboundTag: string | null;
  /** null: the inbound's own port. */
  port: number | null;
  priority: number;
  disabled: boolean;
  /** The user statuses it is given to; empty: every status. */
  statuses: string[];
  address: string;
};
export type FakeInbound = { tag: string; protocol: string; network: string | null; port: number };

/**
 * A VPN panel in memory, behaving the way the contract tests showed
 * PasarGuard behaves: usernames are unique, a missing user reads as null,
 * a revoked link changes.
 *
 * Tests can take it down (`down = true`) or make it refuse, and move usage
 * forward as if the customer had been online.
 */
export class FakePanel implements PanelDriver {
  users = new Map<string, PanelUser>();
  groups: PanelGroup[] = [{ id: 1, name: "tunnel", inboundTags: ["vless-ws"] }];
  inbounds: FakeInbound[] = [
    { tag: "vless-ws", protocol: "vless", network: "ws", port: 443 },
    { tag: "vmess-tcp", protocol: "vmess", network: "tcp", port: 8080 },
    { tag: "trojan-grpc", protocol: "trojan", network: "grpc", port: 2083 },
  ];
  hosts: FakeHost[] = [
    { id: 1, remark: "🚀 {USERNAME} [{PROTOCOL}]", inboundTag: "vless-ws", port: null, priority: 1, disabled: false, statuses: [], address: "a.example.com" },
  ];
  down = false;
  /** Signed in with a reseller's account: groups without their inbounds. */
  reseller = false;
  /** The account may not make users without a volume or an expiry (a reseller's limits). */
  limited = false;
  /** Answers every call with "wrong credentials". */
  refuse = false;
  /** Where users' subscription links point; a test can serve them locally. */
  subscriptionBase = "https://panel.test/sub";
  /** Fail this many calls, then work again. */
  failNext = 0;
  calls: string[] = [];
  /** Every limits change asked for, in order. */
  updates: { username: string; change: LimitsChange }[] = [];
  private nextId = 1;

  private gate(call: string) {
    this.calls.push(call);
    if (this.refuse) throw new PanelRejectedError(401, "Incorrect username or password");
    if (this.down) throw new PanelUnavailableError("fake panel is down");
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new PanelUnavailableError("fake panel failed once");
    }
  }

  private user(username: string) {
    const user = this.users.get(username);
    if (!user) throw new PanelRejectedError(404, `no user ${username}`);
    return user;
  }

  /** As if the customer used this much, and connected just now. */
  use(username: string, bytes: number) {
    const user = this.user(username);
    user.usedBytes += bytes;
    user.lifetimeUsedBytes += bytes;
    user.onlineAt = new Date();
    if (user.status === "on_hold") {
      user.status = "active";
      user.expiresAt = new Date(Date.now() + (user.onHoldDurationSeconds ?? 0) * 1000);
      user.onHoldDurationSeconds = null;
    }
    if (user.dataLimitBytes !== null && user.usedBytes >= user.dataLimitBytes) user.status = "limited";
  }

  async health() {
    this.gate("health");
    return { version: "5.4.1-fake" };
  }

  async listGroups() {
    this.gate("listGroups");
    // A reseller account reads ids and names only.
    return this.groups.map((group) =>
      this.reseller ? { id: group.id, name: group.name } : { ...group, inboundTags: [...(group.inboundTags ?? [])] },
    );
  }

  async readLinks(subscriptionUrl: string) {
    this.gate("readLinks");
    const user = [...this.users.values()].find((candidate) => candidate.subscriptionUrl === subscriptionUrl.replace(/\/+$/, ""));
    if (!user) throw new PanelRejectedError(404, "Not Found");
    return Buffer.from(this.render(user.username).body, "base64").toString("utf8");
  }

  // ------------------------------------------------- the user's subscription

  /** The hosts a user is given, in the panel's order, as PasarGuard picks them. */
  private hostsFor(user: PanelUser) {
    const inbounds = new Set(
      this.groups.filter((group) => user.groupIds.includes(group.id)).flatMap((group) => group.inboundTags ?? []),
    );
    return [...this.hosts]
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .filter((host) => !host.disabled && host.inboundTag && inbounds.has(host.inboundTag))
      .filter((host) => host.statuses.length === 0 || host.statuses.includes(user.status));
  }

  private remarkOf(template: string, user: PanelUser, inbound: FakeInbound) {
    const left = user.dataLimitBytes === null ? "∞" : `${Math.max(0, user.dataLimitBytes - user.usedBytes)}B`;
    const values: Record<string, string> = {
      USERNAME: user.username,
      PROTOCOL: inbound.protocol,
      TRANSPORT: inbound.network ?? "tcp",
      DATA_LEFT: left,
      DAYS_LEFT: "30",
      STATUS_EMOJI: "✅",
    };
    return template.replace(/\{([A-Z_]+)\}/g, (whole, key: string) => values[key] ?? "<missing>");
  }

  /**
   * A user's configs as PasarGuard would serve them to this app: sing-box
   * for Hiddify and sing-box apps, Clash YAML for Clash apps, and a base64
   * list of links for everything else.
   */
  render(username: string, userAgent = ""): { body: string; contentType: string } {
    const user = this.users.get(username);
    if (!user) return { body: "Not Found", contentType: "text/plain" };
    const items = this.hostsFor(user).map((host) => {
      const inbound = this.inbounds.find((candidate) => candidate.tag === host.inboundTag)!;
      return { host, inbound, remark: this.remarkOf(host.remark, user, inbound), port: host.port ?? inbound.port };
    });
    const secret = `uuid-${user.id}`;

    if (/^(SFA|SFI|SFM|SFT|[Kk]aring|[Hh]iddify[Nn]ext)|.*[Ss]ing[-b]?ox.*/.test(userAgent)) {
      const proxies = items.map(({ host, inbound, remark, port }) => ({
        type: inbound.protocol === "shadowsocks" ? "shadowsocks" : inbound.protocol,
        tag: remark,
        server: host.address,
        server_port: port,
        uuid: secret,
      }));
      const tags = proxies.map((proxy) => proxy.tag);
      return {
        contentType: "application/json",
        body: JSON.stringify({
          log: { level: "warn" },
          outbounds: [
            { type: "selector", tag: "Select", outbounds: ["Auto", ...tags] },
            { type: "urltest", tag: "Auto", outbounds: tags },
            ...proxies,
            { type: "direct", tag: "direct" },
          ],
        }),
      };
    }

    if (/^([Cc]lash|[Ss]tash|FlClash|mihomo)/.test(userAgent)) {
      const proxies = items.map(({ host, inbound, remark, port }) => ({
        name: remark,
        type: inbound.protocol === "shadowsocks" ? "ss" : inbound.protocol,
        server: host.address,
        port,
        uuid: secret,
      }));
      const names = proxies.map((proxy) => proxy.name);
      return {
        contentType: "text/yaml",
        body: yaml.dump({
          "mixed-port": 7890,
          proxies,
          "proxy-groups": [
            { name: "Select", type: "select", proxies: ["Auto", ...names] },
            { name: "Auto", type: "url-test", proxies: names },
          ],
          rules: ["MATCH,Select"],
        }),
      };
    }

    const links = items.map(({ host, inbound, remark, port }) => {
      const fragment = encodeURIComponent(remark);
      switch (inbound.protocol) {
        case "vmess":
          return `vmess://${Buffer.from(
            JSON.stringify({ add: host.address, id: secret, net: inbound.network, port, ps: remark, v: "2" }),
          ).toString("base64")}`;
        case "trojan":
          return `trojan://${secret}@${host.address}:${port}?type=${inbound.network}#${fragment}`;
        case "shadowsocks":
          return `ss://${Buffer.from(`chacha20-ietf-poly1305:${secret}`).toString("base64")}@${host.address}:${port}#${fragment}`;
        default:
          return `${inbound.protocol}://${secret}@${host.address}:${port}?type=${inbound.network}&security=none#${fragment}`;
      }
    });
    return { contentType: "text/plain", body: Buffer.from(links.join("\n")).toString("base64") };
  }

  async createUser(input: NewPanelUser) {
    this.gate("createUser");
    if (this.users.has(input.username)) {
      throw new PanelRejectedError(409, "User already exists");
    }
    if (this.limited && (input.dataLimitBytes === null || (!input.startsOnFirstUse && input.expiresAt === null))) {
      throw new PanelRejectedError(403, "Data limit and expiry are required for this admin");
    }
    const id = this.nextId++;
    const user: PanelUser = {
      id,
      username: input.username,
      status: input.startsOnFirstUse ? "on_hold" : "active",
      dataLimitBytes: input.dataLimitBytes,
      usedBytes: 0,
      lifetimeUsedBytes: 0,
      expiresAt: input.startsOnFirstUse ? null : input.expiresAt,
      onHoldDurationSeconds: input.startsOnFirstUse ? input.durationSeconds : null,
      deviceLimit: input.deviceLimit,
      groupIds: [...input.groupIds],
      onlineAt: null,
      subscriptionUrl: `${this.subscriptionBase}/${input.username}-${id}`,
    };
    this.users.set(input.username, user);
    return { ...user };
  }

  async getUser(username: string) {
    this.gate("getUser");
    const user = this.users.get(username);
    return user ? { ...user } : null;
  }

  async updateLimits(username: string, change: LimitsChange) {
    this.gate("updateLimits");
    const user = this.user(username);
    if (change.dataLimitBytes !== undefined) user.dataLimitBytes = change.dataLimitBytes;
    if (change.deviceLimit !== undefined) user.deviceLimit = change.deviceLimit;
    if (change.groupIds !== undefined) user.groupIds = [...change.groupIds];
    if (change.expiresAt !== undefined) user.expiresAt = change.expiresAt;
    if (change.onHoldDurationSeconds !== undefined) user.onHoldDurationSeconds = change.onHoldDurationSeconds;
    // Given an expiry, a user on hold starts; otherwise "activate" is for limited and expired ones.
    if (change.activate && (user.status !== "on_hold" || change.expiresAt)) {
      user.status = "active";
      user.onHoldDurationSeconds = null;
    }
    if (user.status === "active" && user.dataLimitBytes !== null && user.usedBytes >= user.dataLimitBytes) user.status = "limited";
    this.updates.push({ username, change });
    return { ...user };
  }

  async resetUsage(username: string) {
    this.gate("resetUsage");
    const user = this.user(username);
    user.usedBytes = 0;
    if (user.status === "limited") user.status = "active";
    return { ...user };
  }

  async revokeSubscription(username: string) {
    this.gate("revokeSubscription");
    const user = this.user(username);
    user.subscriptionUrl = `${user.subscriptionUrl}-r${Date.now()}`;
    return { ...user };
  }

  async setEnabled(username: string, enabled: boolean) {
    this.gate(enabled ? "enable" : "disable");
    const user = this.user(username);
    user.status = enabled ? "active" : "disabled";
    return { ...user };
  }

  async deleteUser(username: string) {
    this.gate("deleteUser");
    this.users.delete(username);
  }

  async listUsers({ offset, limit }: { offset: number; limit: number }) {
    this.gate("listUsers");
    const all = [...this.users.values()];
    return { users: all.slice(offset, offset + limit).map((user) => ({ ...user })), total: all.length };
  }
}
