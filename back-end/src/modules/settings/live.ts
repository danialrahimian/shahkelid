import { eq, like } from "drizzle-orm";

import type { SettingsSection, SettingsSource } from "@shah-kelid/contracts";

import config from "../../config";
import logger from "../../libraries/logger";
import { open, seal } from "../../platform/crypto/secret-box";
import type { Db, Executor } from "../../platform/db/client";
import { siteSettings } from "../../platform/db/platform-schema";

/**
 * The settings staff set in the panel (mail, Telegram, payment accounts,
 * backups), as every part of the app reads them.
 *
 * Each process holds them in memory and reads them back from the database
 * every few seconds, so code that needs one asks synchronously, and a change
 * saved by the API reaches the worker within seconds without a restart.
 *
 * What the panel saved wins. A section never saved there falls back to the
 * server's .env (how it was set before M11), and failing that to "not set
 * up", which hides or refuses what depends on it.
 *
 * Each section is stored as one sealed value (AES-256-GCM with the app key):
 * the database holds no readable password, token or key.
 */

export type MailSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** When a test code sent with these settings came back. */
  verifiedAt: string | null;
};
export type TelegramSettings = { botToken: string; chatIds: string[] };
export type ZarinpalSettings = { merchantId: string; sandbox: boolean };
export type TronSettings = { address: string; tronGridApiKey: string };
export type NowpaymentsSettings = { apiKey: string; ipnSecret: string; sandbox: boolean };
export type BackupSettings = {
  intervalHours: number;
  s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } | null;
  telegram: { enabled: boolean; chatIds: string[] };
};

type Sections = {
  mail: MailSettings;
  telegram: TelegramSettings;
  zarinpal: ZarinpalSettings;
  tron: TronSettings;
  nowpayments: NowpaymentsSettings;
  backups: BackupSettings;
};

const KEY_PREFIX = "settings.";
const keyOf = (section: SettingsSection) => `${KEY_PREFIX}${section}`;

let saved: Partial<Sections> = {};

// --------------------------------------------------------------- fallbacks

const fromEnv = {
  mail: (): MailSettings | null =>
    config.mail.user
      ? {
          host: config.mail.host,
          port: config.mail.port,
          user: config.mail.user,
          password: config.mail.password ?? "",
          from: config.mail.from,
          verifiedAt: null,
        }
      : null,
  telegram: (): TelegramSettings | null =>
    config.alerts.telegramBotToken
      ? { botToken: config.alerts.telegramBotToken, chatIds: config.alerts.telegramChatIds }
      : null,
  zarinpal: (): ZarinpalSettings | null =>
    config.checkout.zarinpalMerchantId
      ? { merchantId: config.checkout.zarinpalMerchantId, sandbox: config.checkout.zarinpalSandbox }
      : null,
  tron: (): TronSettings | null =>
    config.crypto.tronAddress
      ? { address: config.crypto.tronAddress, tronGridApiKey: config.crypto.tronGridApiKey }
      : null,
  nowpayments: (): NowpaymentsSettings | null =>
    config.crypto.nowpaymentsApiKey
      ? {
          apiKey: config.crypto.nowpaymentsApiKey,
          ipnSecret: config.crypto.nowpaymentsIpnSecret,
          sandbox: config.crypto.nowpaymentsSandbox,
        }
      : null,
  backups: (): BackupSettings | null => null,
} satisfies { [S in SettingsSection]: () => Sections[S] | null };

const NOT_SET_UP: Sections = {
  mail: { host: "", port: 587, user: "", password: "", from: "", verifiedAt: null },
  telegram: { botToken: "", chatIds: [] },
  zarinpal: { merchantId: "", sandbox: false },
  tron: { address: "", tronGridApiKey: "" },
  nowpayments: { apiKey: "", ipnSecret: "", sandbox: false },
  backups: { intervalHours: 6, s3: null, telegram: { enabled: false, chatIds: [] } },
};

// ------------------------------------------------------------------ reading

/** A section as the app should use it now. */
export const current = <S extends SettingsSection>(section: S): Sections[S] =>
  (saved[section] as Sections[S] | undefined) ?? (fromEnv[section]() as Sections[S] | null) ?? NOT_SET_UP[section];

export const sourceOf = (section: SettingsSection): SettingsSource =>
  saved[section] ? "panel" : fromEnv[section]() ? "env" : "none";

/** Mail can be sent: a server and a user (a password may be legitimately empty for a relay). */
export const isMailSetUp = () => Boolean(current("mail").host && current("mail").user);

// --------------------------------------------------------- loading, saving

const decode = (value: unknown): unknown => {
  const sealed = (value as { sealed?: string } | null)?.sealed;
  if (!sealed) return null;
  return JSON.parse(open(Buffer.from(sealed, "base64")));
};

/** Reads every saved section from the database. A section that cannot be opened is skipped, and said so. */
export const loadSettings = async (db: Executor) => {
  const rows = await db.select().from(siteSettings).where(like(siteSettings.key, `${KEY_PREFIX}%`));
  const next: Partial<Sections> = {};
  for (const row of rows) {
    const section = row.key.slice(KEY_PREFIX.length) as SettingsSection;
    try {
      const value = decode(row.value);
      if (value) (next as Record<string, unknown>)[section] = value;
    } catch (error) {
      // Sealed with another key (a restore without its key): the section is
      // treated as never saved rather than taking the process down.
      logger.error({ err: error, section }, "A saved settings section could not be opened");
    }
  }
  saved = next;
};

let timer: NodeJS.Timeout | undefined;

/** Loads now, then again every few seconds, so a change made elsewhere arrives. */
export const startSettingsRefresh = async (db: Db, everyMs = 10_000) => {
  await loadSettings(db);
  timer ??= setInterval(() => {
    loadSettings(db).catch((error) => logger.warn({ err: error }, "Reloading the settings failed"));
  }, everyMs);
  timer.unref();
};

export const stopSettingsRefresh = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
};

/** Saves a whole section; this process sees it at once, the others within seconds. */
export const saveSection = async <S extends SettingsSection>(
  db: Executor,
  section: S,
  value: Sections[S],
  updatedBy: string | null,
) => {
  const stored = { sealed: seal(JSON.stringify(value)).toString("base64") };
  await db
    .insert(siteSettings)
    .values({ key: keyOf(section), value: stored, updatedBy })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: stored, updatedBy, updatedAt: new Date() } });
  saved = { ...saved, [section]: value };
};

/** Forgets what the panel saved for a section: it goes back to .env, or to not set up. */
export const clearSection = async (db: Executor, section: SettingsSection) => {
  await db.delete(siteSettings).where(eq(siteSettings.key, keyOf(section)));
  const { [section]: _gone, ...rest } = saved;
  saved = rest;
};

/** Test seam: forget everything loaded, as a fresh process would. */
export const resetLiveSettings = () => {
  saved = {};
};
