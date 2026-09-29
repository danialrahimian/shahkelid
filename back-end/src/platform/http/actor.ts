import type { Request } from "express";

import type { AuditEntry } from "../../modules/access/audit";

/**
 * Who is doing something, for the audit log and subscription history:
 * the signed-in member of staff, and where the request came from.
 */
export type StaffActor = {
  userId: string;
  request: Pick<AuditEntry, "ip" | "userAgent" | "requestId">;
};

export const staffActor = (req: Request): StaffActor => ({
  userId: req.account!.user.id,
  request: {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    requestId: (req as { id?: string }).id ?? null,
  },
});

/** The audit fields for a change made by this actor. */
export const auditBy = (actor: StaffActor) => ({
  actorKind: "staff" as const,
  actorUserId: actor.userId,
  ...actor.request,
});
