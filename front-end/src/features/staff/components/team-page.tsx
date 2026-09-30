import type { AuditEntryView, RoleView } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useStaffAddTeamMemberMutation,
  useStaffAuditQuery,
  useStaffGrantRoleMutation,
  useStaffRevokeRoleMutation,
  useStaffRolesQuery,
  useStaffTeamQuery,
} from "@/api/team";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/error-text";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button, ConfirmButton, PageHeader, Placeholder, Section, TableFrame } from "./staff-ui";

// ------------------------------------------------------------------- team

const selectClass =
  "h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

const AddMember = ({ roles }: { roles: RoleView[] }) => {
  const { t } = useTranslation();
  const [add, { isLoading }] = useStaffAddTeamMemberMutation();
  const [email, setEmail] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("support");

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add({ email, roleKey })
          .unwrap()
          .then(() => {
            setEmail("");
            toast.success(t("staff.team.added"));
          })
          .catch((error: unknown) => toast.error(errorText(error)));
      }}
    >
      <label className="space-y-1 text-sm">
        <span className="block font-medium">{t("staff.team.email")}</span>
        <Input
          type="email"
          required
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-9 w-72 max-w-full text-start"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">{t("staff.team.role")}</span>
        <select value={roleKey} onChange={(event) => setRoleKey(event.target.value)} className={selectClass}>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" tone="primary" busy={isLoading}>
        {t("staff.team.add")}
      </Button>
      <p className="w-full text-xs text-muted-foreground">{t("staff.team.addHint")}</p>
    </form>
  );
};

