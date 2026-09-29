/**
 * Every table, in one import, for the database client and for drizzle-kit.
 *
 * Each module owns its tables in its own schema file; this only gathers them.
 */
export * from "../../modules/access/schema";
export * from "../../modules/billing/schema";
export * from "../../modules/catalog/schema";
export * from "../../modules/content/schema";
export * from "../../modules/crm/schema";
export * from "../../modules/files/schema";
export * from "../../modules/identity/schema";
export * from "../../modules/infrastructure/schema";
export * from "../../modules/ledger/schema";
export * from "../../modules/notifications/schema";
export * from "../../modules/subscriptions/schema";
export * from "../../modules/support/schema";
export * from "./platform-schema";
