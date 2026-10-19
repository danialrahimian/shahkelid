import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn as Column,
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { files } from "../files/schema";
import { at, bytea, citext, createdAt, id, updatedAt } from "../../platform/db/columns";

export const userStatus = pgEnum("user_status", ["active", "suspended", "deleted"]);

export const users = pgTable(
  "users",
  {
    id: id(),
    // case-insensitive, so Ali@x.com and ali@x.com are one account. Null
    // only for a staff account made with a username (the owner the
    // installer creates), until they add an address.
    email: citext("email").unique(),
    // gmail dots and +tags stripped; what free-trial abuse is checked against
    emailNormalized: text("email_normalized"),
    // Signs in with a password instead of an email; staff only. Lowercase
    // letters, digits, dot, dash and underscore (no @, so it never looks
    // like an address).
    username: citext("username").unique(),
    emailVerifiedAt: at("email_verified_at"),
    // null for an account that only ever signs in with an emailed code
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull().default(""),
    locale: text("locale").notNull().default("fa"),
    status: userStatus("status").notNull().default("active"),
    avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => files.id, {
      onDelete: "set null",
    }),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).unique(),
    telegramUsername: text("telegram_username"),
    referralCode: text("referral_code").notNull().unique(),
    referredByUserId: uuid("referred_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    // TOTP secret, AES-GCM encrypted with the app key; never stored in clear
    totpSecretEnc: bytea("totp_secret_enc"),
    totpEnabledAt: at("totp_enabled_at"),
    // sessions signed in before this are over (set when the password is reset)
    sessionsRevokedAt: at("sessions_revoked_at"),
    lastLoginAt: at("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: at("deleted_at"),
  },
  (t) => [
    check("users_display_name_length", sql`char_length(${t.displayName}) <= 80`),
    check("users_email_or_username", sql`${t.email} is not null or ${t.username} is not null`),
    check("users_username_format", sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
    check("users_locale", sql`${t.locale} in ('fa', 'en')`),
    check(
      "users_not_self_referred",
      sql`${t.referredByUserId} is null or ${t.referredByUserId} <> ${t.id}`,
    ),
    index("users_email_normalized_idx").on(t.emailNormalized),
    index("users_referred_by_idx")
      .on(t.referredByUserId)
      .where(sql`${t.referredByUserId} is not null`),
    index("users_created_at_idx").on(t.createdAt),
  ],
);

/** One-time codes for signing in when the authenticator is lost. */
export const userRecoveryCodes = pgTable(
  "user_recovery_codes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: at("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("user_recovery_codes_user_idx").on(t.userId)],
);

/**
 * How staff screens name an account: its email, or its username when it has
 * none (the owner the installer makes). Takes an alias of users, too.
 */
export const accountLabel = (table: { email: Column; username: Column } = users): SQL<string> =>
  sql<string>`coalesce(${table.email}::text, ${table.username}::text)`;

/** The same, for an account joined in that may not be there (left join). */
export const optionalAccountLabel = (table: { email: Column; username: Column }): SQL<string | null> =>
  sql<string | null>`coalesce(${table.email}::text, ${table.username}::text)`;
