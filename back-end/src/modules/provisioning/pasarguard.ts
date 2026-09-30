import type { PanelCredentials, PanelGroup, TrafficReset } from "@shah-kelid/contracts";

import {
  PanelRejectedError,
  PanelUnavailableError,
  type LimitsChange,
  type NewPanelUser,
  type PanelDriver,
  type PanelHealth,
  type PanelUser,
  type PanelUserStatus,
} from "./driver";

/**
 * PasarGuard (https://github.com/PasarGuard/panel), checked against v5.4.1.
 *
 * Signing in: an API key goes in the X-Api-Key header. With a panel account
 * instead, a token from POST /api/admin/token is kept and reused, and fetched
 * again once when the panel says it has expired (tokens last a day).
 *
 * Every request has a timeout. Without one, a panel that accepts the
 * connection and then says nothing would hold a worker forever.
 */

const TIMEOUT_MS = 10_000;

/** PasarGuard's user, as it arrives (only the fields we read). */
type RawUser = {
  id: number;
  username: string;
  status: PanelUserStatus;
  data_limit: number | null;
  used_traffic: number;
  lifetime_used_traffic?: number;
  expire: string | number | null;
  on_hold_expire_duration: number | null;
  hwid_limit: number | null;
  group_ids: number[] | null;
  online_at: string | null;
  subscription_url: string;
};

const RESET_STRATEGY: Record<TrafficReset, string> = {
  no_reset: "no_reset",
  daily: "day",
  weekly: "week",
  monthly: "month",
};

/** PasarGuard sends datetimes without a zone; they are UTC. */
const utcDate = (value: string | number | null): Date | null => {
  if (value === null || value === 0 || value === "") return null;
  if (typeof value === "number") return new Date(value * 1000);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
};

export type FetchLike = typeof fetch;

export class PasarGuardDriver implements PanelDriver {
  /** Shared, so requests made at the same moment wait for one sign-in. */
  private token: Promise<string> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: PanelCredentials,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  // ------------------------------------------------------------- transport

