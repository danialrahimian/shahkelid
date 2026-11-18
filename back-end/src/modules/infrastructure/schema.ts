import { boolean, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { at, bytea, createdAt, id, updatedAt } from "../../platform/db/columns";

export const panelDriver = pgEnum("panel_driver", ["pasarguard", "marzban", "x3ui", "hiddify"]);

/** One row per VPN panel instance. The system talks to several from day one. */
export const panels = pgTable("panels", {
  id: id(),
  name: text("name").notNull(),
  driver: panelDriver("driver").notNull(),
  baseUrl: text("base_url").notNull(),
  // {username, password} or {apiKey}, AES-GCM encrypted with the app key
  credentialsEnc: bytea("credentials_enc").notNull(),
  // our own public base for subscription links, e.g. https://sub.example.com
  subscriptionBaseUrl: text("subscription_base_url"),
  version: text("version"), // as reported by the panel
  isActive: boolean("is_active").notNull().default(true),
  lastOkAt: at("last_ok_at"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
