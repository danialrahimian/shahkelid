import type { Executor } from "../../platform/db/client";
import { auditLogs } from "./schema";

/**
 * Writes one audit entry.
 *
 * Pass the transaction the audited change is part of, so the entry exists
 * exactly when the change does: a role granted and not logged, or logged and
 * then rolled back, would both make the log lie. The table refuses updates
 * and deletes (migration 0002), so entries cannot be tidied away afterwards.
 */
export type AuditEntry = {
  actorKind: "customer" | "staff" | "reseller" | "system" | "bot";
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export const writeAudit = async (executor: Executor, entry: AuditEntry) => {
  await executor.insert(auditLogs).values({
    actorKind: entry.actorKind,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
  });
};
