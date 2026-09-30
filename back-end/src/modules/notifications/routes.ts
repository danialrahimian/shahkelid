import {
  NOTIFICATION_TEMPLATE_KEYS,
  notificationTemplateInput,
  type NotificationLogView,
  type NotificationTemplateKey,
  type NotificationTemplateView,
} from "@shah-kelid/contracts";
import { and, desc, eq } from "drizzle-orm";
import { Router, type Request } from "express";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { auditBy, staffActor } from "../../platform/http/actor";
import { ApiError } from "../../platform/http/api-error";
import { parseBody, parseId } from "../../platform/http/validate";
import { writeAudit } from "../access/audit";
import { notifications, notificationTemplates } from "./schema";
import { DEFAULT_TEMPLATES, render, templateFor, unknownVariables } from "./templates";

/**
 * /api/v1/staff: the emails customers get.
 *
 *   GET    /notification-templates               settings:manage
 *   PUT    /notification-templates/:key          settings:manage { subject, body, isActive }
 *   DELETE /notification-templates/:key          settings:manage — back to the built-in text
 *   POST   /notification-templates/:key/preview  settings:manage — rendered with sample values
 *   GET    /customers/:id/notifications          customers:read — what was sent, or not and why
 */

/** Plausible values, so a preview reads like a real email. */
const SAMPLE: Record<string, string> = {
  name: "علی",
  plan_name: "ماهانه ۵۰ گیگ",
  volume: "۵۰ گیگ",
  days: "۳۰ روز",
  link: "https://example.com/s/Xk2p9Qw7",
  account_url: "https://example.com/account",
  expires_on: "۱۵ مهر ۱۴۰۵",
  days_left: "۳ روز",
  remaining: "۱۲ گیگ",
  used: "۴۰ گیگ",
  total: "۵۰ گیگ",
  renew_url: "https://example.com/renew/…",
  order_number: "۱۰۰۰۴۲",
  amount: "۱۵۰٬۰۰۰ تومان",
  method: "زرین‌پال",
  order_url: "https://example.com/orders/…",
  ticket_subject: "کندی اتصال",
  ticket_url: "https://example.com/tickets/…",
};

const keyOf = (req: Request): NotificationTemplateKey => {
  const key = String(req.params.key);
  if (!(NOTIFICATION_TEMPLATE_KEYS as readonly string[]).includes(key)) {
    throw new ApiError(404, "NOT_FOUND", "No such template");
  }
  return key as NotificationTemplateKey;
};

const view = async (db: Db, key: NotificationTemplateKey): Promise<NotificationTemplateView> => {
  const current = await templateFor(db, key);
  return {
    key,
    subject: current.subject,
    body: current.body,
    isActive: current.isActive,
    custom: current.custom,
    variables: [...DEFAULT_TEMPLATES[key].variables],
    defaultSubject: DEFAULT_TEMPLATES[key].subject,
    defaultBody: DEFAULT_TEMPLATES[key].body,
    updatedAt: current.updatedAt?.toISOString() ?? null,
  };
};

const assertKnownVariables = (key: NotificationTemplateKey, subject: string, body: string) => {
  const fields = [
    ...unknownVariables(key, subject).map(() => ({ path: "subject", code: "TEMPLATE_VARIABLE_UNKNOWN" })),
    ...unknownVariables(key, body).map(() => ({ path: "body", code: "TEMPLATE_VARIABLE_UNKNOWN" })),
  ];
  if (fields.length) {
    throw new ApiError(400, "TEMPLATE_VARIABLE_UNKNOWN", `Unknown variables: ${unknownVariables(key, subject, body).join(", ")}`, {
      fields: fields.filter((field, index) => fields.findIndex((f) => f.path === field.path) === index),
    });
  }
};

const templateRow = (key: NotificationTemplateKey) =>
  and(
    eq(notificationTemplates.key, key),
    eq(notificationTemplates.channel, "email"),
    eq(notificationTemplates.locale, "fa"),
  );

export const notificationsRouter = ({ db }: { db: Db }) => {
  const router = Router();
  router.use("/notification-templates", requirePermission("settings:manage"));

  router.get("/notification-templates", async (_req, res) => {
    res.json(await Promise.all(NOTIFICATION_TEMPLATE_KEYS.map((key) => view(db, key))));
  });

  router.put("/notification-templates/:key", async (req, res) => {
    const key = keyOf(req);
    const input = parseBody(notificationTemplateInput, req.body);
    assertKnownVariables(key, input.subject, input.body);
    const actor = staffActor(req);
    await db.transaction(async (tx) => {
      const before = await templateFor(tx, key);
      await tx
        .insert(notificationTemplates)
        .values({ key, channel: "email", locale: "fa", ...input, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: [notificationTemplates.key, notificationTemplates.channel, notificationTemplates.locale],
          set: { ...input, updatedBy: actor.userId, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        ...auditBy(actor),
        action: "notification_template.updated",
        entityType: "notification_template",
        entityId: null,
        before: { key, subject: before.subject, body: before.body, isActive: before.isActive },
        after: { key, ...input },
      });
    });
    res.json(await view(db, key));
  });

  router.delete("/notification-templates/:key", async (req, res) => {
    const key = keyOf(req);
    const actor = staffActor(req);
    await db.transaction(async (tx) => {
      const deleted = await tx.delete(notificationTemplates).where(templateRow(key)).returning();
      if (deleted.length) {
        await writeAudit(tx, {
          ...auditBy(actor),
          action: "notification_template.reset",
          entityType: "notification_template",
          before: { key, subject: deleted[0]!.subject, body: deleted[0]!.body },
          after: { key, default: true },
        });
      }
    });
    res.json(await view(db, key));
  });

  router.post("/notification-templates/:key/preview", async (req, res) => {
    const key = keyOf(req);
    const input = parseBody(notificationTemplateInput, req.body);
    assertKnownVariables(key, input.subject, input.body);
    res.json({ subject: render(input.subject, SAMPLE), body: render(input.body, SAMPLE) });
  });

  router.get("/customers/:id/notifications", requirePermission("customers:read"), async (req, res) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, parseId(req.params.id)))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    const log: NotificationLogView[] = rows.map((row) => ({
      id: row.id,
      templateKey: row.templateKey,
      channel: row.channel,
      recipient: row.recipient,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    }));
    res.json(log);
  });

  return router;
};