export const TeamPage = ({ canManage }: { canManage: boolean }) => {
  const { t } = useTranslation();
  const { data: team, isLoading } = useStaffTeamQuery();
  const { data: roles = [] } = useStaffRolesQuery();
  const [grant] = useStaffGrantRoleMutation();
  const [revoke] = useStaffRevokeRoleMutation();
  const nameOf = (key: string) => roles.find((role) => role.key === key)?.name ?? key;
  const fail = (error: unknown) => toast.error(errorText(error));

  return (
    <div className="space-y-8">
      <PageHeader title={t("staff.team.title")} description={t("staff.team.description")} />
      {canManage && roles.length ? <AddMember roles={roles} /> : null}

      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !team?.length ? (
        <Placeholder>{t("staff.common.empty")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.team.email")}</th>
              <th>{t("staff.team.roles")}</th>
              <th>{t("staff.team.twoFactor")}</th>
              <th>{t("staff.team.lastLogin")}</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => {
              const missing = roles.filter((role) => !member.roles.includes(role.key));
              return (
                <tr key={member.id}>
                  <td>
                    <bdi dir="ltr" className="font-medium">
                      {member.email}
                    </bdi>
                    {member.displayName ? <p className="text-xs text-muted-foreground">{member.displayName}</p> : null}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {member.roles.map((key) =>
                        canManage ? (
                          <ConfirmButton
                            key={key}
                            label={t("staff.team.revoke", { role: nameOf(key) })}
                            question={t("staff.team.revokeQuestion")}
                            onConfirm={() => revoke({ userId: member.id, roleKey: key }).unwrap().catch(fail)}
                          />
                        ) : (
                          <span key={key} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                            {nameOf(key)}
                          </span>
                        ),
                      )}
                      {canManage && missing.length ? (
                        <select
                          aria-label={t("staff.team.grant")}
                          value=""
                          onChange={(event) =>
                            event.target.value &&
                            grant({ userId: member.id, roleKey: event.target.value }).unwrap().catch(fail)
                          }
                          className={selectClass}
                        >
                          <option value="">{t("staff.team.grant")}</option>
                          {missing.map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </td>
                  <td
                    className={cn(
                      member.twoFactorEnabled ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {member.twoFactorEnabled ? t("staff.team.twoFactorOn") : t("staff.team.twoFactorOff")}
                  </td>
                  <td>{member.lastLoginAt ? formatDate(member.lastLoginAt) : t("staff.common.never")}</td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      )}

      <Section title={t("staff.team.permissions")}>
        <ul className="grid gap-3 md:grid-cols-2">
          {roles.map((role) => (
            <li key={role.key} className="space-y-1.5 rounded-lg border bg-card p-4">
              <p className="font-medium">{role.name}</p>
              <p className="text-xs leading-6 text-muted-foreground" dir="ltr">
                {role.permissions.join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
};

// ------------------------------------------------------------------ audit

const ENTITY_TYPES = ["user", "subscription", "order", "payment", "plan", "post", "ticket", "notification_template"] as const;

const AuditRows = ({ entries }: { entries: AuditEntryView[] }) => {
  const { t } = useTranslation();
  return (
    <>
      {entries.map((entry) => (
        <tr key={entry.id}>
          <td className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.occurredAt)}</td>
          <td>
            {entry.actorEmail ? (
              <bdi dir="ltr">{entry.actorEmail}</bdi>
            ) : entry.actorKind === "customer" ? (
              t("staff.audit.customer")
            ) : (
              t("staff.audit.system")
            )}
          </td>
          <td dir="ltr" className="text-start font-mono text-xs">
            {entry.action}
          </td>
          <td dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
            {entry.entityType}
            {entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ""}
          </td>
          <td>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{t("staff.audit.details")}</summary>
              <pre dir="ltr" className="mt-2 max-w-md overflow-x-auto rounded bg-muted p-2 text-start text-xs">
                {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
              </pre>
            </details>
          </td>
        </tr>
      ))}
    </>
  );
};

/** One page of the log; "older" fetches the next page below it. */
const AuditPageChunk = ({ before, entityType, onNext }: { before?: number; entityType?: string; onNext: (id: number) => void }) => {
  const { data } = useStaffAuditQuery({ before, entityType });
  React.useEffect(() => {
    if (data?.nextBefore) onNext(data.nextBefore);
  }, [data?.nextBefore, onNext]);
  return data ? <AuditRows entries={data.entries} /> : null;
};

/** The log under one filter; a new filter is a new one of these (keyed), starting from the top. */
const AuditLog = ({ entityType }: { entityType?: string }) => {
  const { t } = useTranslation();
  const [pages, setPages] = React.useState<(number | undefined)[]>([undefined]);
  const [next, setNext] = React.useState<number | null>(null);
  const first = useStaffAuditQuery({ entityType });
  const onNext = React.useCallback((id: number) => setNext(id), []);

  return first.isLoading ? (
    <Placeholder>{t("common.loading")}</Placeholder>
  ) : !first.data?.entries.length ? (
    <Placeholder>{t("staff.audit.empty")}</Placeholder>
  ) : (
    <>
      <TableFrame>
        <thead>
          <tr>
            <th>{t("staff.audit.when")}</th>
            <th>{t("staff.audit.who")}</th>
            <th>{t("staff.audit.what")}</th>
            <th>{t("staff.audit.on")}</th>
            <th>{t("staff.audit.details")}</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((before) => (
            <AuditPageChunk key={before ?? "first"} before={before} entityType={entityType} onNext={onNext} />
          ))}
        </tbody>
      </TableFrame>
      {next && !pages.includes(next) ? (
        <div className="flex justify-center">
          <Button onClick={() => setPages([...pages, next])}>{t("staff.audit.more")}</Button>
        </div>
      ) : null}
    </>
  );
};

export const AuditPage = () => {
  const { t } = useTranslation();
  const [entityType, setEntityType] = React.useState("");

  return (
    <div className="space-y-6">
      <PageHeader title={t("staff.audit.title")} description={t("staff.audit.description")} />
      <select
        aria-label={t("staff.audit.on")}
        value={entityType}
        onChange={(event) => setEntityType(event.target.value)}
        className={selectClass}
      >
        <option value="">{t("staff.audit.allTypes")}</option>
        {ENTITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <AuditLog key={entityType} entityType={entityType || undefined} />
    </div>
  );
};
