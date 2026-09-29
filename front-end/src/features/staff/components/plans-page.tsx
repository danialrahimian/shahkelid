import {
  BYTES_PER_GIGABYTE,
  TRAFFIC_RESETS,
  planInput,
  type PlanInput,
  type PlanView,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import {
  useStaffArchivePlanMutation,
  useStaffPanelsQuery,
  useStaffPlansQuery,
  useStaffSavePlanMutation,
} from "@/api/staff";
import { FieldError, Form } from "@/components/ui/form/form";
import { errorText } from "@/lib/error-text";

import { formatGb, formatNumber, formatToman } from "../format";
import { showSaveError } from "../form-errors";
import { parseGroups } from "../group-list";
import { CheckField, FormActions, NumberField, SelectField, TextField } from "./fields";
import { Button, ConfirmButton, FormDialog, PageHeader, Placeholder, TableFrame } from "./staff-ui";

/**
 * The plan form edits a plan the way staff think of it: tick the panels it
 * is sold on, and, only if needed, extra panel groups for each ("3, 5").
 * It becomes the API's shape (panels: [{ panelId, groupIds }]) on save.
 */
const groupList = z
  .string()
  .regex(/^[\d۰-۹\s,،]*$/, "NUMBER_OUT_OF_RANGE")
  .default("");

const planForm = planInput.omit({ panels: true }).extend({
  panelIds: z.array(z.string()).min(1, "GROUPS_REQUIRED"),
  extraGroups: z.record(groupList).default({}),
});
type PlanForm = z.input<typeof planForm>;

const PlanDialog = ({ plan, onClose }: { plan?: PlanView; onClose: () => void }) => {
  const { t } = useTranslation();
  const { data: panels = [] } = useStaffPanelsQuery();
  const [save, { isLoading }] = useStaffSavePlanMutation();

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={plan ? t("staff.plans.edit") : t("staff.plans.add")}
      description={t("staff.plans.description")}
    >
      <Form<PlanForm>
        schema={planForm as unknown as z.ZodType<PlanForm>}
        options={{
          defaultValues: {
            slug: plan?.slug ?? "",
            name: plan?.name ?? "",
            description: plan?.description ?? "",
            dataLimitGb:
              plan === undefined ? 50 : plan.dataLimitBytes === null ? null : plan.dataLimitBytes / BYTES_PER_GIGABYTE,
            durationDays: plan?.durationDays ?? 30,
            deviceLimit: plan === undefined ? 2 : plan.deviceLimit,
            trafficReset: plan?.trafficReset ?? "no_reset",
            priceToman: plan?.priceToman,
            isPublic: plan?.isPublic ?? true,
            isActive: plan?.isActive ?? true,
            sortOrder: plan?.sortOrder ?? 0,
            panelIds: plan?.panels.map((entry) => entry.panelId) ?? (panels[0] ? [panels[0].id] : []),
            extraGroups: Object.fromEntries(
              (plan?.panels ?? []).map((entry) => [entry.panelId, entry.groupIds.join(", ")]),
            ),
          },
        }}
        onSubmit={async (values, methods) => {
          const { panelIds, extraGroups, ...rest } = values;
          const body: PlanInput = {
            ...rest,
            panels: panelIds.map((panelId) => ({
              panelId,
              groupIds: parseGroups(extraGroups?.[panelId]),
            })),
          };
          try {
            await save({ id: plan?.id, body }).unwrap();
            toast.success(t("staff.common.saved"));
            onClose();
          } catch (error) {
            showSaveError(error, methods, { panels: "panelIds" });
          }
        }}
      >
        {(methods) => {
          const selected = methods.watch("panelIds") ?? [];
          const toggle = (id: string, on: boolean) =>
            methods.setValue(
              "panelIds",
              on ? [...selected, id] : selected.filter((entry) => entry !== id),
              { shouldValidate: true },
            );

          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<PlanForm> name="name" label={t("staff.plans.name")} placeholder="ماهانه ۵۰ گیگ" autoFocus />
                <TextField<PlanForm>
                  name="slug"
                  label={t("staff.plans.slug")}
                  hint={t("staff.plans.slugHint")}
                  dir="ltr"
                  placeholder="monthly-50"
                />
                <NumberField<PlanForm>
                  name="dataLimitGb"
                  label={t("staff.plans.volume")}
                  placeholder={t("staff.plans.unlimitedVolume")}
                />
                <NumberField<PlanForm> name="durationDays" label={t("staff.plans.duration")} />
                <NumberField<PlanForm>
                  name="deviceLimit"
                  label={t("staff.plans.deviceLimit")}
                  placeholder={t("staff.plans.noDeviceLimit")}
                />
                <NumberField<PlanForm> name="priceToman" label={t("staff.plans.price")} />
                <SelectField<PlanForm>
                  name="trafficReset"
                  label={t("staff.plans.trafficReset")}
                  options={TRAFFIC_RESETS.map((reset) => ({
                    value: reset,
                    label: t(`staff.plans.resets.${reset}`),
                  }))}
                />
                <NumberField<PlanForm> name="sortOrder" label={t("staff.plans.sortOrder")} />
              </div>
              <TextField<PlanForm> name="description" label={`${t("staff.plans.planDescription")} (${t("staff.common.optional")})`} />

              <fieldset className="space-y-3 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">{t("staff.plans.panels")}</legend>
                {panels.map((panel) => {
                  const on = selected.includes(panel.id);
                  return (
                    <div key={panel.id} className="space-y-2">
                      <label className="flex items-center gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={on}
                          onChange={(event) => toggle(panel.id, event.target.checked)}
                        />
                        {panel.name}
                      </label>
                      {on ? (
                        <TextField<PlanForm>
                          name={`extraGroups.${panel.id}`}
                          label={`${t("staff.plans.extraGroups")} (${t("staff.common.optional")})`}
                          hint={t("staff.plans.extraGroupsHint")}
                          dir="ltr"
                          className="ms-6"
                        />
                      ) : null}
                    </div>
                  );
                })}
                <FieldError name="panelIds" />
              </fieldset>

              <div className="flex flex-wrap gap-6">
                <CheckField<PlanForm> name="isActive" label={t("staff.plans.isActive")} />
                <CheckField<PlanForm> name="isPublic" label={t("staff.plans.isPublic")} />
              </div>

              <FormActions>
                <Button type="submit" tone="primary" busy={isLoading}>
                  {t("staff.common.save")}
                </Button>
                <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
              </FormActions>
            </>
          );
        }}
      </Form>
    </FormDialog>
  );
};

