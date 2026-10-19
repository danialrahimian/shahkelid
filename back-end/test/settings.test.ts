import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { like } from "drizzle-orm";

import config from "../src/config";
import { setTransport } from "../src/libraries/mailer";
import { assertMailSetUp } from "../src/modules/identity/service";
import { current, loadSettings, resetLiveSettings } from "../src/modules/settings/live";
import { forgetWrittenBackupEnvironment } from "../src/modules/settings/backup-control";
import { siteSettings } from "../src/platform/db/platform-schema";
import { createClient } from "./helpers/api-client";
import { closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The settings page (M11): mail, Telegram, payments and backups are set in
 * the staff area instead of the server's .env, and each can be tried for
 * real from there. Secrets go in and never come back out.
 */

const SETTINGS = "/api/v1/staff/settings";
const MAIL = { host: "smtp.example.com", port: "۵۸۷", user: "mailer", password: "s3cret$#'pass", from: "شاه‌کلید <no-reply@example.com>" };

let owner: Awaited<ReturnType<typeof signedInStaff>>;
let controlDirectory: string;
let telegram: http.Server;
const telegramCalls: { method: string; body: Record<string, unknown> }[] = [];

/** A stand-in for the Bot API: a known token, one chat that wrote to the bot. */
const fakeTelegram = () =>
  http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const [, token, method] = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "") ?? [];
      telegramCalls.push({ method: method ?? "", body: raw ? JSON.parse(raw) : {} });
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (token !== "123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789") {
        return reply(401, { ok: false, description: "Unauthorized" });
      }
      if (method === "getMe") return reply(200, { ok: true, result: { username: "shop_alerts_bot" } });
      if (method === "getUpdates") {
        return reply(200, {
          ok: true,
          result: [
            { message: { chat: { id: 777, first_name: "Ali" } } },
            { my_chat_member: { chat: { id: -100200, title: "Admins" } } },
            { message: { chat: { id: 777, first_name: "Ali" } } },
          ],
        });
      }
      if (method === "sendMessage") return reply(200, { ok: true, result: { message_id: 1 } });
      return reply(404, { ok: false, description: "Not Found" });
    });
  });

before(async () => {
  await resetTestDatabase();
  controlDirectory = await mkdtemp(path.join(os.tmpdir(), "sk-control-"));
  telegram = fakeTelegram();
  await new Promise<void>((resolve) => telegram.listen(0, "127.0.0.1", resolve));
  Object.assign(config.alerts, { telegramApiUrl: `http://127.0.0.1:${(telegram.address() as AddressInfo).port}` });
  Object.assign(config.backups, { controlDirectory });
  await startTestServer();
  owner = await signedInStaff(["owner"]);
});

after(async () => {
  setTransport(null);
  resetLiveSettings();
  await forgetWrittenBackupEnvironment();
  await rm(controlDirectory, { recursive: true, force: true });
  await new Promise((resolve) => telegram.close(resolve));
  await closeDatabase();
  await stopTestServer();
});

describe("Who may see the settings", () => {
  it("Only staff who may change settings: a support agent is refused, and so is a customer", async () => {
    const agent = await signedInStaff(["support"]);
    assert.equal((await agent.client.get(SETTINGS)).status, 403);
    assert.equal((await createClient().get(SETTINGS)).status, 401);
  });
});

