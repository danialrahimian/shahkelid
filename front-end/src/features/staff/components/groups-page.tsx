import type { GroupHostView, GroupSourceView, GroupView } from "@shah-kelid/contracts";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useStaffDeleteGroupMutation,
  useStaffGroupHostsQuery,
  useStaffGroupsQuery,
  useStaffOrderGroupHostsMutation,
  useStaffOrderGroupsMutation,
  useStaffPanelGroupsQuery,
  useStaffPanelsQuery,
  useStaffSaveGroupMutation,
  useStaffSetGroupSourcesMutation,
  useStaffUpdateGroupHostMutation,
} from "@/api/staff";
import { Input } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { errorText } from "@/lib/error-text";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button, ConfirmButton, FormDialog, PageHeader, Placeholder, Section } from "./staff-ui";

/**
 * Our groups, made the way PasarGuard's are: a group takes groups from the
 * connected panels (every host of each, or the ones ticked), each host can
 * be shown under a name of ours, and groups and hosts are put in order by
 * dragging (or with the arrows, from the keyboard). The order and names
 * are what the customer's link gives.
 *
 * Every change is saved at once; a failed save puts the list back.
 */

const VARIABLES = [
  "{USERNAME}",
  "{DATA_USAGE}",
  "{DATA_LEFT}",
  "{DATA_LIMIT}",
  "{DAYS_LEFT}",
  "{EXPIRE_DATE}",
  "{JALALI_EXPIRE_DATE}",
  "{STATUS_EMOJI}",
  "{PROTOCOL}",
  "{TRANSPORT}",
];

/** The order being dragged, while it still lists the same things as the server's; else the server's. */
const useOrder = (fromServer: string[]) => {
  const [dragged, setDragged] = React.useState<string[] | null>(null);
  const same =
    dragged !== null &&
    dragged.length === fromServer.length &&
    dragged.every((key) => fromServer.includes(key));
  return [same ? dragged : fromServer, setDragged] as const;
};

const move = <T,>(list: T[], index: number, by: -1 | 1) => {
  const next = [...list];
  const target = index + by;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

/** A row that is dragged by its handle only, so its buttons and fields still work. */
const DragRow = <T,>({
  value,
  label,
  onDrop,
  onUp,
  onDown,
  children,
  className,
  testId,
}: {
  value: T;
  label: string;
  onDrop: () => void;
  onUp?: () => void;
  onDown?: () => void;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) => {
  const { t } = useTranslation();
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="li"
      value={value}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      className={cn("flex items-start gap-2 rounded-lg border bg-card p-3", className)}
      data-testid={testId}
      whileDrag={{ scale: 1.01, boxShadow: "0 8px 24px rgb(0 0 0 / 0.15)", zIndex: 10 }}
    >
      <button
        type="button"
        aria-label={`${t("staff.groups.drag")}: ${label}`}
        title={t("staff.groups.drag")}
        className="mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
        onPointerDown={(event) => controls.start(event)}
        data-drag-handle
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex flex-col">
        <button
          type="button"
          aria-label={`${t("staff.groups.moveUp")}: ${label}`}
          disabled={!onUp}
          onClick={onUp}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`${t("staff.groups.moveDown")}: ${label}`}
          disabled={!onDown}
          onClick={onDown}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
};

// ------------------------------------------------------------- naming

const NameDialog = ({ group, onClose, onSaved }: { group?: GroupView; onClose: () => void; onSaved: (group: GroupView) => void }) => {
  const { t } = useTranslation();
  const [name, setName] = React.useState(group?.name ?? "");
  const [save, { isLoading }] = useStaffSaveGroupMutation();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const saved = await save({ id: group?.id, name }).unwrap();
      toast.success(t("staff.common.saved"));
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    }
  };
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={group ? t("staff.groups.rename") : t("staff.groups.add")}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("staff.groups.name")}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("staff.groups.namePlaceholder")} autoFocus />
        </label>
        <div className="flex gap-2">
          <Button type="submit" tone="primary" busy={isLoading} disabled={name.trim() === ""}>
            {t("staff.common.save")}
          </Button>
          <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
        </div>
      </form>
    </FormDialog>
  );
};

