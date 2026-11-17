import type { Executor } from "../../platform/db/client";
import type { HostWanted, PanelPlan } from "../subscriptions/configs";
import { cachedCatalog, hostsOfGroups, protocolOf, type PanelCatalog } from "./catalog";
import { findGroup, groupHostsOf, groupIdsOfSubscription } from "./service";

/**
 * What a subscription's groups say about each panel's answer to its link
 * (see subscriptions/configs.ts): the hosts the panel may give, the ones
 * picked with their names and places, and whether configs matching no host
 * are kept. One plan per panel, in the order given.
 *
 * null for a subscription that carries no group (made before groups): its
 * link is passed on as the panels give it.
 */
export const linkPlans = async (executor: Executor, subscriptionId: string, panelIds: string[]): Promise<PanelPlan[] | null> => {
  const groupIds = await groupIdsOfSubscription(executor, subscriptionId);
  if (groupIds.length === 0) return null;

  const catalogs = new Map<string, PanelCatalog | null>();
  const read = async (panel: Parameters<typeof cachedCatalog>[0]) => {
    if (!catalogs.has(panel.id)) catalogs.set(panel.id, await cachedCatalog(panel));
    const catalog = catalogs.get(panel.id);
    if (!catalog) throw new Error("The panel cannot be read");
    return catalog;
  };

  const wanted = new Map<string, Map<number, HostWanted>>();
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

  return panelIds.map((panelId): PanelPlan => {
    // No group takes from this panel any more: it gives nothing (the sync
    // takes its groups off the panel user too).
    if (!panelGroups.has(panelId)) return { hosts: [], wanted: new Map(), keepUnknown: false };
    const catalog = catalogs.get(panelId);
    if (!catalog) return { hosts: null, wanted: new Map(), keepUnknown: true };
    return {
      hosts: hostsOfGroups(catalog, [...panelGroups.get(panelId)!])
        .filter((host) => !host.disabled)
        .map((host) => ({
          ...host,
          protocol: protocolOf(catalog, host),
          network: catalog.inbounds.find((inbound) => inbound.tag === host.inboundTag)?.network ?? null,
        })),
      wanted: wanted.get(panelId) ?? new Map(),
      keepUnknown: everyHost.get(panelId) ?? false,
    };
  });
};
