import { z } from "zod";

import type { SubscriptionView } from "./subscriptions.ts";

/**
 * Customers as the team sees them: what they bought, where they stand, and
 * what staff know about them (notes, tags).
 *
 * The stage is worked out from what the customer has done, and a person may
 * set it by hand instead; both are shown, so the reason is never hidden.
 *
 *   lead      never paid
 *   active    has a live service
 *   at-risk   a live service ends within 7 days or has run out of volume
 *   churned   paid before, no live service now
 *   vip, blocked   only ever set by hand
 */
export const CUSTOMER_STAGES = ["lead", "active", "at-risk", "churned", "vip", "blocked"] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

export const CUSTOMER_SORTS = ["joined", "value", "recent"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export type CustomerTag = { id: string; name: string; color: string | null };

export type CustomerSummary = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  liveSubscriptions: number;
  /** What paid orders came to (renewals included, wallet top-ups not). */
  lifetimeValueToman: number;
  paidOrders: number;
  lastPaidAt: string | null;
  /** What to show: the one set by hand, if any, else the computed one. */
  stage: CustomerStage;
  computedStage: CustomerStage;
  stageOverride: CustomerStage | null;
  tags: CustomerTag[];
};

export type CustomerNoteView = { id: string; authorName: string; body: string; createdAt: string };

export type CustomerDetail = CustomerSummary & {
  subscriptions: SubscriptionView[];
  notes: CustomerNoteView[];
};

export type CustomerPage = {
  customers: CustomerSummary[];
  total: number;
  /** What the whole filtered set paid, not just this page. */
  segmentValueToman: number;
};

/** How many customers stand at each stage, and what they paid. */
export type CustomerSegments = {
  stages: { stage: CustomerStage; customers: number; valueToman: number }[];
  tags: (CustomerTag & { customers: number })[];
};

export const customerNoteInput = z.object({
  body: z.string().trim().min(1, "REQUIRED").max(2000, "TOO_LONG"),
});
export type CustomerNoteInput = z.input<typeof customerNoteInput>;

/** null clears the hand-set stage, back to the computed one. */
export const customerStageInput = z.object({
  stage: z.enum(CUSTOMER_STAGES).nullable(),
});
export type CustomerStageInput = z.input<typeof customerStageInput>;

/** The customer's whole set of tags, by name; new names become new tags. */
export const customerTagsInput = z.object({
  tags: z
    .array(z.string().trim().min(1, "REQUIRED").max(40, "TOO_LONG"))
    .max(10, "TOO_LONG")
    // One per name whatever the case; the first spelling is kept.
    .transform((names) => names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index)),
});
export type CustomerTagsInput = z.input<typeof customerTagsInput>;

/** A suspended customer cannot sign in; their services are left as they are. */
export const customerStatusInput = z.object({ status: z.enum(["active", "suspended"]) });
export type CustomerStatusInput = z.input<typeof customerStatusInput>;
