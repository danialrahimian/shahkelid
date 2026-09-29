import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import config from "../../config";
import type { Executor } from "../../platform/db/client";
import { files, filePurpose } from "./schema";

/**
 * Private files (card-transfer receipts now; ticket attachments later).
 *
 * Kept outside the public uploads folder and served only through routes that
 * check who is asking. Stored under a random name: the customer's file name
 * is kept in the row, never used on disk.
 *
 * The type is read from the file's first bytes, not from what the browser
 * claimed: a PDF or a script renamed receipt.jpg is not an image.
 */

const SIGNATURES: { type: string; ext: string; test: (bytes: Buffer) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
  },
];

/** The image type of these bytes, or null when they are not one we accept. */
export const imageTypeOf = (bytes: Buffer) => SIGNATURES.find((signature) => signature.test(bytes)) ?? null;

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type Purpose = (typeof filePurpose.enumValues)[number];

export const savePrivateImage = async (
  executor: Executor,
  {
    bytes,
    purpose,
    originalName,
    uploadedBy,
  }: { bytes: Buffer; purpose: Purpose; originalName: string; uploadedBy: string },
) => {
  const kind = imageTypeOf(bytes);
  if (!kind) throw new Error("Not an accepted image");

  const storageKey = `${purpose}/${randomBytes(16).toString("hex")}.${kind.ext}`;
  const target = path.join(config.checkout.privateFilesDirectory, storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });

  const [row] = await executor
    .insert(files)
    .values({
      storageKey,
      purpose,
      originalName: originalName.slice(0, 200),
      mimeType: kind.type,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      isPublic: false,
      uploadedBy,
    })
    .returning();
  return row!;
};

/** A private file's bytes and type, for a route that has already checked who may see it. */
export const readPrivateFile = async (executor: Executor, fileId: string) => {
  const [row] = await executor.select().from(files).where(eq(files.id, fileId));
  if (!row) return null;
  // storage_key is ours (purpose/random.ext), never customer input; still, stay inside the folder.
  const root = path.resolve(config.checkout.privateFilesDirectory);
  const target = path.resolve(root, row.storageKey);
  if (!target.startsWith(root + path.sep)) return null;
  return { bytes: await readFile(target), mimeType: row.mimeType };
};