// ------------------------------------------------------------ sources

const AddSource = ({ onAdd, busy }: { onAdd: (source: GroupSourceView) => void; busy: boolean }) => {
  const { t } = useTranslation();
  const { data: panels = [] } = useStaffPanelsQuery();
  const [panelId, setPanelId] = React.useState("");
  const [panelGroupId, setPanelGroupId] = React.useState("");
  const groups = useStaffPanelGroupsQuery(panelId, { skip: !panelId });
  const panel = panels.find((candidate) => candidate.id === panelId);
  const chosen = groups.data?.find((group) => String(group.id) === panelGroupId);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Picker
        aria-label={t("staff.groups.panel")}
        value={panelId}
        placeholder={t("staff.groups.choosePanel")}
        onChange={(event) => {
          setPanelId(event.target.value);
          setPanelGroupId("");
        }}
      >
        {panels.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </Picker>
      <Picker
        aria-label={t("staff.groups.panelGroup")}
        value={panelGroupId}
        disabled={!panelId || groups.isFetching}
        placeholder={groups.isFetching ? t("staff.groups.groupsLoading") : t("staff.groups.choosePanelGroup")}
        onChange={(event) => setPanelGroupId(event.target.value)}
      >
        {(groups.data ?? []).map((group) => (
          <option key={group.id} value={String(group.id)}>
            {group.name} (#{group.id})
          </option>
        ))}
      </Picker>
      <Button
        busy={busy}
        disabled={!panel || !chosen}
        onClick={() => {
          if (!panel || !chosen) return;
          onAdd({ panelId: panel.id, panelName: panel.name, panelGroupId: chosen.id, panelGroupName: chosen.name, allHosts: true });
          setPanelGroupId("");
        }}
      >
        {t("staff.groups.addSource")}
      </Button>
      {groups.isError ? <p className="w-full text-xs text-destructive">{errorText(groups.error)}</p> : null}
    </div>
  );
};

const Sources = ({ group }: { group: GroupView }) => {
  const { t } = useTranslation();
  const [setSources, { isLoading }] = useStaffSetGroupSourcesMutation();
  const save = (sources: GroupSourceView[]) =>
    setSources({
      id: group.id,
      sources: sources.map(({ panelId, panelGroupId, allHosts }) => ({ panelId, panelGroupId, allHosts })),
    })
      .unwrap()
      .then(() => toast.success(t("staff.common.saved")))
      .catch((error: unknown) => toast.error(errorText(error)));

  return (
    <Section title={t("staff.groups.sources")}>
      <p className="text-sm leading-6 text-muted-foreground">{t("staff.groups.sourcesHint")}</p>
      {group.sources.length > 0 ? (
        <ul className="space-y-2">
          {group.sources.map((source, index) => (
            <li
              key={`${source.panelId}:${source.panelGroupId}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm"
              data-testid="group-source"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{source.panelName}</span>
                <span className="text-muted-foreground"> · </span>
                <bdi>{source.panelGroupName || "—"}</bdi>
                <span className="text-xs text-muted-foreground"> (#{source.panelGroupId})</span>
              </span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={source.allHosts}
                  disabled={isLoading}
                  onChange={(event) =>
                    save(group.sources.map((each, at) => (at === index ? { ...each, allHosts: event.target.checked } : each)))
                  }
                />
                {t("staff.groups.allHosts")}
              </label>
              <Button tone="ghost" disabled={isLoading} onClick={() => save(group.sources.filter((_, at) => at !== index))}>
                {t("staff.groups.remove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <AddSource
        busy={isLoading}
        onAdd={(source) => {
          if (group.sources.some((each) => each.panelId === source.panelId && each.panelGroupId === source.panelGroupId)) return;
          void save([...group.sources, source]);
        }}
      />
    </Section>
  );
};

// -------------------------------------------------------------- hosts

const keyOf = (host: Pick<GroupHostView, "panelId" | "hostId">) => `${host.panelId}:${host.hostId}`;

/** Our name for a host: saved when the field is left or Enter is pressed. */
const HostName = ({ host, onSave }: { host: GroupHostView; onSave: (name: string | null) => void }) => {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(host.name ?? "");
  const commit = () => {
    const next = value.trim();
    if (next === (host.name ?? "")) return;
    onSave(next === "" ? null : next);
  };
  return (
    <Input
      value={value}
      dir="auto"
      aria-label={`${t("staff.groups.hostName")}: ${host.remark}`}
      placeholder={host.remark}
      className="h-8 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
};

const Hosts = ({ group }: { group: GroupView }) => {
  const { t } = useTranslation();
  const hosts = useStaffGroupHostsQuery(group.id);
  const [updateHost] = useStaffUpdateGroupHostMutation();
  const [orderHosts] = useStaffOrderGroupHostsMutation();
  const byKey = React.useMemo(() => new Map((hosts.data?.hosts ?? []).map((host) => [keyOf(host), host])), [hosts.data]);
  const [keys, setKeys] = useOrder((hosts.data?.hosts ?? []).map(keyOf));

  const saveOrder = (next: string[]) => {
    setKeys(next);
    orderHosts({
      id: group.id,
      hosts: next.map((key) => {
        const host = byKey.get(key)!;
        return { panelId: host.panelId, hostId: host.hostId };
      }),
    })
      .unwrap()
      .then(() => toast.success(t("staff.groups.orderSaved")))
      .catch((error: unknown) => {
        toast.error(errorText(error));
        setKeys(null);
      });
  };
  const change = (host: GroupHostView, body: { selected?: boolean; name?: string | null }) =>
    updateHost({ id: group.id, panelId: host.panelId, hostId: host.hostId, change: body })
      .unwrap()
      .then(() => toast.success(t("staff.common.saved")))
      .catch((error: unknown) => toast.error(errorText(error)));

  return (
    <Section title={t("staff.groups.hosts")}>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("staff.groups.hostsHint")}{" "}
        <bdi dir="ltr" className="font-mono text-xs">
          {VARIABLES.join(" ")}
        </bdi>
      </p>
      {(hosts.data?.unreachable ?? []).map((panel) => (
        <p key={panel.panelId} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" dir="auto">
          {t("staff.groups.unreachable", { panel: panel.panelName, error: panel.error })}
        </p>
      ))}
      {hosts.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : hosts.isError ? (
        <Placeholder>{errorText(hosts.error)}</Placeholder>
      ) : keys.length === 0 ? (
        <Placeholder>{t("staff.groups.noHosts")}</Placeholder>
      ) : (
        <Reorder.Group as="ul" axis="y" values={keys} onReorder={setKeys} className="space-y-2" data-testid="group-hosts">
          {keys.map((key, index) => {
            const host = byKey.get(key);
            if (!host) return null;
            return (
              <DragRow
                key={key}
                value={key}
                label={host.name ?? host.remark}
                testId="group-host"
                onDrop={() => saveOrder(keys)}
                onUp={index > 0 ? () => saveOrder(move(keys, index, -1)) : undefined}
                onDown={index < keys.length - 1 ? () => saveOrder(move(keys, index, 1)) : undefined}
                className={cn(!host.selected && "opacity-60")}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex items-center gap-2" title={host.forced ? t("staff.groups.forced") : undefined}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={host.selected}
                      disabled={host.forced}
                      aria-label={host.remark}
                      onChange={(event) => change(host, { selected: event.target.checked })}
                    />
                  </label>
                  <bdi dir="auto" className={cn("font-medium", host.name && "text-muted-foreground line-through decoration-1")}>
                    {host.remark}
                  </bdi>
                  {host.protocol ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] uppercase" dir="ltr">
                      {host.protocol}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{host.panelName}</span>
                  {host.disabledOnPanel ? (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                      {t("staff.groups.disabledOnPanel")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2">
                  <HostName key={host.name ?? ""} host={host} onSave={(name) => change(host, { name })} />
                </div>
              </DragRow>
            );
          })}
        </Reorder.Group>
      )}
    </Section>
  );
};

// -------------------------------------------------------------- the page

const GroupDetail = ({ group }: { group: GroupView }) => {
  const { t } = useTranslation();
  const [renaming, setRenaming] = React.useState(false);
  const [remove, { isLoading: removing }] = useStaffDeleteGroupMutation();
  return (
    <div className="space-y-8" data-testid="group-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{group.name}</h2>
          <p className="text-sm text-muted-foreground">
            {t("staff.groups.plans")}: {group.plans.length > 0 ? group.plans.map((plan) => plan.name).join("، ") : "—"} ·{" "}
            {t("staff.groups.customers", { count: group.subscriptions, formatted: formatNumber(group.subscriptions) })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRenaming(true)}>{t("staff.groups.rename")}</Button>
          <ConfirmButton
            tone="danger"
            label={t("staff.common.delete")}
            question={t("staff.groups.deleteConfirm")}
            disabled={removing}
            onConfirm={() =>
              remove(group.id)
                .unwrap()
                .then(() => toast.success(t("staff.common.saved")))
                .catch((error: unknown) => toast.error(errorText(error)))
            }
          />
        </div>
      </div>
      <Sources group={group} />
      <Hosts group={group} />
      {renaming ? <NameDialog group={group} onClose={() => setRenaming(false)} onSaved={() => undefined} /> : null}
    </div>
  );
};

export const GroupsPage = () => {
  const { t } = useTranslation();
  const groups = useStaffGroupsQuery();
  const panels = useStaffPanelsQuery();
  const [orderGroups] = useStaffOrderGroupsMutation();
  const [ids, setIds] = useOrder((groups.data ?? []).map((group) => group.id));
  const [chosen, setChosen] = React.useState<string>();
  const [adding, setAdding] = React.useState(false);
  const byId = new Map((groups.data ?? []).map((group) => [group.id, group]));
  const current = byId.get(chosen ?? "") ?? groups.data?.[0];
  const hasPanel = (panels.data?.length ?? 0) > 0;

  const saveOrder = (next: string[]) => {
    setIds(next);
    orderGroups(next)
      .unwrap()
      .then(() => toast.success(t("staff.groups.orderSaved")))
      .catch((error: unknown) => {
        toast.error(errorText(error));
        setIds(null);
      });
  };

  return (
    <>
      <PageHeader
        title={t("staff.groups.title")}
        description={t("staff.groups.description")}
        actions={
          <Button tone="primary" disabled={!hasPanel} onClick={() => setAdding(true)}>
            {t("staff.groups.add")}
          </Button>
        }
      />

      {!hasPanel && !panels.isLoading ? (
        <Placeholder>{t("staff.groups.needPanel")}</Placeholder>
      ) : groups.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : groups.isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : ids.length === 0 ? (
        <Placeholder>{t("staff.groups.empty")}</Placeholder>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Reorder.Group as="ul" axis="y" values={ids} onReorder={setIds} className="space-y-2" data-testid="groups-list">
            {ids.map((id, index) => {
              const group = byId.get(id);
              if (!group) return null;
              const active = current?.id === id;
              return (
                <DragRow
                  key={id}
                  value={id}
                  label={group.name}
                  testId="group-row"
                  onDrop={() => saveOrder(ids)}
                  onUp={index > 0 ? () => saveOrder(move(ids, index, -1)) : undefined}
                  onDown={index < ids.length - 1 ? () => saveOrder(move(ids, index, 1)) : undefined}
                  className={cn(active && "border-primary ring-1 ring-primary")}
                >
                  <button type="button" className="w-full text-start" onClick={() => setChosen(id)} aria-pressed={active}>
                    <p className="font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.sources.length > 0
                        ? group.sources.map((source) => `${source.panelName} · ${source.panelGroupName || source.panelGroupId}`).join("، ")
                        : t("staff.groups.noSources")}
                    </p>
                  </button>
                </DragRow>
              );
            })}
          </Reorder.Group>
          {current ? <GroupDetail key={current.id} group={current} /> : <Placeholder>{t("staff.groups.pick")}</Placeholder>}
        </div>
      )}

      {adding ? <NameDialog onClose={() => setAdding(false)} onSaved={(group) => setChosen(group.id)} /> : null}
    </>
  );
};
