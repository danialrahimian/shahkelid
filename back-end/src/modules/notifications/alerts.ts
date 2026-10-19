import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import config from "../../config";
import { current, isMailSetUp } from "../settings/live";
import { sendTelegramMessage } from "./telegram";
import logger from "../../libraries/logger";
import type { Db, Executor } from "../../platform/db/client";
import { recordEvent } from "../../platform/outbox/outbox";
import { roles, userRoles } from "../access/schema";
import { users } from "../identity/schema";
import { deliverEmail } from "./email";

/**
 * Alerts to the people running the store: owners and admins, by email, and
 * by Telegram when a bot is configured.
 *
 * An alert is recorded in the outbox inside the transaction that caused it,
 * so "the panel is down and a paid customer is waiting" is never lost with a
 * crash, and never sent for something that was rolled back. The worker
 * delivers it.
 */

export const ALERT_TOPIC = "admin.alert";

export type Alert = { subject: string; text: string };

export const alertStaff = (executor: Executor, alert: Alert, about?: { type: string; id: string }) =>
  recordEvent(executor, {
    topic: ALERT_TOPIC,
    aggregateType: about?.type ?? "alert",
    aggregateId: about?.id ?? randomUUID(),
    payload: alert,
  });

// ---------------------------------------------------------------- delivery

export type TelegramSender = (chatId: string, text: string) => Promise<void>;

// Through the token saved in the panel (or .env), as it is when sending.
const telegramApi: TelegramSender = async (chatId, text) => {
  await sendTelegramMessage(current("telegram").botToken, chatId, text);
};

let telegram: TelegramSender = telegramApi;

/** Test seam. */
export const setTelegramSender = (replacement: TelegramSender | null) => {
  telegram = replacement ?? telegramApi;
};

/** Everyone who should hear about trouble: active owners and admins. */
const recipients = async (db: Db) =>
  (
    await db
      .selectDistinct({ email: users.email })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(inArray(roles.key, ["owner", "admin"]), eq(users.status, "active"), isNull(users.deletedAt)))
  )
    // An owner with only a username has no mailbox yet; Telegram still reaches them.
    .flatMap((row) => (row.email ? [row.email] : []));

/**
 * Sends one alert. Telegram and email are tried separately, so Telegram
 * being unreachable (it is filtered in Iran) does not stop the emails, and
 * the reverse. Only when every channel fails is the job failed, to be retried.
 */
export const deliverAlert = async (db: Db, alert: Alert) => {
  const failures: unknown[] = [];
  let delivered = 0;

  // No mail service yet (a fresh install): Telegram is the only channel.
  const emails = isMailSetUp() || !config.isProduction ? await recipients(db) : [];
  for (const email of emails) {
    try {
      await deliverEmail({ to: email, subject: `[شاه‌کلید] ${alert.subject}`, text: alert.text });
      delivered += 1;
    } catch (error) {
      failures.push(error);
    }
  }

  const { botToken, chatIds } = current("telegram");
  if (botToken) {
    for (const chatId of chatIds) {
      try {
        await telegram(chatId, `⚠️ ${alert.subject}\n\n${alert.text}`);
        delivered += 1;
      } catch (error) {
        failures.push(error);
      }
    }
  }

  if (delivered === 0 && failures.length > 0) {
    throw new AggregateError(failures, "No channel delivered the alert");
  }
  if (failures.length > 0) {
    logger.warn({ errors: failures.map((error) => (error as Error).message) }, "Some alert channels failed");
  }
  return { delivered };
};
