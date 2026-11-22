import type { Db } from "../../platform/db/client";
import { refreshSubscription } from "../subscriptions/members";
import type { SubscriptionRow } from "../subscriptions/service";

/**
 * Keeping our copy of usage and status in step with the panels.
 *
 * The whole fleet is synced every few minutes by the panel service (panel/,
 * in Go): every panel's users read in parallel, only what changed written,
 * in a few batched statements. What stays here is one subscription, read
 * now, for when a customer or staff opens it.
 */
export const syncSubscription = (db: Db, current: Pick<SubscriptionRow, "id" | "panelUsername">) => refreshSubscription(db, current);
