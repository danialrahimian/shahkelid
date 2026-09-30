import type { Compared, ReportRange } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  useStaffReportBreakdownQuery,
  useStaffReportCustomersQuery,
  useStaffReportRevenueQuery,
  useStaffReportSummaryQuery,
} from "@/api/reports";
import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LineChart } from "@/components/charts/line-chart";
import { colorForKey, SERIES_COLORS } from "@/components/charts/palette";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { groupPoints, lastDays, type Grouping } from "../reports";
import { PageHeader, Placeholder, Section, TableFrame } from "./staff-ui";

/**
 * Sales at a glance: the headline figures against the range before, revenue
 * over time, what sold and how it was paid for, and who paid most.
 */

const PRESETS = { week: 7, month: 30, quarter: 90, year: 365 } as const;

const dayLabel = (day: string, style: "short" | "long") =>
  new Intl.DateTimeFormat("fa-IR", {
    timeZone: "UTC",
    ...(style === "short" ? { month: "short", day: "numeric" } : { dateStyle: "medium" }),
  }).format(new Date(`${day}T00:00:00Z`));

const Tile = ({
  label,
  figure,
  format,
  detail,
}: {
  label: string;
  figure: Compared | number;
  format: (value: number) => string;
  detail?: string;
}) => {
  const { t } = useTranslation();
  const compared = typeof figure === "number" ? null : figure;
  const value = typeof figure === "number" ? figure : figure.value;
  return (
    <div className="space-y-1 rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{format(value)}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      {compared ? (
        <p
          className={cn(
            "text-xs tabular-nums",
            compared.change === null
              ? "text-muted-foreground"
              : compared.change >= 0
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300",
          )}
        >
          {compared.change === null
            ? t("staff.reports.noChange")
            : t("staff.reports.change", {
                change: `${compared.change > 0 ? "+" : ""}${formatNumber(compared.change)}٪`,
              })}
        </p>
      ) : null}
    </div>
  );
};

