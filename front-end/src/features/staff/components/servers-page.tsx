import {
  SERVER_STATUSES,
  locationInput,
  serverInput,
  type LocationInput,
  type LocationView,
  type ServerInput,
  type ServerView,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ZodType } from "zod";

import {
  useStaffArchiveServerMutation,
  useStaffLocationsQuery,
  useStaffPanelGroupsQuery,
  useStaffPanelsQuery,
  useStaffSaveLocationMutation,
  useStaffSaveServerMutation,
  useStaffServersQuery,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { errorText } from "@/lib/error-text";

import { formatNumber } from "@/lib/format";
import { showSaveError } from "../form-errors";
import { CheckField, FormActions, NumberField, SelectField, TextField } from "./fields";
import {
  Button,
  ConfirmButton,
  FormDialog,
  PageHeader,
  Placeholder,
  Section,
  TableFrame,
} from "./staff-ui";

// --------------------------------------------------------------- locations

const LocationDialog = ({
  location,
  onClose,
}: {
  location?: LocationView;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [save, { isLoading }] = useStaffSaveLocationMutation();
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={location ? t("staff.locations.edit") : t("staff.locations.add")}
    >
      <Form<LocationInput>
        schema={locationInput as unknown as ZodType<LocationInput>}
        options={{
          defaultValues: {
            code: location?.code ?? "",
            nameFa: location?.nameFa ?? "",
            nameEn: location?.nameEn ?? "",
            sortOrder: location?.sortOrder ?? 0,
            isActive: location?.isActive ?? true,
          },
        }}
        onSubmit={async (values, methods) => {
          try {
            await save({ id: location?.id, body: values }).unwrap();
            toast.success(t("staff.common.saved"));
            onClose();
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {() => (
          <>
            <TextField<LocationInput>
              name="code"
              label={t("staff.locations.code")}
              hint={t("staff.locations.codeHint")}
              dir="ltr"
              placeholder="DE-FRA"
              autoFocus
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField<LocationInput> name="nameFa" label={t("staff.locations.nameFa")} placeholder="آلمان، فرانکفورت" />
              <TextField<LocationInput> name="nameEn" label={t("staff.locations.nameEn")} dir="ltr" placeholder="Germany, Frankfurt" />
            </div>
            <NumberField<LocationInput> name="sortOrder" label={t("staff.locations.sortOrder")} />
            <CheckField<LocationInput> name="isActive" label={t("staff.common.active")} />
            <FormActions>
              <Button type="submit" tone="primary" busy={isLoading}>
                {t("staff.common.save")}
              </Button>
              <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
            </FormActions>
          </>
        )}
      </Form>
    </FormDialog>
  );
};

// ----------------------------------------------------------------- servers

/** The groups of the chosen panel, read from the panel itself. */
const GroupField = ({ panelId }: { panelId: string }) => {
  const { t } = useTranslation();
  const groups = useStaffPanelGroupsQuery(panelId, { skip: !panelId });
  return (
    <SelectField<ServerInput>
      name="panelGroupId"
      numeric
      label={t("staff.servers.group")}
      hint={
        groups.isFetching
          ? t("staff.servers.groupsLoading")
          : groups.isError
            ? errorText(groups.error)
            : t("staff.servers.groupHint")
      }
      placeholder="—"
      options={(groups.data ?? []).map((group) => ({
        value: String(group.id),
        label: `${group.name} (#${group.id})`,
      }))}
    />
  );
};

const ServerDialog = ({ server, onClose }: { server?: ServerView; onClose: () => void }) => {
  const { t } = useTranslation();
  const { data: panels = [] } = useStaffPanelsQuery();
  const { data: locations = [] } = useStaffLocationsQuery();
  const [save, { isLoading }] = useStaffSaveServerMutation();

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={server ? t("staff.servers.edit") : t("staff.servers.add")}
      description={t("staff.servers.description")}
    >
      <Form<ServerInput>
        schema={serverInput as unknown as ZodType<ServerInput>}
        options={{
          defaultValues: {
            panelId: server?.panelId ?? panels[0]?.id ?? "",
            locationId: server?.locationId ?? locations[0]?.id ?? "",
            name: server?.name ?? "",
            host: server?.host ?? "",
            panelGroupId: server?.panelGroupId ?? undefined,
            capacityUsers: server?.capacityUsers ?? 500,
            priority: server?.priority ?? 0,
            acceptingNew: server?.acceptingNew ?? true,
            status: server?.status ?? "online",
          },
        }}
        onSubmit={async (values, methods) => {
          try {
            await save({ id: server?.id, body: values }).unwrap();
            toast.success(t("staff.common.saved"));
            onClose();
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {(methods) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField<ServerInput>
                name="panelId"
                label={t("staff.servers.panel")}
                options={panels.map((panel) => ({ value: panel.id, label: panel.name }))}
              />
              <SelectField<ServerInput>
                name="locationId"
                label={t("staff.servers.location")}
                options={locations.map((location) => ({
                  value: location.id,
                  label: `${location.nameFa} (${location.code})`,
                }))}
              />
            </div>
            <GroupField panelId={methods.watch("panelId")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField<ServerInput> name="name" label={t("staff.servers.name")} dir="ltr" placeholder="de-fra-1" />
              <TextField<ServerInput> name="host" label={t("staff.servers.host")} dir="ltr" placeholder="de1.example.com" />
              <NumberField<ServerInput> name="capacityUsers" label={t("staff.servers.capacity")} />
              <NumberField<ServerInput>
                name="priority"
                label={t("staff.servers.priority")}
                hint={t("staff.servers.priorityHint")}
              />
            </div>
            <SelectField<ServerInput>
              name="status"
              label={t("staff.servers.status")}
              options={SERVER_STATUSES.map((status) => ({
                value: status,
                label: t(`staff.servers.statuses.${status}`),
              }))}
            />
            <CheckField<ServerInput> name="acceptingNew" label={t("staff.servers.acceptingNew")} />
            <FormActions>
              <Button type="submit" tone="primary" busy={isLoading}>
                {t("staff.common.save")}
              </Button>
              <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
            </FormActions>
          </>
        )}
      </Form>
    </FormDialog>
  );
};

const ArchiveServer = ({ server }: { server: ServerView }) => {
  const { t } = useTranslation();
  const [archive, { isLoading }] = useStaffArchiveServerMutation();
  return (
    <ConfirmButton
      label={t("staff.common.archive")}
      question={t("staff.servers.archiveConfirm")}
      disabled={isLoading}
      onConfirm={() =>
        archive(server.id)
          .unwrap()
          .then(() => toast.success(t("staff.common.saved")))
          .catch((error: unknown) => toast.error(errorText(error)))
      }
    />
  );
};

// -------------------------------------------------------------------- page

export const ServersPage = () => {
  const { t } = useTranslation();
  const panels = useStaffPanelsQuery();
  const locations = useStaffLocationsQuery();
  const servers = useStaffServersQuery();
  const [editingLocation, setEditingLocation] = React.useState<LocationView | "new">();
  const [editingServer, setEditingServer] = React.useState<ServerView | "new">();

  const canAddServer = (panels.data?.length ?? 0) > 0 && (locations.data?.length ?? 0) > 0;

  return (
    <div className="space-y-10">
      <PageHeader title={t("staff.nav.servers")} description={t("staff.servers.description")} />

      <Section
        title={t("staff.servers.title")}
        actions={
          <Button tone="primary" disabled={!canAddServer} onClick={() => setEditingServer("new")}>
            {t("staff.servers.add")}
          </Button>
        }
      >
        {!canAddServer && !panels.isLoading && !locations.isLoading ? (
          <Placeholder>{t("staff.servers.needPanelAndLocation")}</Placeholder>
        ) : servers.isLoading ? (
          <Placeholder>{t("common.loading")}</Placeholder>
        ) : !servers.data?.length ? (
          <Placeholder>{t("staff.common.empty")}</Placeholder>
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <th>{t("staff.servers.name")}</th>
                <th>{t("staff.servers.location")}</th>
                <th>{t("staff.servers.panel")}</th>
                <th>{t("staff.servers.load")}</th>
                <th>{t("staff.servers.priority")}</th>
                <th>{t("staff.servers.status")}</th>
                <th>{t("staff.common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {servers.data.map((server) => (
                <tr key={server.id} className={server.archivedAt ? "opacity-60" : undefined}>
                  <td>
                    <bdi dir="ltr" className="font-medium">
                      {server.name}
                    </bdi>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {server.host}
                    </p>
                  </td>
                  <td>{server.locationName}</td>
                  <td>{server.panelName}</td>
                  <td className="tabular-nums">
                    {formatNumber(server.liveSubscriptions)} / {formatNumber(server.capacityUsers)}
                  </td>
                  <td className="tabular-nums">{formatNumber(server.priority)}</td>
                  <td>
                    {server.archivedAt
                      ? t("staff.common.archived")
                      : t(`staff.servers.statuses.${server.status}`)}
                    {!server.archivedAt && !server.acceptingNew ? (
                      <p className="text-xs text-muted-foreground">✕ {t("staff.servers.acceptingNew")}</p>
                    ) : null}
                  </td>
                  <td>
                    {server.archivedAt ? null : (
                      <div className="flex gap-2">
                        <Button onClick={() => setEditingServer(server)}>{t("staff.common.edit")}</Button>
                        <ArchiveServer server={server} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>

      <Section
        title={t("staff.locations.title")}
        actions={<Button onClick={() => setEditingLocation("new")}>{t("staff.locations.add")}</Button>}
      >
        {!locations.data?.length ? (
          <Placeholder>{locations.isLoading ? t("common.loading") : t("staff.common.empty")}</Placeholder>
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <th>{t("staff.locations.code")}</th>
                <th>{t("staff.locations.nameFa")}</th>
                <th>{t("staff.locations.nameEn")}</th>
                <th>{t("staff.common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {locations.data.map((location) => (
                <tr key={location.id} className={location.isActive ? undefined : "opacity-60"}>
                  <td className="font-mono text-xs" dir="ltr">
                    {location.code}
                  </td>
                  <td>{location.nameFa}</td>
                  <td dir="ltr" className="text-start">
                    {location.nameEn}
                  </td>
                  <td>
                    <Button onClick={() => setEditingLocation(location)}>{t("staff.common.edit")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>

      {editingLocation ? (
        <LocationDialog
          location={editingLocation === "new" ? undefined : editingLocation}
          onClose={() => setEditingLocation(undefined)}
        />
      ) : null}
      {editingServer ? (
        <ServerDialog
          server={editingServer === "new" ? undefined : editingServer}
          onClose={() => setEditingServer(undefined)}
        />
      ) : null}
    </div>
  );
};