describe("Mail", () => {
  it("Is saved with the password sealed: it never comes back, and is not readable in the database", async () => {
    const saved = await owner.client.put(`${SETTINGS}/mail`, MAIL);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.mail.source, "panel");
    assert.equal(saved.data.mail.port, 587, "Persian digits are read");
    assert.equal(saved.data.mail.hasPassword, true);
    assert.equal(JSON.stringify(saved.data).includes(MAIL.password), false);

    const rows = await database().select().from(siteSettings).where(like(siteSettings.key, "settings.%"));
    assert.equal(JSON.stringify(rows).includes(MAIL.password), false);
    assert.equal(JSON.stringify(rows).includes("smtp.example.com"), false, "the whole section is sealed");
  });

  it("Saved again with the password left empty, keeps the password", async () => {
    await owner.client.put(`${SETTINGS}/mail`, { ...MAIL, password: "", host: "smtp2.example.com" });
    assert.equal(current("mail").password, MAIL.password);
    assert.equal(current("mail").host, "smtp2.example.com");
  });

  it("A bad sender or port is refused with the field", async () => {
    const response = await owner.client.put(`${SETTINGS}/mail`, { ...MAIL, from: "not an address", port: "99999" });
    assert.equal(response.status, 400);
    const paths = response.data.error.fields.map((field: { path: string }) => field.path).sort();
    assert.deepEqual(paths, ["from", "port"]);
  });

  it("The test sends a code; typed back, the mail settings are marked as working", async () => {
    const sent: { to: string; text: string }[] = [];
    setTransport({ sendMail: async (message: { to: string; text: string }) => (sent.push(message), { messageId: "1" }) });

    const test = await owner.client.post(`${SETTINGS}/mail/test`, {});
    assert.deepEqual(test.data, { sent: true, to: owner.email, detail: null });
    const code = /(\d{6})/.exec(sent.at(-1)!.text)![1]!;

    const wrong = await owner.client.post(`${SETTINGS}/mail/verify`, { code: code === "000000" ? "111111" : "000000" });
    assert.equal(wrong.data.error.code, "CODE_WRONG");

    const right = await owner.client.post(`${SETTINGS}/mail/verify`, { code });
    assert.equal(right.status, 200);
    assert.ok(right.data.mail.verifiedAt);

    // Changing anything needs a new test.
    const changed = await owner.client.put(`${SETTINGS}/mail`, { ...MAIL, password: "" , user: "other" });
    assert.equal(changed.data.mail.verifiedAt, null);
  });

  it("A test the provider refuses is an answer with the provider's words, not an error", async () => {
    setTransport({ sendMail: async () => Promise.reject(new Error("535 Authentication failed")) });
    const test = await owner.client.post(`${SETTINGS}/mail/test`, { to: "someone@example.com" });
    assert.equal(test.status, 200);
    assert.deepEqual(test.data, { sent: false, to: "someone@example.com", detail: "535 Authentication failed" });
  });

  it("On a server with no mail set up, a sign-in code is refused at once instead of queued to fail", async () => {
    const saved = { isProduction: config.isProduction };
    const userBefore = config.mail.user;
    await owner.client.del(`${SETTINGS}/mail`);
    Object.assign(config, { isProduction: true });
    Object.assign(config.mail, { user: "" });
    try {
      assert.throws(() => assertMailSetUp(), { code: "MAIL_NOT_CONFIGURED" });
    } finally {
      Object.assign(config, saved);
      Object.assign(config.mail, { user: userBefore });
    }
  });
});

describe("Telegram", () => {
  const TOKEN = "123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";

  it("A wrong token is shown as Telegram's own answer", async () => {
    await owner.client.put(`${SETTINGS}/telegram`, { botToken: "123456:WRONGwrongWRONGwrongWRONGwrong0000", chatIds: [] });
    const test = await owner.client.post(`${SETTINGS}/telegram/test`);
    assert.deepEqual(test.data, { ok: false, username: null, detail: "Unauthorized" });
  });

  it("The right one names the bot, finds who wrote to it, and sends a test to each chat", async () => {
    await owner.client.put(`${SETTINGS}/telegram`, { botToken: TOKEN, chatIds: [] });
    assert.deepEqual((await owner.client.post(`${SETTINGS}/telegram/test`)).data, {
      ok: true,
      username: "shop_alerts_bot",
      detail: null,
    });

    const chats = await owner.client.post(`${SETTINGS}/telegram/chats`);
    assert.deepEqual(chats.data.chats, [
      { id: "777", title: "Ali" },
      { id: "-100200", title: "Admins" },
    ]);

    // Saved without the token: the saved one is kept.
    const saved = await owner.client.put(`${SETTINGS}/telegram`, { botToken: "", chatIds: ["777", "-100200"] });
    assert.equal(saved.data.telegram.hasToken, true);
    const sent = await owner.client.post(`${SETTINGS}/telegram/send-test`);
    assert.deepEqual(sent.data, { sent: 2, failed: [], detail: null });
    assert.deepEqual(
      telegramCalls.filter((call) => call.method === "sendMessage").map((call) => call.body.chat_id),
      ["777", "-100200"],
    );
  });
});