const ArchivePlan = ({ plan }: { plan: PlanView }) => {
  const { t } = useTranslation();
  const [archive, { isLoading }] = useStaffArchivePlanMutation();
  return (
    <ConfirmButton
      label={t("staff.common.archive")}
      question={t("staff.plans.archiveConfirm")}
      disabled={isLoading}
      onConfirm={() =>
        archive(plan.id)
          .unwrap()
          .then(() => toast.success(t("staff.common.saved")))
          .catch((error: unknown) => toast.error(errorText(error)))
      }
    />
  );
};

export const PlansPage = () => {
  const { t } = useTranslation();
  const plans = useStaffPlansQuery();
  const panels = useStaffPanelsQuery();
  const [editing, setEditing] = React.useState<PlanView | "new">();
  const hasPanel = (panels.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={t("staff.plans.title")}
        description={t("staff.plans.description")}
        actions={
          <Button tone="primary" disabled={!hasPanel} onClick={() => setEditing("new")}>
            {t("staff.plans.add")}
          </Button>
        }
      />

      {!hasPanel && !panels.isLoading ? (
        <Placeholder>{t("staff.plans.needPanel")}</Placeholder>
      ) : plans.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : plans.isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : !plans.data?.length ? (
        <Placeholder>{t("staff.common.empty")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.plans.name")}</th>
              <th>{t("staff.plans.volume")}</th>
              <th>{t("staff.plans.duration")}</th>
              <th>{t("staff.plans.deviceLimit")}</th>
              <th>{t("staff.plans.price")}</th>
              <th>{t("staff.servers.panel")}</th>
              <th>{t("staff.common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {plans.data.map((plan) => (
              <tr key={plan.id} className={plan.archivedAt || !plan.isActive ? "opacity-60" : undefined}>
                <td>
                  <p className="font-medium">{plan.name}</p>
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {plan.slug}
                  </p>
                  {plan.archivedAt ? (
                    <p className="text-xs text-muted-foreground">{t("staff.common.archived")}</p>
                  ) : !plan.isActive ? (
                    <p className="text-xs text-muted-foreground">{t("staff.common.inactive")}</p>
                  ) : null}
                </td>
                <td className="tabular-nums">{formatGb(plan.dataLimitBytes)}</td>
                <td className="tabular-nums">{t("staff.units.days", { amount: formatNumber(plan.durationDays) })}</td>
                <td className="tabular-nums">
                  {plan.deviceLimit === null
                    ? t("staff.common.unlimited")
                    : t("staff.units.devices", { amount: formatNumber(plan.deviceLimit) })}
                </td>
                <td className="tabular-nums">{formatToman(plan.priceToman)}</td>
                <td>{plan.panels.map((entry) => entry.panelName).join("، ")}</td>
                <td>
                  {plan.archivedAt ? null : (
                    <div className="flex gap-2">
                      <Button onClick={() => setEditing(plan)}>{t("staff.common.edit")}</Button>
                      <ArchivePlan plan={plan} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {editing ? (
        <PlanDialog plan={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
};
