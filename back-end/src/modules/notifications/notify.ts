import { randomUUID } from "node:crypto";

import { bytesToGigabytes, type NotificationTemplateKey } from "@shah-kelid/contracts";
import { and, eq, inArray } from "drizzle-orm";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { recordEvent } from "../../platform/outbox/outbox";
import { users } from "../identity/schema";
import { deliverEmail } from "./email";
import { notifications } from "./schema";
import { asHtml, render, templateFor } from "./templates";

/**
 * Telling a customer something by email.
 *
 * `notifyCustomer` is called inside the transaction of whatever happened (a
 * payment settled, a service made): the message is recorded as queued and an
 * outbox event asks the worker to send it, so it goes out exactly when the
 * change sticks. The worker renders the template in force at sending time
 * and records the outcome on the row, which staff see on the customer's page.
 */

export const NOTIFY_TOPIC = "customer.notify";

// ------------------------------------------------------------- formatting

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

export const format = {
  gb: (bytes: number | null) => (bytes === null ? "نامحدود" : `${fa(bytesToGigabytes(bytes))} گیگ`),
  toman: (amount: number) => `${fa(amount)} تومان`,
  days: (days: number) => `${fa(days)} روز`,
  date: (date: Date) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(date),
  number: fa,
};

/** Links into the site, for templates. */
export const siteUrl = {
  account: () => `${config.cors.origin}/account`,
  order: (orderId: string) => `${config.cors.origin}/orders/${orderId}`,
  renew: (subscriptionId: string) => `${config.cors.origin}/renew/${subscriptionId}`,
};

// ---------------------------------------------------------------- queueing

export const notifyCustomer = async (
  executor: Executor,
  userId: string,
  key: NotificationTemplateKey,
  values: Record<string, string>,
) => {
  const [user] = await executor
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const [row] = await executor
    .insert(notifications)
    .values({
      userId,
      channel: "email",
      templateKey: key,
      recipient: user.email,
      payload: { name: user.displayName || "کاربر گرامی", ...values },
    })
    .returning({ id: notifications.id });
  await recordEvent(executor, {
    topic: NOTIFY_TOPIC,
    aggregateType: "notification",
    aggregateId: randomUUID(),
    payload: { notificationId: row!.id },
  });
  return row!.id;
};

// ---------------------------------------------------------------- delivery

/**
 * Sends one queued message. Safe to run again: a message already sent (or
 * skipped) is left alone; a failed one is tried again.
 */
export const deliverNotification = async (db: Db, notificationId: number) => {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), inArray(notifications.status, ["queued", "failed"])));
  if (!row) return "not_waiting" as const;

  const [user] = row.userId
    ? await db.select({ status: users.status }).from(users).where(eq(users.id, row.userId))
    : [];
  const template = await templateFor(db, row.templateKey as NotificationTemplateKey);
  if (!template.isActive || user?.status !== "active") {
    await db
      .update(notifications)
      .set({ status: "skipped", error: !template.isActive ? "template switched off" : "account not active" })
      .where(eq(notifications.id, row.id));
    return "skipped" as const;
  }

  const values = row.payload as Record<string, string>;
  const body = render(template.body, values);
  try {
    await deliverEmail({ to: row.recipient, subject: render(template.subject, values), text: body, html: asHtml(body) });
  } catch (error) {
    await db
      .update(notifications)
      .set({ status: "failed", error: (error as Error).message.slice(0, 300) })
      .where(eq(notifications.id, row.id));
    throw error; // the queue tries again
  }
  await db
    .update(notifications)
    .set({ status: "sent", sentAt: new Date(), error: null })
    .where(eq(notifications.id, row.id));
  return "sent" as const;
};
