import { LOG_SOURCES, type LogEntryView, type LogSource } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { useStaffLogsQuery, type LogFilter } from "@/api/logs";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Picker } from "@/components/ui/picker";

import { Button, PageHeader, Placeholder, TableFrame } from "./staff-ui";

/**
 * The owner's log of everything: what staff did, orders and payments as they
 * move, subscriptions, alerts and system events, emails to customers,
 * support and accounts, newest first. Entries keep the server's English:
 * they are the same words the alerts and the server's own logs use.
 */

const selectClass =
  "h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

type Cursor = { beforeAt: string; beforeKey: string };

const Rows = ({ entries }: { entries: LogEntryView[] }) => {
  const { t } = useTranslation();
  return (
    <>
      {entries.map((entry) => (
        <tr key={entry.key} className={cn(entry.problem && "bg-destructive/5")}>
          <td className="whitespace-nowrap tabular-nums">{formatDateTime(entry.at)}</td>
          <td className="whitespace-nowrap">
            <span className={cn(entry.problem && "font-medium text-destructive")}>{t(`staff.logs.sources.${entry.source}`)}</span>
          </td>
          <td>
            <bdi dir="ltr" className="font-mono text-xs">
              {entry.kind}
            </bdi>
          </td>
          <td>
            <bdi dir="ltr" className="text-xs">
              {entry.actor ?? "—"}
            </bdi>
          </td>
          <td className="max-w-[28rem]">
            <p dir="ltr" className="text-start text-sm break-words">
              {entry.summary}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">{t("staff.logs.details")}</summary>
              <pre dir="ltr" className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 text-start text-xs whitespace-pre-wrap">
                {JSON.stringify({ entity: entry.entity, ...(entry.details as object) }, null, 2)}
              </pre>
            </details>
          </td>
        </tr>
      ))}
    </>
  );
};

/** One page of the log; tells the list where the next one starts. */
const Chunk = ({ filter, cursor, onNext }: { filter: LogFilter; cursor?: Cursor; onNext: (next: Cursor | null) => void }) => {
  const { data } = useStaffLogsQuery({ ...filter, ...cursor });
  React.useEffect(() => {
    if (data) onNext(data.next);
  }, [data, onNext]);
  return data ? <Rows entries={data.entries} /> : null;
};

/** The log under one filter; a new filter is a new one of these (keyed), starting from the top. */
const Log = ({ filter }: { filter: LogFilter }) => {
  const { t } = useTranslation();
  const [cursors, setCursors] = React.useState<(Cursor | undefined)[]>([undefined]);
  const [next, setNext] = React.useState<Cursor | null>(null);
  const first = useStaffLogsQuery(filter);
  const onNext = React.useCallback((cursor: Cursor | null) => setNext(cursor), []);
  const shown = (cursor: Cursor) => cursors.some((c) => c?.beforeKey === cursor.beforeKey);

  if (first.isLoading) return <Placeholder>{t("common.loading")}</Placeholder>;
  if (first.isError) return <Placeholder>{t("staff.common.loadFailed")}</Placeholder>;
  if (!first.data?.entries.length) return <Placeholder>{t("staff.logs.empty")}</Placeholder>;
  return (
    <>
      <TableFrame>
        <thead>
          <tr>
            <th>{t("staff.logs.when")}</th>
            <th>{t("staff.logs.source")}</th>
            <th>{t("staff.logs.what")}</th>
            <th>{t("staff.logs.who")}</th>
            <th>{t("staff.logs.summary")}</th>
          </tr>
        </thead>
        <tbody>
          {cursors.map((cursor) => (
            <Chunk key={cursor?.beforeKey ?? "first"} filter={filter} cursor={cursor} onNext={onNext} />
          ))}
        </tbody>
      </TableFrame>
      {next && !shown(next) ? (
        <div className="flex justify-center">
          <Button onClick={() => setCursors([...cursors, next])}>{t("staff.logs.more")}</Button>
        </div>
      ) : null}
    </>
  );
};

export const LogsPage = () => {
  const { t } = useTranslation();
  const [source, setSource] = React.useState<LogSource | "">("");
  const [problems, setProblems] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const timer = window.setTimeout(() => setQ(typed.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const filter: LogFilter = { source: source || undefined, q: q || undefined, problems };
  return (
    <div className="space-y-6">
      <PageHeader title={t("staff.logs.title")} description={t("staff.logs.description")} />
      <div className="flex flex-wrap items-center gap-3">
        <Picker
          aria-label={t("staff.logs.source")}
          value={source}
          onChange={(event) => setSource(event.target.value as LogSource | "")}
          className={selectClass}
        >
          <option value="">{t("staff.logs.allSources")}</option>
          {LOG_SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(`staff.logs.sources.${value}`)}
            </option>
          ))}
        </Picker>
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t("staff.logs.search")}
          aria-label={t("staff.logs.search")}
          dir="auto"
          className="h-9 w-64"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={problems} onChange={(event) => setProblems(event.target.checked)} />
          {t("staff.logs.problemsOnly")}
        </label>
      </div>
      <Log key={`${source}|${q}|${problems}`} filter={filter} />
    </div>
  );
};
