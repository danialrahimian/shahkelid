import {
  backupSettingsInput,
  mailSettingsInput,
  mailTestInput,
  mailVerifyInput,
  nowpaymentsSettingsInput,
  SETTINGS_SECTIONS,
  telegramSettingsInput,
  tronSettingsInput,
  zarinpalSettingsInput,
  type SettingsSection,
} from "@shah-kelid/contracts";
import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";

import type { Db } from "../../platform/db/client";
import { requirePermission } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError } from "../../platform/http/api-error";
import { parseBody } from "../../platform/http/validate";
import { backupsAvailable, requestBackup, writeBackupEnvironment } from "./backup-control";
import {
  checkS3,
  findTelegramChats,
  resetSection,
  saveBackups,
  saveMail,
  saveNowpayments,
  saveTelegram,
  saveTron,
  saveZarinpal,
  sendMailTest,
  sendTelegramTest,
  settingsView,
  testTelegramBot,
  verifyMailTest,
} from "./service";

/**
 * /api/v1/staff/settings — settings:manage (owners and admins).
 *
 *   GET    /                         every section; secrets only as "saved or not"
 *   PUT    /mail | /telegram | /zarinpal | /tron | /nowpayments | /backups
 *   DELETE /:section                 forget what the panel saved (back to .env, or off)
 *   POST   /mail/test   { to? }      a code by mail, through SMTP now
 *   POST   /mail/verify { code }     the code came back: mail works
 *   POST   /telegram/test            who the bot is
 *   POST   /telegram/chats           who wrote to it lately
 *   POST   /telegram/send-test       a message to every alert chat
 *   POST   /backups/check-s3         { endpoint, bucket } does it answer
 *   POST   /backups/run              back up now
 */

const s3Target = z.object({
  endpoint: z.string().trim().regex(/^https?:\/\/\S+$/, "URL_INVALID").transform((url) => url.replace(/\/+$/, "")),
  bucket: z.string().trim().min(1, "REQUIRED"),
});

export const settingsRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();
  router.use(requirePermission("settings:manage"));

  const respond = async (res: import("express").Response) => {
    // The backup service hears about a change at once, not at the worker's next pass.
    await writeBackupEnvironment();
    res.json(await settingsView());
  };

  router.get("/", async (_req, res) => {
    res.json(await settingsView());
  });

  router.put("/mail", async (req, res) => {
    await saveMail(db, staffActor(req), parseBody(mailSettingsInput, req.body));
    await respond(res);
  });
  router.put("/telegram", async (req, res) => {
    await saveTelegram(db, staffActor(req), parseBody(telegramSettingsInput, req.body));
    await respond(res);
  });
  router.put("/zarinpal", async (req, res) => {
    await saveZarinpal(db, staffActor(req), parseBody(zarinpalSettingsInput, req.body));
    await respond(res);
  });
  router.put("/tron", async (req, res) => {
    await saveTron(db, staffActor(req), parseBody(tronSettingsInput, req.body));
    await respond(res);
  });
  router.put("/nowpayments", async (req, res) => {
    await saveNowpayments(db, staffActor(req), parseBody(nowpaymentsSettingsInput, req.body));
    await respond(res);
  });
  router.put("/backups", async (req, res) => {
    await saveBackups(db, staffActor(req), parseBody(backupSettingsInput, req.body));
    await respond(res);
  });

  router.post("/mail/test", async (req, res) => {
    const { to } = parseBody(mailTestInput, req.body ?? {});
    res.json(await sendMailTest(redis, staffActor(req), req.account!.user.email, to));
  });
  router.post("/mail/verify", async (req, res) => {
    const { code } = parseBody(mailVerifyInput, req.body);
    await verifyMailTest(db, redis, staffActor(req), code);
    await respond(res);
  });

  router.post("/telegram/test", async (_req, res) => {
    res.json(await testTelegramBot());
  });
  router.post("/telegram/chats", async (_req, res) => {
    res.json(await findTelegramChats());
  });
  router.post("/telegram/send-test", async (_req, res) => {
    res.json(await sendTelegramTest());
  });

  router.post("/backups/check-s3", async (req, res) => {
    const { endpoint, bucket } = parseBody(s3Target, req.body);
    res.json(await checkS3(endpoint, bucket));
  });
  router.post("/backups/run", async (_req, res) => {
    if (!backupsAvailable()) {
      throw new ApiError(409, "BACKUPS_UNAVAILABLE", "There is no backup service on this machine");
    }
    await writeBackupEnvironment();
    await requestBackup();
    res.status(202).json(await settingsView());
  });

  router.delete("/:section", async (req, res) => {
    const section = String(req.params.section);
    if (!(SETTINGS_SECTIONS as readonly string[]).includes(section)) throw new ApiError(404, "NOT_FOUND", "No such section");
    await resetSection(db, staffActor(req), section as SettingsSection);
    await respond(res);
  });

  return router;
};
