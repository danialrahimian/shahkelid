import { z } from "zod";

import { emailSchema, toLatinDigits } from "./auth.ts";

/**
 * The store's settings that live in the staff area rather than in the
 * server's .env: mail, Telegram, the payment accounts and backups. The
 * installer asks only for a domain and the owner; everything here is set,
 * and tested, from /staff/settings afterwards.
 *
 * Secrets (passwords, tokens, keys) are written, never read back: a view
 * says whether one is saved, and an input that leaves one empty keeps it.
 */

/** Where a section's values come from: saved in the panel, the server's .env, or nowhere yet. */
export type SettingsSource = "panel" | "env" | "none";

/** A secret field: left empty, the saved one stays. */
const keptSecret = z.string().trim().max(500, "TOO_LONG").optional().default("");

const digits = z.string().transform((value) => toLatinDigits(value).trim());

/** "Name <address>" or a bare address. */
export const mailFromSchema = z
  .string()
  .trim()
  .min(3, "REQUIRED")
  .max(254, "TOO_LONG")
  .refine((value) => {
    const address = /<([^>]+)>\s*$/.exec(value)?.[1] ?? value;
    return emailSchema.safeParse(address).success;
  }, "MAIL_FROM_INVALID");

export const mailSettingsInput = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, "HOST_INVALID"),
  port: digits.pipe(z.coerce.number().int("PORT_INVALID").min(1, "PORT_INVALID").max(65_535, "PORT_INVALID")),
  user: z.string().trim().min(1, "REQUIRED").max(254, "TOO_LONG"),
  password: keptSecret,
  from: mailFromSchema,
});
export type MailSettingsInput = z.input<typeof mailSettingsInput>;

/** Where a test code goes; empty means the signed-in staff member's own address. */
export const mailTestInput = z.object({ to: z.union([emailSchema, z.literal("")]).optional().default("") });
export type MailTestInput = z.input<typeof mailTestInput>;

export const mailVerifyInput = z.object({
  code: digits.pipe(z.string().regex(/^\d{6}$/, "CODE_INVALID")),
});
export type MailVerifyInput = z.input<typeof mailVerifyInput>;

export const TELEGRAM_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
export const telegramChatIdSchema = digits.pipe(z.string().regex(/^-?\d{1,20}$/, "CHAT_ID_INVALID"));

export const telegramSettingsInput = z.object({
  botToken: z.union([z.literal(""), z.string().trim().regex(TELEGRAM_TOKEN_PATTERN, "TELEGRAM_TOKEN_INVALID")]).default(""),
  chatIds: z.array(telegramChatIdSchema).max(20, "TOO_MANY"),
});
export type TelegramSettingsInput = z.input<typeof telegramSettingsInput>;

export const zarinpalSettingsInput = z.object({
  merchantId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "MERCHANT_ID_INVALID"),
  sandbox: z.boolean(),
});
export type ZarinpalSettingsInput = z.input<typeof zarinpalSettingsInput>;

/** A TRON address: T and 33 base58 characters. */
export const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const tronSettingsInput = z.object({
  address: z.string().trim().regex(TRON_ADDRESS_PATTERN, "TRON_ADDRESS_INVALID"),
  tronGridApiKey: keptSecret,
});
export type TronSettingsInput = z.input<typeof tronSettingsInput>;

export const nowpaymentsSettingsInput = z.object({
  apiKey: keptSecret,
  ipnSecret: keptSecret,
  sandbox: z.boolean(),
});
export type NowpaymentsSettingsInput = z.input<typeof nowpaymentsSettingsInput>;

export const BACKUP_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

