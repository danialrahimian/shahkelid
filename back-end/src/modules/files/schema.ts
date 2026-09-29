import { sql } from "drizzle-orm";
import { boolean, check, index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { users } from "../identity/schema";
import { createdAt, id, wholeNumber } from "../../platform/db/columns";

export const filePurpose = pgEnum("file_purpose", [
  "receipt",
  "post_cover",
  "content_image",
  "ticket_attachment",
  "avatar",
]);

export const files = pgTable(
  "files",
  {
    id: id(),
    // random name on disk / in the object store
    storageKey: text("storage_key").notNull().unique(),
    purpose: filePurpose("purpose").notNull(),
    originalName: text("original_name").notNull().default(""),
    mimeType: text("mime_type").notNull(),
    sizeBytes: wholeNumber("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    // receipts and ticket attachments are served only to their owner and staff
    isPublic: boolean("is_public").notNull().default(false),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("files_size_positive", sql`${t.sizeBytes} > 0`),
    check("files_sha256_format", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    index("files_sha256_idx").on(t.sha256),
  ],
);
