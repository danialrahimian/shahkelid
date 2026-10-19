import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BackupStatusView } from "@shah-kelid/contracts";

import config from "../../config";
import { current } from "./live";

/**
 * The backup service's mailbox: a folder it shares with the app (a docker
 * volume on the server), since the settings it needs are saved in the panel
 * and it has no way to read them itself (they are sealed with the app key).
 *
 *   backup.env    written here: how often, where to (S3, Telegram), with what keys
 *   run-request   written here: "back up now", from the panel
 *   status.json   written by the backup service: what the last backup did
 *
 * On a development machine there is no backup service and no folder: the
 * panel says so instead of offering buttons that would do nothing.
 */

const directory = () => config.backups.controlDirectory;
export const backupsAvailable = () => Boolean(directory());

const fileIn = (name: string) => path.join(directory(), name);

/** One shell assignment, safe to source: single quotes, and a quote inside written as '\'' */
const assign = (name: string, value: string | number) => `${name}='${String(value).replace(/'/g, `'\\''`)}'`;

export const backupEnvironment = () => {
  const backups = current("backups");
  const telegram = current("telegram");
  const chats = backups.telegram.chatIds.length > 0 ? backups.telegram.chatIds : telegram.chatIds;
  const lines = [
    "# Written by the app from the panel's backup settings. Edits here are overwritten.",
    assign("SK_INTERVAL_HOURS", backups.intervalHours),
    assign("SK_S3_REPOSITORY", backups.s3 ? `s3:${backups.s3.endpoint}/${backups.s3.bucket}` : ""),
    assign("SK_S3_ACCESS_KEY_ID", backups.s3?.accessKeyId ?? ""),
    assign("SK_S3_SECRET_ACCESS_KEY", backups.s3?.secretAccessKey ?? ""),
    assign("SK_S3_REGION", backups.s3?.region ?? "auto"),
    assign("SK_TG_ENABLED", backups.telegram.enabled && telegram.botToken && chats.length > 0 ? 1 : 0),
    assign("SK_TG_TOKEN", telegram.botToken),
    assign("SK_TG_CHATS", chats.join(",")),
    assign("SK_TG_API", config.alerts.telegramApiUrl),
  ];
  return `${lines.join("\n")}\n`;
};

let lastWritten: string | undefined;

/**
 * Brings backup.env in line with the settings. Written only when it would
 * change, and atomically (a new file renamed over the old), so the backup
 * service never reads half a file. Only the owner can read it: it holds keys.
 */
export const writeBackupEnvironment = async () => {
  if (!backupsAvailable()) return false;
  const content = backupEnvironment();
  if (content === lastWritten) return false;
  const target = fileIn("backup.env");
  const draft = `${target}.next`;
  await writeFile(draft, content, { mode: 0o600 });
  await chmod(draft, 0o600);
  await rename(draft, target);
  lastWritten = content;
  return true;
};

export const requestBackup = async () => {
  await writeFile(fileIn("run-request"), new Date().toISOString());
};

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

type StatusFile = Omit<BackupStatusView, "requested">;

/** The backup service's last report, or null when it has not written one yet. */
export const backupStatus = async (): Promise<BackupStatusView | null> => {
  if (!backupsAvailable()) return null;
  const requested = await exists(fileIn("run-request"));
  try {
    const status = JSON.parse(await readFile(fileIn("status.json"), "utf8")) as StatusFile;
    return { ...status, requested };
  } catch {
    return {
      lastRunAt: null,
      lastSuccessAt: null,
      ok: false,
      message: null,
      accounts: null,
      local: { ok: false, note: null, snapshots: null },
      s3: null,
      telegram: null,
      requested,
    };
  }
};

/** Test seam. */
export const forgetWrittenBackupEnvironment = async () => {
  lastWritten = undefined;
  if (backupsAvailable()) await rm(fileIn("backup.env"), { force: true });
};