  private async send(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("accept", "application/json");
    if (json !== undefined) headers.set("content-type", "application/json");

    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...rest,
        headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      throw new PanelUnavailableError(`Could not reach the panel: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  private async signIn(): Promise<string> {
    if (this.credentials.kind !== "password") throw new Error("No account to sign in with");
    const form = new URLSearchParams({
      username: this.credentials.username,
      password: this.credentials.password,
    });
    const response = await this.send("/api/admin/token", {
      method: "POST",
      body: form,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const body = await this.read<{ access_token: string }>(response, "sign in");
    return body.access_token;
  }

  private async authorized(path: string, init: RequestInit & { json?: unknown } = {}) {
    const attempt = async (): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (this.credentials.kind === "api_key") {
        headers.set("x-api-key", this.credentials.apiKey);
      } else {
        this.token ??= this.signIn().catch((error: unknown) => {
          this.token = undefined; // the next request tries again
          throw error;
        });
        headers.set("authorization", `Bearer ${await this.token}`);
      }
      return this.send(path, { ...init, headers });
    };

    const response = await attempt();
    // An expired token: sign in again, once.
    if (response.status === 401 && this.credentials.kind === "password") {
      this.token = undefined;
      return attempt();
    }
    return response;
  }

  /** The body of a successful answer, or the right error for a failed one. */
  private async read<T>(response: Response, what: string): Promise<T> {
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    const detail = await response.text().catch(() => "");
    const summary = `${what}: HTTP ${response.status} ${detail.slice(0, 300)}`.trim();
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new PanelUnavailableError(summary);
    }
    throw new PanelRejectedError(response.status, summary);
  }

  private userPath(username: string, suffix = "") {
    return `/api/user/by-username/${encodeURIComponent(username)}${suffix}`;
  }

  private toUser(raw: RawUser): PanelUser {
    return {
      id: raw.id,
      username: raw.username,
      status: raw.status,
      dataLimitBytes: raw.data_limit ? raw.data_limit : null,
      usedBytes: raw.used_traffic ?? 0,
      lifetimeUsedBytes: raw.lifetime_used_traffic ?? raw.used_traffic ?? 0,
      expiresAt: utcDate(raw.expire),
      onHoldDurationSeconds: raw.on_hold_expire_duration ?? null,
      deviceLimit: raw.hwid_limit ? raw.hwid_limit : null,
      groupIds: raw.group_ids ?? [],
      onlineAt: utcDate(raw.online_at),
      // Relative when the panel has no subscription domain set.
      subscriptionUrl: new URL(raw.subscription_url, `${this.baseUrl}/`).toString(),
    };
  }

  // ------------------------------------------------------------ operations

  async health(): Promise<PanelHealth> {
    const response = await this.authorized("/api/system");
    const body = await this.read<{ version?: string }>(response, "read the panel's status");
    return { version: body.version ?? null };
  }

  async listGroups(): Promise<PanelGroup[]> {
    const response = await this.authorized("/api/groups/simple");
    const body = await this.read<{ groups: PanelGroup[] }>(response, "list groups");
    return body.groups.map(({ id, name }) => ({ id, name }));
  }

  async createUser(user: NewPanelUser): Promise<PanelUser> {
    const timing = user.startsOnFirstUse
      ? {
          status: "on_hold",
          on_hold_expire_duration: user.durationSeconds,
          on_hold_timeout: user.startsAtLatest.toISOString(),
          expire: null,
        }
      : { status: "active", expire: user.expiresAt.toISOString() };

    const response = await this.authorized("/api/user", {
      method: "POST",
      json: {
        username: user.username,
        ...timing,
        // 0 is PasarGuard's "unlimited".
        data_limit: user.dataLimitBytes ?? 0,
        data_limit_reset_strategy: RESET_STRATEGY[user.trafficReset],
        hwid_limit: user.deviceLimit ?? null,
        group_ids: user.groupIds,
        note: user.note ?? null,
      },
    });
    return this.toUser(await this.read<RawUser>(response, "create the user"));
  }

  async getUser(username: string): Promise<PanelUser | null> {
    const response = await this.authorized(this.userPath(username));
    if (response.status === 404) return null;
    return this.toUser(await this.read<RawUser>(response, "read the user"));
  }

  async updateLimits(username: string, change: LimitsChange): Promise<PanelUser> {
    const body: Record<string, unknown> = {};
    if (change.dataLimitBytes !== undefined) body.data_limit = change.dataLimitBytes ?? 0;
    if (change.deviceLimit !== undefined) body.hwid_limit = change.deviceLimit;
    if (change.trafficReset !== undefined) {
      body.data_limit_reset_strategy = RESET_STRATEGY[change.trafficReset];
    }
    if (change.groupIds !== undefined) body.group_ids = change.groupIds;
    if (change.expiresAt !== undefined) body.expire = change.expiresAt?.toISOString() ?? 0;
    if (change.onHoldDurationSeconds !== undefined) body.on_hold_expire_duration = change.onHoldDurationSeconds;
    if (change.activate) body.status = "active";

    const response = await this.authorized(this.userPath(username), { method: "PUT", json: body });
    return this.toUser(await this.read<RawUser>(response, "change the user"));
  }

  async resetUsage(username: string): Promise<PanelUser> {
    const response = await this.authorized(this.userPath(username, "/reset"), { method: "POST" });
    return this.toUser(await this.read<RawUser>(response, "reset the usage"));
  }

  async revokeSubscription(username: string): Promise<PanelUser> {
    const response = await this.authorized(this.userPath(username, "/revoke_sub"), {
      method: "POST",
    });
    return this.toUser(await this.read<RawUser>(response, "revoke the link"));
  }

  async setEnabled(username: string, enabled: boolean): Promise<PanelUser> {
    const response = await this.authorized(this.userPath(username, "/disabled"), {
      method: "PUT",
      json: { disabled: !enabled },
    });
    return this.toUser(await this.read<RawUser>(response, enabled ? "enable" : "disable"));
  }

  async deleteUser(username: string): Promise<void> {
    const response = await this.authorized(this.userPath(username), { method: "DELETE" });
    if (response.status === 404) return;
    await this.read<void>(response, "delete the user");
  }

  async listUsers({ offset, limit }: { offset: number; limit: number }) {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    const response = await this.authorized(`/api/users?${query}`);
    const body = await this.read<{ users: RawUser[]; total: number }>(response, "list users");
    return { users: body.users.map((raw) => this.toUser(raw)), total: body.total };
  }
}
