import { z } from "zod";

/** The emails customers get. Their text lives in the templates, editable by staff. */
export const NOTIFICATION_TEMPLATE_KEYS = [
  "subscription_ready",
  "subscription_renewed",
  "payment_received",
  "expiry_3d",
  "expiry_1d",
  "usage_80",
  "usage_100",
  "ticket_reply",
] as const;
export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

export type NotificationTemplateView = {
  key: NotificationTemplateKey;
  subject: string;
  body: string;
  isActive: boolean;
  /** Staff have rewritten it; false means the built-in text. */
  custom: boolean;
  /** What {{…}} it may use. */
  variables: string[];
  defaultSubject: string;
  defaultBody: string;
  updatedAt: string | null;
};

export const notificationTemplateInput = z.object({
  subject: z.string().trim().min(1, "REQUIRED").max(200, "TOO_LONG"),
  body: z.string().trim().min(1, "REQUIRED").max(5000, "TOO_LONG"),
  isActive: z.boolean().default(true),
});
export type NotificationTemplateInput = z.input<typeof notificationTemplateInput>;

/** One message sent to a customer, or not sent and why. */
export type NotificationLogView = {
  id: number;
  templateKey: string;
  channel: "email" | "telegram";
  recipient: string;
  status: "queued" | "sent" | "failed" | "skipped";
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};
