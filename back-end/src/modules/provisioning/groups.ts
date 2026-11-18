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
 * The sync looks for subscriptions out of step with one query each run, so
 * a change reaches customers within a sync interval.
 */

const same = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((id, i) => id === [...b].sort((x, y) => x - y)[i]);

/** Live subscriptions whose panel users' groups differ from what their groups give. */
export const misaligned = async (db: Db): Promise<string[]> => {
  const live = sql.join(
    SYNCED.map((status) => sql`${status}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ id: string }>(sql`
    with grouped as (
      select distinct sg.subscription_id
      from subscription_groups sg
      join subscriptions s on s.id = sg.subscription_id and s.status in (${live})
    ),
    desired as (
      select sg.subscription_id, gs.panel_id, array_agg(distinct gs.panel_group_id order by gs.panel_group_id) as ids
      from subscription_groups sg
      join grouped g on g.subscription_id = sg.subscription_id
      join group_sources gs on gs.group_id = sg.group_id
      join panels p on p.id = gs.panel_id and p.is_active
      group by sg.subscription_id, gs.panel_id
    ),
    current as (
      select m.subscription_id, m.panel_id,
        coalesce((select array_agg(x order by x) from unnest(m.group_ids) x), '{}') as ids
      from subscription_panels m
      join grouped g on g.subscription_id = m.subscription_id
      join panels p on p.id = m.panel_id and p.is_active
    )
    select distinct coalesce(d.subscription_id, c.subscription_id) as id
    from desired d
    full join current c on c.subscription_id = d.subscription_id and c.panel_id = d.panel_id
    where c.subscription_id is null or coalesce(d.ids, '{}') <> c.ids
  `);
  return rows.map((row) => row.id);
};

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
