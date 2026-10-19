import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import type {
  backupSettingsInput,
  mailSettingsInput,
  MailTestView,
  nowpaymentsSettingsInput,
  S3CheckView,
  SettingsSection,
  SettingsView,
  telegramSettingsInput,
  TelegramBotView,
  TelegramChatsView,
  TelegramSendView,
  tronSettingsInput,
  zarinpalSettingsInput,
} from "@shah-kelid/contracts";
import type { Redis } from "ioredis";
import type { z } from "zod";

import { sendEmail as sendWithSmtp } from "../../libraries/mailer";
import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { writeAudit } from "../access/audit";
import { botUsername, recentChats, sendTelegramMessage } from "../notifications/telegram";
import { backupStatus } from "./backup-control";
import { clearSection, current, saveSection, sourceOf, type MailSettings } from "./live";

/**
 * The staff area's settings page: what is set up, saving a section, and
 * the buttons that try a setting for real (a mail with a code, a Telegram
 * message, reaching the backup bucket).
 *
 * Secrets are written and never read back. Saving with a secret left empty
 * keeps the one saved; the view says only whether there is one.
 */

// --------------------------------------------------------------------- view

export const settingsView = async (): Promise<SettingsView> => {
  const mail = current("mail");
  const telegram = current("telegram");
  const zarinpal = current("zarinpal");
  const tron = current("tron");
  const nowpayments = current("nowpayments");
  const backups = current("backups");
  return {
    mail: {
      source: sourceOf("mail"),
      host: mail.host,
      port: mail.port,
      user: mail.user,
      from: mail.from,
      hasPassword: Boolean(mail.password),
      verifiedAt: mail.verifiedAt,
    },
    telegram: { source: sourceOf("telegram"), hasToken: Boolean(telegram.botToken), chatIds: telegram.chatIds },
    zarinpal: { source: sourceOf("zarinpal"), merchantId: zarinpal.merchantId, sandbox: zarinpal.sandbox },
    tron: { source: sourceOf("tron"), address: tron.address, hasApiKey: Boolean(tron.tronGridApiKey) },
    nowpayments: {
      source: sourceOf("nowpayments"),
      hasApiKey: Boolean(nowpayments.apiKey),
      hasIpnSecret: Boolean(nowpayments.ipnSecret),
      sandbox: nowpayments.sandbox,
    },
    backups: {
      source: sourceOf("backups"),
      intervalHours: backups.intervalHours,
      s3: backups.s3
        ? {
            endpoint: backups.s3.endpoint,
            bucket: backups.s3.bucket,
            accessKeyId: backups.s3.accessKeyId,
            hasSecret: Boolean(backups.s3.secretAccessKey),
            region: backups.s3.region,
          }
        : null,
      telegram: backups.telegram,
      status: await backupStatus(),
    },
  };
};

// ------------------------------------------------------------------- saving

/** The new secret, or the saved one when the field was left empty; required means one of them must exist. */
const keep = (given: string, saved: string, field: string, required = true) => {
  const value = given || saved;
  if (required && !value) {
    throw new ApiError(400, "SECRET_REQUIRED", `${field} is required`, { fields: [{ path: field, code: "SECRET_REQUIRED" }] });
  }
  return value;
};

/** Saved, with a line in the activity log naming the section and every non-secret value. */
const save = async <S extends SettingsSection>(
  db: Db,
  actor: StaffActor,
  section: S,
  value: Parameters<typeof saveSection<S>>[2],
  shown: Record<string, unknown>,
) => {
  await db.transaction(async (tx) => {
    await saveSection(tx, section, value, actor.userId);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "settings.updated",
      entityType: "settings",
      after: { section, ...shown },
    });
  });
};

export const saveMail = async (db: Db, actor: StaffActor, input: z.output<typeof mailSettingsInput>) => {
  const before = current("mail");
  const password = keep(input.password, before.password, "password", false);
  const next: MailSettings = { host: input.host, port: input.port, user: input.user, password, from: input.from, verifiedAt: null };
  // Unchanged settings keep their confirmation; any change needs a new test.
  const same =
    before.host === next.host &&
    before.port === next.port &&
    before.user === next.user &&
    before.password === next.password &&
    before.from === next.from;
  next.verifiedAt = same ? before.verifiedAt : null;
  await save(db, actor, "mail", next, { host: next.host, port: next.port, user: next.user, from: next.from });
};

export const saveTelegram = async (db: Db, actor: StaffActor, input: z.output<typeof telegramSettingsInput>) => {
  const botToken = keep(input.botToken, current("telegram").botToken, "botToken");
  await save(db, actor, "telegram", { botToken, chatIds: input.chatIds }, { chatIds: input.chatIds });
};

export const saveZarinpal = async (db: Db, actor: StaffActor, input: z.output<typeof zarinpalSettingsInput>) => {
  await save(db, actor, "zarinpal", input, input);
};

export const saveTron = async (db: Db, actor: StaffActor, input: z.output<typeof tronSettingsInput>) => {
  const tronGridApiKey = keep(input.tronGridApiKey, current("tron").tronGridApiKey, "tronGridApiKey", false);
  await save(db, actor, "tron", { address: input.address, tronGridApiKey }, { address: input.address });
};

export const saveNowpayments = async (db: Db, actor: StaffActor, input: z.output<typeof nowpaymentsSettingsInput>) => {
  const before = current("nowpayments");
  const apiKey = keep(input.apiKey, before.apiKey, "apiKey");
  const ipnSecret = keep(input.ipnSecret, before.ipnSecret, "ipnSecret");
  await save(db, actor, "nowpayments", { apiKey, ipnSecret, sandbox: input.sandbox }, { sandbox: input.sandbox });
};

