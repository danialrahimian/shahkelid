import type { PanelGroup, TrafficReset } from "@shah-kelid/contracts";

/**
 * What the rest of the system needs from a VPN panel, in the panel's absence
 * of opinion: bytes, dates, and our own words for statuses.
 *
 * PasarGuard is the first implementation. Another panel (Marzban, 3x-ui) is
 * another class behind this interface; nothing that calls it changes.
 *
 * Users are addressed by username, which we choose and which is derived from
 * the subscription id. That makes creation safe to retry: before creating,
 * the caller asks for the username, and finds the user a lost attempt made.
 */

export type PanelUserStatus = "active" | "on_hold" | "disabled" | "limited" | "expired";

export type PanelUser = {
  id: number;
  username: string;
  status: PanelUserStatus;
  /** null: unlimited. */
  dataLimitBytes: number | null;
  usedBytes: number;
  lifetimeUsedBytes: number;
  /** null: no expiry, or on hold (the clock has not started). */
  expiresAt: Date | null;
  /** While on hold: how long the plan runs once it starts. */
  onHoldDurationSeconds: number | null;
  deviceLimit: number | null;
  groupIds: number[];
  onlineAt: Date | null;
  /** Absolute. The customer never sees it: they get our /s/{token} link. */
  subscriptionUrl: string;
};

type Limits = {
  dataLimitBytes: number | null;
  deviceLimit: number | null;
  trafficReset: TrafficReset;
  groupIds: number[];
};

export type NewPanelUser = Limits & {
  username: string;
  note?: string;
} & (
    | {
        /** The clock starts at the first connection... */
        startsOnFirstUse: true;
        durationSeconds: number;
        /** ...or at this moment, whichever comes first. */
        startsAtLatest: Date;
      }
    | { startsOnFirstUse: false; expiresAt: Date }
  );

export type LimitsChange = Partial<Limits> & {
  expiresAt?: Date | null;
  /** For a user still on hold: how long the plan runs once it starts. */
  onHoldDurationSeconds?: number;
  /** Bring a limited or expired user back to active (the new limits allow it). */
  activate?: boolean;
};

export type PanelHealth = { version: string | null };

export interface PanelDriver {
  health(): Promise<PanelHealth>;
  listGroups(): Promise<PanelGroup[]>;
  createUser(user: NewPanelUser): Promise<PanelUser>;
  /** null when there is no such user. */
  getUser(username: string): Promise<PanelUser | null>;
  updateLimits(username: string, change: LimitsChange): Promise<PanelUser>;
  resetUsage(username: string): Promise<PanelUser>;
  /** A new panel link; the old one stops working. */
  revokeSubscription(username: string): Promise<PanelUser>;
  setEnabled(username: string, enabled: boolean): Promise<PanelUser>;
  /** Succeeds when the user is already gone. */
  deleteUser(username: string): Promise<void>;
  /** One page of the users this account can see. */
  listUsers(page: { offset: number; limit: number }): Promise<{ users: PanelUser[]; total: number }>;
}

/**
 * The panel could not be reached, timed out, or failed on its side (5xx,
 * 429). Nothing is known to have happened: try again later.
 */
export class PanelUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PanelUnavailableError";
  }
}

/**
 * The panel answered and said no: wrong credentials, a missing permission,
 * or data it will not accept. Retrying the same request will not help.
 */
export class PanelRejectedError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PanelRejectedError";
    this.status = status;
  }
}