export const backupSettingsInput = z.object({
  intervalHours: z.coerce
    .number()
    .refine((hours) => (BACKUP_INTERVALS as readonly number[]).includes(hours), "INTERVAL_INVALID"),
  /** null: no S3 copy. */
  s3: z
    .object({
      endpoint: z
        .string()
        .trim()
        .regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/, "URL_INVALID")
        .transform((url) => url.replace(/\/+$/, "")),
      bucket: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[A-Za-z0-9._/-]+)?$/, "BUCKET_INVALID"),
      accessKeyId: z.string().trim().min(1, "REQUIRED").max(200, "TOO_LONG"),
      secretAccessKey: keptSecret,
      region: z.string().trim().min(1, "REQUIRED").max(50, "TOO_LONG").default("auto"),
    })
    .nullable(),
  /** An encrypted file of each backup, sent by the alerts bot. */
  telegram: z.object({
    enabled: z.boolean(),
    /** Empty: the alert chats. */
    chatIds: z.array(telegramChatIdSchema).max(20, "TOO_MANY"),
  }),
});
export type BackupSettingsInput = z.input<typeof backupSettingsInput>;

/** What the last backup did, per destination, as the backup service reports it. */
export type BackupDestinationStatus = { ok: boolean; note: string | null };
export type BackupStatusView = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  ok: boolean;
  message: string | null;
  accounts: number | null;
  local: BackupDestinationStatus & { snapshots: number | null };
  s3: BackupDestinationStatus | null;
  telegram: BackupDestinationStatus | null;
  /** A backup asked for from the panel that has not started yet. */
  requested: boolean;
};

export type SettingsView = {
  mail: {
    source: SettingsSource;
    host: string;
    port: number;
    user: string;
    from: string;
    hasPassword: boolean;
    /** When a test code sent with these settings came back. */
    verifiedAt: string | null;
  };
  telegram: { source: SettingsSource; hasToken: boolean; chatIds: string[] };
  zarinpal: { source: SettingsSource; merchantId: string; sandbox: boolean };
  tron: { source: SettingsSource; address: string; hasApiKey: boolean };
  nowpayments: { source: SettingsSource; hasApiKey: boolean; hasIpnSecret: boolean; sandbox: boolean };
  backups: {
    source: SettingsSource;
    intervalHours: number;
    s3: { endpoint: string; bucket: string; accessKeyId: string; hasSecret: boolean; region: string } | null;
    telegram: { enabled: boolean; chatIds: string[] };
    /** null on a machine with no backup service (development). */
    status: BackupStatusView | null;
  };
};

export const SETTINGS_SECTIONS = ["mail", "telegram", "zarinpal", "tron", "nowpayments", "backups"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * What a test button found. A failed test is an answer, not an error: `detail`
 * is the provider's own words ("535 Authentication failed", "Unauthorized"),
 * shown to staff as they are, since that is what tells them what to fix.
 */
export type MailTestView = { sent: boolean; to: string; detail: string | null };
export type TelegramBotView = { ok: boolean; username: string | null; detail: string | null };
export type TelegramChatView = { id: string; title: string };
export type TelegramChatsView = { ok: boolean; chats: TelegramChatView[]; detail: string | null };
export type TelegramSendView = { sent: number; failed: string[]; detail: string | null };
export type S3CheckView = { reachable: boolean; detail: string };

/** Error codes for this area (URL_INVALID and CODE_INVALID are shared with others). */
export const SETTINGS_ERROR_CODES = [
  "HOST_INVALID",
  "PORT_INVALID",
  "MAIL_FROM_INVALID",
  "MAIL_NOT_CONFIGURED",
  "MAIL_FAILED",
  "TELEGRAM_TOKEN_INVALID",
  "TELEGRAM_FAILED",
  "TELEGRAM_NOT_CONFIGURED",
  "CHAT_ID_INVALID",
  "MERCHANT_ID_INVALID",
  "TRON_ADDRESS_INVALID",
  "BUCKET_INVALID",
  "INTERVAL_INVALID",
  "SECRET_REQUIRED",
  "BACKUPS_UNAVAILABLE",
  "TOO_MANY",
] as const;
