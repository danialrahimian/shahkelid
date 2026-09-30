import type { AddTeamMemberInput, AuditPage, RoleView, TeamMember } from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/** The team and the audit log (/api/v1/staff). */

const STAFF = "/api/v1/staff";

export const teamApi = api.injectEndpoints({
  endpoints: (builder) => ({
    staffTeam: builder.query<TeamMember[], void>({
      query: () => `${STAFF}/team`,
      providesTags: ["StaffTeam"],
    }),
    staffRoles: builder.query<RoleView[], void>({
      query: () => `${STAFF}/roles`,
    }),
    staffAddTeamMember: builder.mutation<TeamMember[], AddTeamMemberInput>({
      query: (body) => ({ url: `${STAFF}/team`, method: "POST", body }),
      invalidatesTags: ["StaffTeam"],
    }),
    staffGrantRole: builder.mutation<{ roles: string[] }, { userId: string; roleKey: string }>({
      query: ({ userId, roleKey }) => ({ url: `${STAFF}/users/${userId}/roles/${roleKey}`, method: "POST" }),
      invalidatesTags: ["StaffTeam"],
    }),
    staffRevokeRole: builder.mutation<{ roles: string[] }, { userId: string; roleKey: string }>({
      query: ({ userId, roleKey }) => ({ url: `${STAFF}/users/${userId}/roles/${roleKey}`, method: "DELETE" }),
      invalidatesTags: ["StaffTeam"],
    }),
    staffAudit: builder.query<AuditPage, { before?: number; entityType?: string }>({
      query: ({ before, entityType }) => ({
        url: `${STAFF}/audit`,
        params: { limit: 50, ...(before ? { before } : {}), ...(entityType ? { entityType } : {}) },
      }),
    }),
  }),
});

export const {
  useStaffTeamQuery,
  useStaffRolesQuery,
  useStaffAddTeamMemberMutation,
  useStaffGrantRoleMutation,
  useStaffRevokeRoleMutation,
  useStaffAuditQuery,
} = teamApi;
