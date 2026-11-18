import type { Executor } from "../../platform/db/client";
import type { HostWanted, PanelPlan, ProbeHost } from "../subscriptions/configs";
import { cachedProbe, probeUsername } from "./catalog";
import { findGroup, groupHostsOf, groupIdsOfSubscription } from "./service";

/**
 * What a subscription's groups say about each panel's answer to its link
 * (see subscriptions/configs.ts): the hosts the panel may give (read through
 * the shop's own subscription on each panel group), the ones picked with
 * their names and places, and whether configs matching no host are kept.
 * One plan per panel, in the order given.
 *
 * null for a subscription that carries no group (made before groups): its
 * link is passed on as the panels give it.
 */
export const linkPlans = async (
  executor: Executor,
  subscriptionId: string,
  panelIds: string[],
): Promise<{ plans: PanelPlan[]; usernames: string[] } | null> => {
  const groupIds = await groupIdsOfSubscription(executor, subscriptionId);
  if (groupIds.length === 0) return null;

  // Each panel group read once, however many of the customer's groups take it.
  const probes = new Map<string, ProbeHost[] | null>();
  const read = async (panel: Parameters<typeof cachedProbe>[0], panelGroupId: number) => {
    const key = `${panel.id}:${panelGroupId}`;
    if (!probes.has(key)) probes.set(key, await cachedProbe(panel, panelGroupId));
    const hosts = probes.get(key);
    if (!hosts) throw new Error("The panel cannot be read");
    return hosts;
  };

  const wanted = new Map<string, Map<string, HostWanted>>();
  const panelGroups = new Map<string, Set<number>>();
  const everyHost = new Map<string, boolean>();
  let rank = 0;
  for (const groupId of groupIds) {
    const group = await findGroup(executor, groupId);
    for (const source of group.sources) {
      if (!panelGroups.has(source.panelId)) panelGroups.set(source.panelId, new Set());
      panelGroups.get(source.panelId)!.add(source.panelGroupId);
      everyHost.set(source.panelId, (everyHost.get(source.panelId) ?? true) && source.allHosts);
    }
    const { hosts } = await groupHostsOf(executor, groupId, read);
    for (const host of hosts.filter((candidate) => candidate.selected)) {
      if (!wanted.has(host.panelId)) wanted.set(host.panelId, new Map());
      const onPanel = wanted.get(host.panelId)!;
      // A host in two of the customer's groups is given once, where it first comes.
      if (!onPanel.has(host.hostId)) onPanel.set(host.hostId, { rank: rank++, name: host.name });
    }
  }

  const usernames = [...new Set([...panelGroups.values()].flatMap((ids) => [...ids].map(probeUsername)))];
  const plans = panelIds.map((panelId): PanelPlan => {
    // No group takes from this panel any more: it gives nothing (the sync
    // takes its groups off the panel user too).
    if (!panelGroups.has(panelId)) return { hosts: [], wanted: new Map(), keepUnknown: false };
    const read = [...panelGroups.get(panelId)!].map((panelGroupId) => probes.get(`${panelId}:${panelGroupId}`));
    if (read.some((hosts) => !hosts)) return { hosts: null, wanted: new Map(), keepUnknown: true };
    const hosts: ProbeHost[] = [];
    for (const each of read) for (const host of each!) if (!hosts.some((known) => known.id === host.id)) hosts.push(host);
    return { hosts, wanted: wanted.get(panelId) ?? new Map(), keepUnknown: everyHost.get(panelId) ?? false };
  });
  return { plans, usernames };
};
