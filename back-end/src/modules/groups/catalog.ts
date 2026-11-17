import type { PanelGroup } from "@shah-kelid/contracts";

import type { PanelHost, PanelInbound } from "../provisioning/driver";
import { driverFor, type PanelRow } from "../provisioning/drivers";

/**
 * What a panel offers our groups: its groups (with their inbounds), its
 * hosts in its own order, and its inbounds' protocols.
 *
 * Staff screens read it fresh. The customer's link reads it at most once a
 * minute per panel: apps refresh often, and the panel's hosts rarely change.
 * A panel that cannot be read keeps its last answer for up to an hour, so a
 * blip does not change what customers get.
 */

export type PanelCatalog = {
  groups: PanelGroup[];
  hosts: PanelHost[];
  inbounds: PanelInbound[];
  readAt: number;
};

const FRESH_MS = 60_000;
const STALE_MS = 60 * 60_000;
const cache = new Map<string, PanelCatalog>();

export const readCatalog = async (panel: PanelRow): Promise<PanelCatalog> => {
  const driver = driverFor(panel);
  const [groups, hosts, inbounds] = await Promise.all([driver.listGroups(), driver.listHosts(), driver.listInbounds()]);
  const catalog = { groups, hosts, inbounds, readAt: Date.now() };
  cache.set(panel.id, catalog);
  return catalog;
};

/** For the customer's link: at most a minute old, or older (up to an hour) when the panel is down. */
export const cachedCatalog = async (panel: PanelRow): Promise<PanelCatalog | null> => {
  const known = cache.get(panel.id);
  if (known && Date.now() - known.readAt < FRESH_MS) return known;
  try {
    return await readCatalog(panel);
  } catch {
    return known && Date.now() - known.readAt < STALE_MS ? known : null;
  }
};

/** After staff change a panel, or in tests. */
export const forgetCatalog = (panelId?: string) => {
  if (panelId) cache.delete(panelId);
  else cache.clear();
};

/** The hosts a set of the panel's groups give, in the panel's order. */
export const hostsOfGroups = (catalog: PanelCatalog, panelGroupIds: number[]) => {
  const tags = new Set(
    catalog.groups.filter((group) => panelGroupIds.includes(group.id)).flatMap((group) => group.inboundTags),
  );
  return catalog.hosts.filter((host) => host.inboundTag !== null && tags.has(host.inboundTag));
};

export const protocolOf = (catalog: PanelCatalog, host: PanelHost) =>
  catalog.inbounds.find((inbound) => inbound.tag === host.inboundTag)?.protocol ?? null;
