import { z } from "zod";

/** Subscriptions: what a customer has, as staff and the customer see it. */

export const SUBSCRIPTION_STATUSES = [
  "provisioning",
  "provisioning_failed",
  "on_hold",
  "active",
  "limited",
  "expired",
  "disabled",
  "deleted",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const createSubscriptionInput = z.object({
  userId: z.string().uuid("REQUIRED"),
  planId: z.string().uuid("REQUIRED"),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionInput>;

/** What staff can do to a subscription that is on the panel. */
export const SUBSCRIPTION_ACTIONS = [
  "sync",
  "reset_usage",
  "revoke_link",
  "disable",
  "enable",
  "retry",
  "delete",
] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

export type SubscriptionView = {
  id: string;
  userId: string;
  userEmail: string;
  plan: { id: string; name: string };
  panel: { id: string; name: string };
  server: { id: string; name: string; locationName: string } | null;
  status: SubscriptionStatus;
  dataLimitBytes: number | null;
  usedBytes: number;
  lifetimeUsedBytes: number;
  deviceLimit: number | null;
  /** Null while on hold: the clock starts at the first connection. */
  expiresAt: string | null;
  startsOnFirstUse: boolean;
  onlineAt: string | null;
  lastSyncedAt: string | null;
  /** The customer's link, on our own domain. */
  link: string;
  provisionedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type SubscriptionEventView = {
  id: number;
  kind: string;
  actorKind: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type CustomerSummary = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  liveSubscriptions: number;
};

export type CustomerDetail = CustomerSummary & {
  subscriptions: SubscriptionView[];
};
