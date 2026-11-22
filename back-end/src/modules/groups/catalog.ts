import type { PanelGroup } from "@shah-kelid/contracts";

import logger from "../../libraries/logger";
import { PanelRejectedError, type PanelDriver } from "../provisioning/driver";
import { driverFor, type PanelRow } from "../provisioning/drivers";
import { probeHosts, type ProbeHostWithLegacy } from "../subscriptions/configs";

/**
 * What a panel offers our groups.
 *
 * Its groups come from its API (a reseller account gets ids and names).
 * Its hosts do not: a reseller account may not read them. So the shop keeps
 * a panel user of its own on each panel group it uses, named
 * skprobe_g<group id>, and reads that user's subscription: what it gives is
 * what the group gives, in the panel's order and under the panel's names.
 *
 * The probe user is made unlimited and without expiry where the account
 * may (its config names then never change: nothing is used, nothing runs
 * out); where the account's limits forbid that, with the smallest volume
 * and a month, renewed when it runs out. It never connects: its link stays
 * on the shop's server. The sync leaves it alone (it is not one of ours).
 *
 * Staff screens read it fresh. The customer's link reads it at most once a
 * minute per panel group; a panel that cannot be read keeps its last answer
 * for up to an hour, so a blip does not change what customers get.
 */

const FRESH_MS = 60_000;
const STALE_MS = 60 * 60_000;
const GB = 1024 ** 3;

type Probe = { hosts: ProbeHostWithLegacy[]; readAt: number };
const cache = new Map<string, Probe>();
const keyOf = (panelId: string, panelGroupId: number) => `${panelId}:${panelGroupId}`;

export const probeUsername = (panelGroupId: number) => `skprobe_g${panelGroupId}`;

export const readGroups = (panel: PanelRow): Promise<PanelGroup[]> => driverFor(panel).listGroups();

/** The probe user of a panel group, made or put right (active, in that group only). */
const ensureProbe = async (driver: PanelDriver, panelGroupId: number) => {
  const username = probeUsername(panelGroupId);
  const note = "shah-kelid: reads the configs of this group for the shop. Do not delete.";
  const existing = await driver.getUser(username);
  if (!existing) {
    try {
      return await driver.createUser({
        username,
        groupIds: [panelGroupId],
        dataLimitBytes: null,
        deviceLimit: null,
        trafficReset: "no_reset",
        note,
        startsOnFirstUse: false,
        expiresAt: null,
      });
    } catch (error) {
      if (!(error instanceof PanelRejectedError) || error.status === 409) throw error;
      // The account's limits: the least it may make.
      return driver.createUser({
        username,
        groupIds: [panelGroupId],
        dataLimitBytes: GB,
        deviceLimit: 1,
        trafficReset: "no_reset",
        note,
        startsOnFirstUse: false,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
    }
  }
  const wrongGroups = existing.groupIds.length !== 1 || existing.groupIds[0] !== panelGroupId;
  if (existing.status === "disabled") await driver.setEnabled(username, true);
  if (wrongGroups || existing.status === "expired" || existing.status === "limited" || existing.status === "disabled") {
    return driver
      .updateLimits(username, { groupIds: [panelGroupId], expiresAt: null, dataLimitBytes: null, activate: true })
      .catch(() =>
        driver.updateLimits(username, {
          groupIds: [panelGroupId],
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
          dataLimitBytes: existing.usedBytes + GB,
          activate: true,
        }),
      );
  }
  return existing;
};

/** A panel group's hosts, read now through its probe user. */
export const readProbe = async (panel: PanelRow, panelGroupId: number): Promise<ProbeHostWithLegacy[]> => {
  const driver = driverFor(panel);
  const probe = await ensureProbe(driver, panelGroupId);
  const hosts = probeHosts(await driver.readConfigs(probe.subscriptionUrl));
  cache.set(keyOf(panel.id, panelGroupId), { hosts, readAt: Date.now() });
  return hosts;
};

/** For the customer's link: at most a minute old, or older (up to an hour) when the panel is down. */
export const cachedProbe = async (panel: PanelRow, panelGroupId: number): Promise<ProbeHostWithLegacy[] | null> => {
  const known = cache.get(keyOf(panel.id, panelGroupId));
  if (known && Date.now() - known.readAt < FRESH_MS) return known.hosts;
  try {
    return await readProbe(panel, panelGroupId);
  } catch (error) {
    logger.warn({ err: error, panelId: panel.id, panelGroupId }, "A panel group's configs could not be read");
    return known && Date.now() - known.readAt < STALE_MS ? known.hosts : null;
  }
};

/** After staff change a panel, or in tests. */
export const forgetCatalog = (panelId?: string) => {
  if (!panelId) cache.clear();
  else for (const key of [...cache.keys()]) if (key.startsWith(`${panelId}:`)) cache.delete(key);
};
