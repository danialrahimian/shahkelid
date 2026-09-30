import { z } from "zod";

import { emailSchema } from "./auth.ts";

/**
 * The team: who works on the store, with which roles, and the record of
 * what staff did (the audit log).
 */

export type RoleView = {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  requires2fa: boolean;
  permissions: string[];
};

export type TeamMember = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  /** Whether their authenticator is set up; staff are asked to before anything else. */
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
};

/** Adds someone to the team by email; an address with no account gets one, already verified. */
export const addTeamMemberInput = z.object({
  email: emailSchema,
  roleKey: z.string().trim().min(1, "REQUIRED").max(64, "TOO_LONG"),
});
export type AddTeamMemberInput = z.input<typeof addTeamMemberInput>;

export type AuditEntryView = {
  id: number;
  occurredAt: string;
  actorKind: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
};

export type AuditPage = { entries: AuditEntryView[]; nextBefore: number | null };
