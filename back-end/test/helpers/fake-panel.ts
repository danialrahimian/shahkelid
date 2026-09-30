import {
  PanelRejectedError,
  PanelUnavailableError,
  type LimitsChange,
  type NewPanelUser,
  type PanelDriver,
  type PanelUser,
} from "../../src/modules/provisioning/driver";

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
  groups = [{ id: 1, name: "tunnel" }];
  down = false;
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
    return this.groups;
  }

  async createUser(input: NewPanelUser) {
    this.gate("createUser");
    if (this.users.has(input.username)) {
      throw new PanelRejectedError(409, "User already exists");
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
    if (change.activate && user.status !== "on_hold") user.status = "active";
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
