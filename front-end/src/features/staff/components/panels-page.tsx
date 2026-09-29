import { panelInput, panelUpdateInput, type PanelInput, type PanelView } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ZodType } from "zod";

import {
  useStaffCheckPanelMutation,
  useStaffCreatePanelMutation,
  useStaffPanelsQuery,
  useStaffUpdatePanelMutation,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { errorText } from "@/lib/error-text";

import { formatDateTime } from "@/lib/format";
import { showSaveError } from "../form-errors";
import { CheckField, FormActions, SelectField, TextField } from "./fields";
import { Button, FormDialog, PageHeader, Placeholder, TableFrame } from "./staff-ui";

type PanelForm = PanelInput & { credentials?: PanelInput["credentials"] };

/** Add or edit a panel. Editing keeps the saved credentials unless asked to replace them. */
const PanelFormDialog = ({
  panel,
  open,
  onOpenChange,
}: {
  panel?: PanelView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const [create, creating] = useStaffCreatePanelMutation();
  const [update, updating] = useStaffUpdatePanelMutation();
  const [replace, setReplace] = React.useState(!panel);
  const schema = (panel ? panelUpdateInput : panelInput) as unknown as ZodType<PanelForm>;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={panel ? t("staff.panels.edit") : t("staff.panels.add")}
      description={t("staff.panels.description")}
    >
      <Form<PanelForm>
        schema={schema}
        options={{
          shouldUnregister: true,
          defaultValues: {
            name: panel?.name ?? "",
            driver: "pasarguard",
            baseUrl: panel?.baseUrl ?? "",
            subscriptionBaseUrl: panel?.subscriptionBaseUrl ?? "",
            isActive: panel?.isActive ?? true,
            credentials: { kind: "password", username: "", password: "" },
          },
        }}
        onSubmit={async (values, methods) => {
          try {
            if (panel) await update({ id: panel.id, body: values }).unwrap();
            else await create(values as PanelInput).unwrap();
            toast.success(t("staff.common.saved"));
            onOpenChange(false);
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {(methods) => {
          const kind = methods.watch("credentials.kind");
          return (
            <>
              <TextField<PanelForm> name="name" label={t("staff.panels.name")} autoFocus />
              <TextField<PanelForm>
                name="baseUrl"
                label={t("staff.panels.baseUrl")}
                hint={t("staff.panels.baseUrlHint")}
                dir="ltr"
                placeholder="https://panel.example.com"
              />
              <TextField<PanelForm>
                name="subscriptionBaseUrl"
                label={`${t("staff.panels.subscriptionBaseUrl")} (${t("staff.common.optional")})`}
                hint={t("staff.panels.subscriptionBaseUrlHint")}
                dir="ltr"
                placeholder="https://sub.example.com"
              />

              {panel ? (
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={replace}
                    onChange={(event) => setReplace(event.target.checked)}
                  />
                  {t("staff.panels.replaceCredentials")}
                </label>
              ) : null}

              {replace ? (
                <fieldset className="space-y-4 rounded-md border p-4">
                  <SelectField<PanelForm>
                    name="credentials.kind"
                    label={t("staff.panels.credentialKind")}
                    options={[
                      { value: "password", label: t("staff.panels.kindPassword") },
                      { value: "api_key", label: t("staff.panels.kindApiKey") },
                    ]}
                  />
                  {kind === "api_key" ? (
                    <TextField<PanelForm>
                      name="credentials.apiKey"
                      label={t("staff.panels.apiKey")}
                      dir="ltr"
                      autoComplete="off"
                    />
                  ) : (
                    <>
                      <TextField<PanelForm>
                        name="credentials.username"
                        label={t("staff.panels.username")}
                        dir="ltr"
                        autoComplete="off"
                      />
                      <TextField<PanelForm>
                        name="credentials.password"
                        label={t("staff.panels.password")}
                        type="password"
                        dir="ltr"
                        autoComplete="new-password"
                      />
                    </>
                  )}
                </fieldset>
              ) : (
                <p className="text-xs text-muted-foreground">{t("staff.panels.credentialsKept")}</p>
              )}

              <CheckField<PanelForm> name="isActive" label={t("staff.common.active")} />

              <FormActions>
                <Button type="submit" tone="primary" busy={creating.isLoading || updating.isLoading}>
                  {t("staff.common.save")}
                </Button>
                <Button onClick={() => onOpenChange(false)}>{t("staff.common.cancel")}</Button>
              </FormActions>
            </>
          );
        }}
      </Form>
    </FormDialog>
  );
};

const CheckButton = ({ id }: { id: string }) => {
  const { t } = useTranslation();
  const [check, { isLoading }] = useStaffCheckPanelMutation();
  return (
    <Button
      busy={isLoading}
      onClick={() =>
        check(id)
          .unwrap()
          .then(() => toast.success(t("staff.panels.healthy")))
          .catch((error: unknown) => toast.error(errorText(error)))
      }
    >
      {t("staff.panels.check")}
    </Button>
  );
};

export const PanelsPage = () => {
  const { t } = useTranslation();
  const { data: panels, isLoading, isError } = useStaffPanelsQuery();
  const [editing, setEditing] = React.useState<PanelView | "new">();

  return (
    <>
      <PageHeader
        title={t("staff.panels.title")}
        description={t("staff.panels.description")}
        actions={
          <Button tone="primary" onClick={() => setEditing("new")}>
            {t("staff.panels.add")}
          </Button>
        }
      />

      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : !panels?.length ? (
        <Placeholder>{t("staff.common.empty")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.panels.name")}</th>
              <th>{t("staff.panels.baseUrl")}</th>
              <th>{t("staff.panels.version")}</th>
              <th>{t("staff.panels.lastOk")}</th>
              <th>{t("staff.common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {panels.map((panel) => (
              <tr key={panel.id}>
                <td className="font-medium">
                  {panel.name}
                  {!panel.isActive ? (
                    <span className="ms-2 text-xs text-muted-foreground">({t("staff.common.inactive")})</span>
                  ) : null}
                </td>
                <td>
                  <bdi dir="ltr" className="font-mono text-xs">
                    {panel.baseUrl}
                  </bdi>
                </td>
                <td className="tabular-nums">{panel.version ?? "—"}</td>
                <td>
                  <div className="space-y-1">
                    <span>{formatDateTime(panel.lastOkAt)}</span>
                    {panel.lastError ? (
                      <p className="max-w-80 text-xs break-words text-destructive" dir="auto">
                        {panel.lastError}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="flex gap-2">
                    <CheckButton id={panel.id} />
                    <Button onClick={() => setEditing(panel)}>{t("staff.common.edit")}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {editing ? (
        <PanelFormDialog
          key={editing === "new" ? "new" : editing.id}
          panel={editing === "new" ? undefined : editing}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
    </>
  );
};
