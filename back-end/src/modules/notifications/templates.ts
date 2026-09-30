import type { NotificationTemplateKey } from "@shah-kelid/contracts";
import { and, eq } from "drizzle-orm";

import type { Executor } from "../../platform/db/client";
import { notificationTemplates } from "./schema";

/**
 * The emails customers get, in Persian, with their defaults written here.
 *
 * Staff can rewrite any of them from the dashboard (the row in
 * notification_templates wins), switch one off, or go back to the default.
 * Each template names the variables it may use; a saved template that
 * mentions anything else is refused, so an email can never go out with
 * "{{plan_nmae}}" in it.
 */

type Default = { subject: string; body: string; variables: readonly string[] };

export const DEFAULT_TEMPLATES: Record<NotificationTemplateKey, Default> = {
  subscription_ready: {
    subject: "سرویس شما آماده است: {{plan_name}}",
    body: [
      "سلام {{name}}،",
      "",
      "سرویس {{plan_name}} شما ({{volume}}، {{days}}) آماده است.",
      "زمان سرویس از اولین اتصال شما شروع می‌شود.",
      "",
      "این لینک را در اپ VPN خود (v2rayNG، Hiddify یا Streisand) وارد کنید:",
      "{{link}}",
      "",
      "لینک و QR در حساب شما هم هست: {{account_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "volume", "days", "link", "account_url"],
  },
  subscription_renewed: {
    subject: "تمدید شد: {{plan_name}}",
    body: [
      "سلام {{name}}،",
      "",
      "سرویس شما تمدید شد. اعتبار تا {{expires_on}} و حجم باقی‌مانده {{remaining}}.",
      "لینک شما همان لینک قبلی است و لازم نیست چیزی را در اپ عوض کنید.",
      "",
      "حساب شما: {{account_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "expires_on", "remaining", "account_url"],
  },
  payment_received: {
    subject: "پرداخت شما دریافت شد (سفارش {{order_number}})",
    body: [
      "سلام {{name}}،",
      "",
      "پرداخت {{amount}} برای {{plan_name}} با {{method}} دریافت شد.",
      "سفارش و فاکتور: {{order_url}}",
    ].join("\n"),
    variables: ["name", "order_number", "amount", "plan_name", "method", "order_url"],
  },
  expiry_3d: {
    subject: "۳ روز تا پایان سرویس {{plan_name}}",
    body: [
      "سلام {{name}}،",
      "",
      "سرویس {{plan_name}} شما {{expires_on}} تمام می‌شود ({{days_left}} مانده). حجم باقی‌مانده: {{remaining}}.",
      "با تمدید، روزها و حجم باقی‌مانده از بین نمی‌رود و لینک شما عوض نمی‌شود:",
      "{{renew_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "expires_on", "days_left", "remaining", "renew_url"],
  },
  expiry_1d: {
    subject: "فردا سرویس {{plan_name}} تمام می‌شود",
    body: [
      "سلام {{name}}،",
      "",
      "سرویس {{plan_name}} شما {{expires_on}} تمام می‌شود.",
      "برای اینکه اتصالتان قطع نشود، همین حالا تمدید کنید:",
      "{{renew_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "expires_on", "days_left", "remaining", "renew_url"],
  },
  usage_80: {
    subject: "۸۰٪ حجم {{plan_name}} مصرف شده",
    body: [
      "سلام {{name}}،",
      "",
      "{{used}} از {{total}} حجم سرویس {{plan_name}} را مصرف کرده‌اید؛ {{remaining}} مانده است.",
      "با تمدید، حجم تازه به باقی‌مانده اضافه می‌شود:",
      "{{renew_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "used", "total", "remaining", "renew_url"],
  },
  usage_100: {
    subject: "حجم {{plan_name}} تمام شد",
    body: [
      "سلام {{name}}،",
      "",
      "حجم سرویس {{plan_name}} ({{total}}) تمام شده و اتصال شما تا تمدید قطع است.",
      "تمدید: {{renew_url}}",
    ].join("\n"),
    variables: ["name", "plan_name", "used", "total", "remaining", "renew_url"],
  },
  ticket_reply: {
    subject: "پاسخ تیکت: {{ticket_subject}}",
    body: [
      "سلام {{name}}،",
      "",
      "پشتیبانی به تیکت «{{ticket_subject}}» پاسخ داد.",
      "مشاهده و پاسخ: {{ticket_url}}",
    ].join("\n"),
    variables: ["name", "ticket_subject", "ticket_url"],
  },
};

const VARIABLE = /{{\s*([a-z_]+)\s*}}/g;

/** Variables a text uses that the template does not offer. */
export const unknownVariables = (key: NotificationTemplateKey, ...texts: string[]) => {
  const allowed = new Set(DEFAULT_TEMPLATES[key].variables);
  const used = texts.flatMap((text) => [...text.matchAll(VARIABLE)].map((match) => match[1]!));
  return [...new Set(used.filter((name) => !allowed.has(name)))];
};

/** Fills the variables in. A value that is missing is left empty, never shown as "{{x}}". */
export const render = (text: string, values: Record<string, string>) =>
  text.replace(VARIABLE, (_whole, name: string) => values[name] ?? "");

/** The template in force for a key: the staff's version if there is one, else the default. */
export const templateFor = async (executor: Executor, key: NotificationTemplateKey) => {
  const [row] = await executor
    .select()
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.key, key),
        eq(notificationTemplates.channel, "email"),
        eq(notificationTemplates.locale, "fa"),
      ),
    );
  const fallback = DEFAULT_TEMPLATES[key];
  return row
    ? { subject: row.subject, body: row.body, isActive: row.isActive, custom: true, updatedAt: row.updatedAt }
    : { subject: fallback.subject, body: fallback.body, isActive: true, custom: false, updatedAt: null };
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The same text as HTML, right to left, so mail apps lay Persian out
 * properly. Links become clickable; nothing else is interpreted, so a
 * template cannot inject markup.
 */
export const asHtml = (text: string) => {
  const linked = escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" dir="ltr" style="word-break:break-all">${url}</a>`,
  );
  return `<div dir="rtl" style="font-family:Tahoma,Vazirmatn,sans-serif;font-size:15px;line-height:1.9;text-align:right">${linked.replace(/\n/g, "<br>")}</div>`;
};