describe("Payments", () => {
  it("Without a merchant id Zarinpal is not offered; with one saved, it is", async () => {
    const savedCheckout = { ...config.checkout };
    Object.assign(config.checkout, { zarinpalMerchantId: "" });
    try {
      await owner.client.del(`${SETTINGS}/zarinpal`);
      const without = await createClient().get("/api/v1/shop/payment-methods");
      assert.equal(without.data.some((method: { method: string }) => method.method === "zarinpal"), false);

      const saved = await owner.client.put(`${SETTINGS}/zarinpal`, {
        merchantId: "11111111-2222-3333-4444-555555555555",
        sandbox: true,
      });
      assert.equal(saved.data.zarinpal.source, "panel");
      const withIt = await createClient().get("/api/v1/shop/payment-methods");
      assert.equal(withIt.data.some((method: { method: string }) => method.method === "zarinpal"), true);
    } finally {
      Object.assign(config.checkout, savedCheckout);
    }
  });

  it("A TRON address is checked; only the address is ever asked for", async () => {
    const wrong = await owner.client.put(`${SETTINGS}/tron`, { address: "TRJqp2T9pZeULj4B7Arbc37zqDKWT4aRk0", tronGridApiKey: "" });
    assert.equal(wrong.data.error.fields[0].code, "TRON_ADDRESS_INVALID");
    const right = await owner.client.put(`${SETTINGS}/tron`, { address: "TRJqp2T9pZeULj4B7Arbc37zqDKWT4aRkG", tronGridApiKey: "" });
    assert.equal(right.data.tron.address, "TRJqp2T9pZeULj4B7Arbc37zqDKWT4aRkG");
  });

  it("NOWPayments needs both its key and its IPN secret", async () => {
    const half = await owner.client.put(`${SETTINGS}/nowpayments`, { apiKey: "key", ipnSecret: "", sandbox: false });
    assert.equal(half.data.error.code, "SECRET_REQUIRED");
  });
});

describe("Backups", () => {
  it("The backup service is told by a file only the owner can read, with the S3 and Telegram settings", async () => {
    const saved = await owner.client.put(`${SETTINGS}/backups`, {
      intervalHours: 12,
      s3: {
        endpoint: "https://s3.example.com/",
        bucket: "shop-backups",
        accessKeyId: "AKID",
        secretAccessKey: "it's secret",
        region: "auto",
      },
      telegram: { enabled: true, chatIds: [] },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.backups.s3.hasSecret, true);

    const file = path.join(controlDirectory, "backup.env");
    const content = await readFile(file, "utf8");
    assert.match(content, /^SK_INTERVAL_HOURS='12'$/m);
    assert.match(content, /^SK_S3_REPOSITORY='s3:https:\/\/s3\.example\.com\/shop-backups'$/m);
    assert.match(content, /^SK_S3_SECRET_ACCESS_KEY='it'\\''s secret'$/m, "a quote inside is shell-safe");
    // The backup chats are the alert chats when none are given.
    assert.match(content, /^SK_TG_ENABLED='1'$/m);
    assert.match(content, /^SK_TG_CHATS='777,-100200'$/m);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  });

  it("Back up now leaves a request, and the service's report is shown", async () => {
    await writeFile(
      path.join(controlDirectory, "status.json"),
      JSON.stringify({
        lastRunAt: "2026-10-19T10:00:00Z",
        lastSuccessAt: "2026-10-19T10:00:00Z",
        ok: true,
        message: null,
        accounts: 12,
        local: { ok: true, note: null, snapshots: 3 },
        s3: { ok: true, note: null },
        telegram: { ok: false, note: "file too big; sent the database only" },
      }),
    );
    const run = await owner.client.post(`${SETTINGS}/backups/run`);
    assert.equal(run.status, 202);
    assert.equal(run.data.backups.status.requested, true);
    assert.equal(run.data.backups.status.local.snapshots, 3);
    assert.ok(await stat(path.join(controlDirectory, "run-request")));
  });
});

describe("Another process", () => {
  it("Reads the same settings from the database (the worker, a restart)", async () => {
    resetLiveSettings();
    assert.equal(current("telegram").chatIds.length, 0);
    await loadSettings(database());
    assert.deepEqual(current("telegram").chatIds, ["777", "-100200"]);
    assert.equal(current("backups").intervalHours, 12);
  });
});