export const saveBackups = async (db: Db, actor: StaffActor, input: z.output<typeof backupSettingsInput>) => {
  const before = current("backups");
  const s3 = input.s3
    ? {
        ...input.s3,
        secretAccessKey: keep(input.s3.secretAccessKey, before.s3?.secretAccessKey ?? "", "s3.secretAccessKey"),
      }
    : null;
  await save(
    db,
    actor,
    "backups",
    { intervalHours: input.intervalHours, s3, telegram: input.telegram },
    {
      intervalHours: input.intervalHours,
      s3: s3 ? { endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: s3.accessKeyId, region: s3.region } : null,
      telegram: input.telegram,
    },
  );
};

/** Forgets a section saved in the panel: back to .env, or to not set up. */
export const resetSection = async (db: Db, actor: StaffActor, section: SettingsSection) => {
  await db.transaction(async (tx) => {
    await clearSection(tx, section);
    await writeAudit(tx, { ...auditBy(actor), action: "settings.reset", entityType: "settings", after: { section } });
  });
};

// ---------------------------------------------------------------- mail test

const TEST_TTL_SECONDS = 15 * 60;
const testKey = (userId: string) => `settings:mail-test:${userId}`;
const hashOf = (code: string) => createHash("sha256").update(code).digest();

/**
 * Sends a six-digit code with the saved mail settings, straight through
 * SMTP (not the queue), so the answer is the provider's own. Staff type the
 * code back to prove the mail arrives, not only that it was accepted.
 */
export const sendMailTest = async (
  redis: Redis,
  actor: StaffActor,
  ownAddress: string | null,
  to: string,
): Promise<MailTestView> => {
  const recipient = to || ownAddress;
  if (!recipient) {
    throw new ApiError(400, "REQUIRED", "An address to send the test to", { fields: [{ path: "to", code: "REQUIRED" }] });
  }
  const mail = current("mail");
  if (!mail.host || !mail.user) throw new ApiError(409, "MAIL_NOT_CONFIGURED", "Save the mail settings first");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const result = await sendWithSmtp({
    to: recipient,
    subject: `کد آزمایشی ایمیل شاه‌کلید: ${code}`,
    text: [
      `کد آزمایشی: ${code}`,
      "این ایمیل از بخش تنظیمات شاه‌کلید فرستاده شد تا معلوم شود ایمیل‌های سایت می‌رسند.",
      "اگر در پوشه‌ی Spam بود، رکوردهای SPF و DKIM دامنه‌ی فرستنده را در سرویس ایمیل درست کنید.",
    ].join("\n\n"),
    html: undefined,
  });
  if (!result.delivered) return { sent: false, to: recipient, detail: result.error ?? null };
  await redis.set(testKey(actor.userId), hashOf(code).toString("hex"), "EX", TEST_TTL_SECONDS);
  return { sent: true, to: recipient, detail: null };
};

/** The code from the test mail: right, and the mail settings are marked as working. */
export const verifyMailTest = async (db: Db, redis: Redis, actor: StaffActor, code: string) => {
  const stored = await redis.get(testKey(actor.userId));
  const given = hashOf(code);
  if (!stored || !timingSafeEqual(Buffer.from(stored, "hex"), given)) {
    throw new ApiError(400, "CODE_WRONG", "Not the code that was sent", { fields: [{ path: "code", code: "CODE_WRONG" }] });
  }
  await redis.del(testKey(actor.userId));
  const mail = current("mail");
  await save(db, actor, "mail", { ...mail, verifiedAt: new Date().toISOString() }, { verified: true });
};

// ---------------------------------------------------------- telegram tests

const telegramToken = () => {
  const { botToken } = current("telegram");
  if (!botToken) throw new ApiError(409, "TELEGRAM_NOT_CONFIGURED", "Save the bot token first");
  return botToken;
};

const detailOf = (error: unknown) => (error instanceof Error ? error.message : JSON.stringify(error));

export const testTelegramBot = async (): Promise<TelegramBotView> => {
  try {
    return { ok: true, username: await botUsername(telegramToken()), detail: null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return { ok: false, username: null, detail: detailOf(error) };
  }
};

export const findTelegramChats = async (): Promise<TelegramChatsView> => {
  try {
    return { ok: true, chats: await recentChats(telegramToken()), detail: null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return { ok: false, chats: [], detail: detailOf(error) };
  }
};

export const sendTelegramTest = async (): Promise<TelegramSendView> => {
  const token = telegramToken();
  const failed: string[] = [];
  let detail: string | null = null;
  for (const chatId of current("telegram").chatIds) {
    try {
      await sendTelegramMessage(token, chatId, "✅ هشدارهای شاه‌کلید به این گفتگو می‌آیند.");
    } catch (error) {
      failed.push(chatId);
      detail = detailOf(error);
    }
  }
  return { sent: current("telegram").chatIds.length - failed.length, failed, detail };
};

// -------------------------------------------------------------- backup test

/**
 * Whether the bucket's address answers at all: any HTTP answer counts, even
 * "access denied", since the keys are only tried by a real backup.
 */
export const checkS3 = async (endpoint: string, bucket: string): Promise<S3CheckView> => {
  try {
    const response = await fetch(`${endpoint}/${bucket}`, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return { reachable: true, detail: `HTTP ${response.status}` };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { reachable: false, detail: cause?.code ?? cause?.message ?? (error as Error).message };
  }
};
