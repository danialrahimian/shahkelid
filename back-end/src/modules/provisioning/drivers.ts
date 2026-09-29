import { panelCredentialsSchema, type PanelCredentials } from "@shah-kelid/contracts";

import { open, seal } from "../../platform/crypto/secret-box";
import type { panels } from "../infrastructure/schema";
import type { PanelDriver } from "./driver";
import { PasarGuardDriver } from "./pasarguard";

/**
 * One driver per panel row, made from its (encrypted) credentials.
 *
 * Drivers are kept between requests, so a panel account signs in once a day
 * rather than once a request. A kept driver is replaced when the panel row
 * changes (new address or credentials): the cache key is its update time.
 */

export type PanelRow = typeof panels.$inferSelect;

export const sealCredentials = (credentials: PanelCredentials): Buffer =>
  seal(JSON.stringify(credentials));

export const openCredentials = (sealed: Buffer): PanelCredentials =>
  panelCredentialsSchema.parse(JSON.parse(open(sealed)));

export type DriverFactory = (panel: PanelRow, credentials: PanelCredentials) => PanelDriver;

const realFactory: DriverFactory = (panel, credentials) => {
  switch (panel.driver) {
    case "pasarguard":
      return new PasarGuardDriver(panel.baseUrl, credentials);
    default:
      throw new Error(`There is no driver for ${panel.driver} panels yet`);
  }
};

let factory = realFactory;
const kept = new Map<string, { version: string; driver: PanelDriver }>();

export const driverFor = (panel: PanelRow): PanelDriver => {
  const version = panel.updatedAt.toISOString();
  const cached = kept.get(panel.id);
  if (cached?.version === version) return cached.driver;

  const driver = factory(panel, openCredentials(panel.credentialsEnc));
  kept.set(panel.id, { version, driver });
  return driver;
};

/** A driver that is not kept: for trying an address and credentials before saving them. */
export const trialDriver = (panel: Pick<PanelRow, "driver" | "baseUrl" | "credentialsEnc">) =>
  factory(panel as PanelRow, openCredentials(panel.credentialsEnc));

/** Test seam: panels made by the tests talk to a fake instead of the network. */
export const setDriverFactory = (replacement: DriverFactory | null) => {
  factory = replacement ?? realFactory;
  kept.clear();
};
