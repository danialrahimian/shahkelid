import { sql } from "drizzle-orm";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { groupIdsOfSubscription, panelsOfGroups } from "../groups/service";
import { MISSING, SYNCED, isMade, membersOf, saveMember } from "../subscriptions/members";
import { subscriptionPanels, subscriptions } from "../subscriptions/schema";
import { driverFor } from "./drivers";

/**
 * Keeping each subscription's panel users in step with its groups.
 *
 * A subscription carries the groups of the plan it was bought with. When
 * staff change a group (take another panel group into it, or drop one),
 * every subscription in it should get what the group now gives:
 *
 * - On a panel it is on: the panel user's groups are set to the ones its
 *   groups take from that panel (none, when they no longer take anything
 *   there; the user stays, so its usage still counts).
 * - On a panel it is not on yet: a row is added, and the user is made on
 *   that panel by the same path as a panel that was down at purchase.
 *
 * The panel service's sync (panel/, in Go) finds the subscriptions out of
 * step at every run; this is for one subscription now (after a renewal with
 * a plan of other groups).
 */

const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((id, i) => id === [...b].sort((x, y) => x - y)[i]);

/**
 * Sets one subscription's panel users to its groups. Returns whether a panel
 * was added (it then needs making, and the limits setting again).
 *
 * A panel that cannot be reached keeps its row's error and old groups, so
 * the next sync tries again.
 */
export const alignGroups = async (db: Db, subscriptionId: string) => {
  const groupIds = await groupIdsOfSubscription(db, subscriptionId);
  // A subscription that carries no group (made before groups, from a plan
  // with none) is left as it is rather than emptied.
  if (groupIds.length === 0) return false;
  const desired = await panelsOfGroups(db, groupIds);
  const members = await membersOf(db, subscriptionId);

  const missing = desired.filter((entry) => !members.some((member) => member.panelId === entry.panelId));
  if (missing.length > 0) {
    const [subscription] = await db
      .select({ dataLimitBytes: subscriptions.dataLimitBytes })
      .from(subscriptions)
      .where(sql`${subscriptions.id} = ${subscriptionId}`);
    await db
      .insert(subscriptionPanels)
      .values(
        missing.map((entry) => ({
          subscriptionId,
          panelId: entry.panelId,
          groupIds: entry.panelGroupIds,
          dataLimitBytes: subscription?.dataLimitBytes ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  const [subscription] = await db
    .select({ panelUsername: subscriptions.panelUsername })
    .from(subscriptions)
    .where(sql`${subscriptions.id} = ${subscriptionId}`);
  for (const member of members) {
    if (!member.panel.isActive) continue;
    const wanted = desired.find((entry) => entry.panelId === member.panelId)?.panelGroupIds ?? [];
    if (same(wanted, member.groupIds)) continue;
    // Not made yet: it is made with these groups.
    if (!isMade(member) || member.lastError === MISSING) {
      await saveMember(db, member, { groupIds: wanted });
      continue;
    }
    try {
      await driverFor(member.panel).updateLimits(subscription!.panelUsername, { groupIds: wanted });
      await saveMember(db, member, { groupIds: wanted });
    } catch (error) {
      logger.warn({ err: error, subscriptionId, panelId: member.panelId }, "A panel user's groups could not be set; the next sync tries again");
      await saveMember(db, member, { lastError: (error as Error).message.slice(0, 500) });
    }
  }
  return missing.length > 0;
};
