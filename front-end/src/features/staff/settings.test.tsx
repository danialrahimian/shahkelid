import type { SettingsView } from "@shah-kelid/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { BackupsCard, MailCard, PaymentsCard, TelegramCard } from "./components/settings-page";

/**
 * The settings page, drawn in the states a shop goes through: a fresh
 * install with nothing set up, then everything saved and working, then a
 * backup that failed. What matters is what the owner reads: the state of
 * each section, that a saved secret is never shown, and what to do next.
 */

const NOTHING: SettingsView = {
  mail: { source: "none", host: "", port: 587, user: "", from: "", hasPassword: false, verifiedAt: null },
  telegram: { source: "none", hasToken: false, chatIds: [] },
  zarinpal: { source: "none", merchantId: "", sandbox: false },
  tron: { source: "none", address: "", hasApiKey: false },
  nowpayments: { source: "none", hasApiKey: false, hasIpnSecret: false, sandbox: false },
  backups: { source: "none", intervalHours: 6, s3: null, telegram: { enabled: false, chatIds: [] }, status: null },
};

const SET_UP: SettingsView = {
  mail: {
    source: "panel",
    host: "smtp-relay.brevo.com",
    port: 587,
    user: "mailer",
    from: "شاه‌کلید <no-reply@shop.example>",
    hasPassword: true,
    verifiedAt: "2026-10-19T10:00:00Z",
  },
  telegram: { source: "panel", hasToken: true, chatIds: ["4242"] },
  zarinpal: { source: "panel", merchantId: "11111111-2222-3333-4444-555555555555", sandbox: false },
  tron: { source: "panel", address: "TRJqp2T9pZeULj4B7Arbc37zqDKWT4aRkG", hasApiKey: false },
  nowpayments: { source: "none", hasApiKey: false, hasIpnSecret: false, sandbox: false },
  backups: {
    source: "panel",
    intervalHours: 6,
    s3: { endpoint: "https://s3.example.com", bucket: "shop", accessKeyId: "AKID", hasSecret: true, region: "auto" },
    telegram: { enabled: true, chatIds: [] },
    status: {
      lastRunAt: "2026-10-19T10:00:00Z",
      lastSuccessAt: "2026-10-19T10:00:00Z",
      ok: true,
      message: null,
      accounts: 12,
      local: { ok: true, note: null, snapshots: 3 },
      s3: { ok: true, note: null },
      telegram: { ok: true, note: null },
      requested: false,
    },
  },
};

const draw = (element: React.ReactElement) =>
  renderToStaticMarkup(<Provider store={createTestStore()}>{element}</Provider>);

const everything = (view: SettingsView) =>
  [
    draw(<MailCard view={view.mail} />),
    draw(<TelegramCard view={view.telegram} />),
    draw(<PaymentsCard view={view} />),
    draw(<BackupsCard view={view.backups} telegramReady={view.telegram.hasToken} />),
  ].join("\n");

describe("A fresh install", () => {
  const html = everything(NOTHING);

  it("Says what is not set up, section by section", () => {
    expect(html).toContain("تنظیم نشده");
    expect(html).toContain("هیچ درگاه آنلاینی تنظیم نشده");
  });

  it("Offers no tests until there is something to test", () => {
    expect(html).not.toContain("ارسال کد آزمایشی");
    expect(html).not.toContain("بررسی ربات");
  });

  it("Says backups run on the server when this machine has no backup service", () => {
    expect(html).toContain("روی این ماشین سرویس پشتیبان‌گیری نیست");
  });
});

describe("Everything set up", () => {
  const html = everything(SET_UP);

  it("Shows each section as working", () => {
    expect(html).toContain("کار می‌کند");
    expect(html).toContain("روشن، برای 1 گفتگو");
    expect(html).toContain("سالم");
    expect(html).toContain("روی همین سرور (3 نسخه)");
  });

  it("Never puts a saved secret back on the page, only that one is saved", () => {
    expect(html).toContain("ذخیره شده است. برای عوض کردن");
    // The password fields are empty: there is nothing to show.
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it("Offers the tests", () => {
    expect(html).toContain("ارسال کد آزمایشی");
    expect(html).toContain("ارسال پیام آزمایشی");
    expect(html).toContain("پشتیبان‌گیری همین حالا");
  });
});

describe("A backup that failed", () => {
  it("Says which destination failed", () => {
    const failed: SettingsView = {
      ...SET_UP,
      backups: {
        ...SET_UP.backups,
        status: { ...SET_UP.backups.status!, ok: false, s3: { ok: false, note: "the bucket cannot be reached" } },
      },
    };
    const html = draw(<BackupsCard view={failed.backups} telegramReady />);
    expect(html).toContain("آخرین بار شکست خورد");
    expect(html).toContain("the bucket cannot be reached");
  });
});