export const ReportsPage = () => {
  const { t } = useTranslation();
  const [range, setRange] = React.useState<ReportRange>(() => lastDays(PRESETS.month));
  const [grouping, setGrouping] = React.useState<Grouping>("day");
  const summary = useStaffReportSummaryQuery(range);
  const revenue = useStaffReportRevenueQuery(range);
  const breakdown = useStaffReportBreakdownQuery(range);
  const top = useStaffReportCustomersQuery(range);

  const points = React.useMemo(() => groupPoints(revenue.data ?? [], grouping), [revenue.data, grouping]);
  const planOrder = breakdown.data?.plans.map((row) => row.planId ?? row.name) ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title={t("staff.reports.title")} description={t("staff.reports.description")} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([key, days]) => {
            const preset = lastDays(days);
            const active = preset.from === range.from && preset.to === range.to;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setRange(preset)}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {t(`staff.reports.presets.${key as keyof typeof PRESETS}`)}
              </button>
            );
          })}
        </div>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t("staff.reports.from")}</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => event.target.value && setRange({ ...range, from: event.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t("staff.reports.to")}</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => event.target.value && setRange({ ...range, to: event.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {dayLabel(range.from, "long")} – {dayLabel(range.to, "long")}
        </p>
      </div>

      {summary.isError ? (
        <Placeholder>{errorText(summary.error)}</Placeholder>
      ) : !summary.data ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={t("staff.reports.revenue")} figure={summary.data.revenueToman} format={formatToman} />
          <Tile label={t("staff.reports.orders")} figure={summary.data.paidOrders} format={formatNumber} />
          <Tile label={t("staff.reports.average")} figure={summary.data.averageOrderToman} format={formatToman} />
          <Tile label={t("staff.reports.customers")} figure={summary.data.payingCustomers} format={formatNumber} />
          <Tile label={t("staff.reports.newAccounts")} figure={summary.data.newAccounts} format={formatNumber} />
          <Tile
            label={t("staff.reports.completion")}
            figure={summary.data.completionPercent ?? 0}
            format={(value) => `${formatNumber(value)}٪`}
            detail={t("staff.reports.completionDetail", {
              percent: `${formatNumber(summary.data.completionPercent ?? 0)}٪`,
              started: formatNumber(summary.data.startedOrders),
            })}
          />
          <Tile label={t("staff.reports.renewals")} figure={summary.data.renewals} format={formatNumber} />
          <Tile label={t("staff.reports.liveServices")} figure={summary.data.liveServices} format={formatNumber} />
        </div>
      )}

      <ChartFrame
        title={t("staff.reports.revenueChart")}
        action={
          <div role="group" aria-label={t("staff.reports.period")} className="flex rounded-lg border p-0.5">
            {(["day", "week", "month"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={grouping === candidate}
                onClick={() => setGrouping(candidate)}
                className={cn("h-7 rounded-md px-2 text-xs", grouping === candidate ? "bg-secondary" : "hover:bg-accent")}
              >
                {t(`staff.reports.group.${candidate}`)}
              </button>
            ))}
          </div>
        }
        table={{
          columns: [t("staff.reports.period"), t("staff.reports.revenue"), t("staff.reports.orders")],
          rows: points.map((row) => [dayLabel(row.day, "long"), formatToman(row.revenueToman), formatNumber(row.orders)]),
        }}
      >
        {revenue.isLoading ? (
          <Placeholder>{t("common.loading")}</Placeholder>
        ) : (
          <div dir="ltr">
            <LineChart
              labels={points.map((row) => dayLabel(row.day, "short"))}
              tooltipLabels={points.map((row) => dayLabel(row.day, "long"))}
              series={[
                {
                  key: "revenue",
                  label: t("staff.reports.revenue"),
                  color: SERIES_COLORS[0],
                  values: points.map((row) => row.revenueToman),
                },
              ]}
              formatValue={formatToman}
            />
          </div>
        )}
      </ChartFrame>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title={t("staff.reports.byPlan")}
          table={{
            columns: [t("staff.subscriptions.plan"), t("staff.reports.orders"), t("staff.reports.revenue"), t("staff.reports.share")],
            rows: (breakdown.data?.plans ?? []).map((row) => [
              row.name,
              formatNumber(row.orders),
              formatToman(row.revenueToman),
              `${formatNumber(row.sharePercent)}٪`,
            ]),
          }}
        >
          <BarChart
            data={(breakdown.data?.plans ?? []).map((row) => ({
              key: row.planId ?? row.name,
              label: row.name,
              value: row.revenueToman,
              color: colorForKey(row.planId ?? row.name, planOrder),
              detail: `${formatNumber(row.orders)} ${t("staff.reports.orders")}`,
            }))}
            formatValue={formatToman}
          />
        </ChartFrame>
        <ChartFrame
          title={t("staff.reports.byMethod")}
          table={{
            columns: [t("staff.orders.method"), t("staff.reports.orders"), t("staff.reports.revenue"), t("staff.reports.share")],
            rows: (breakdown.data?.methods ?? []).map((row) => [
              t(`shop.methods.${row.method as "zarinpal"}`),
              formatNumber(row.payments),
              formatToman(row.amountToman),
              `${formatNumber(row.sharePercent)}٪`,
            ]),
          }}
        >
          <BarChart
            data={(breakdown.data?.methods ?? []).map((row) => ({
              key: row.method,
              label: t(`shop.methods.${row.method as "zarinpal"}`),
              value: row.amountToman,
              color: colorForKey(row.method, ["zarinpal", "card_transfer", "usdt_tron", "nowpayments", "wallet"]),
              detail: `${formatNumber(row.payments)} ${t("staff.reports.orders")}`,
            }))}
            formatValue={formatToman}
          />
        </ChartFrame>
      </div>

      <Section title={t("staff.reports.top")}>
        {!top.data?.length ? (
          <Placeholder>{t("charts.empty")}</Placeholder>
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <th>{t("staff.customers.email")}</th>
                <th>{t("staff.reports.orders")}</th>
                <th>{t("staff.reports.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {top.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={paths.staffCustomer.getHref(row.id)} className="underline-offset-4 hover:underline">
                      <bdi dir="ltr">{row.email}</bdi>
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatNumber(row.orders)}</td>
                  <td className="tabular-nums">{formatToman(row.revenueToman)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>
    </div>
  );
};
