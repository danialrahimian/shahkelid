import type { CryptoTransferView } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useStaffCryptoTransfersQuery, useStaffReviewCryptoTransferMutation } from "@/api/staff";
import { errorText } from "@/lib/error-text";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ConfirmButton, Placeholder, Section } from "./staff-ui";

/** "TGBCcH…WugVT": enough of an address or hash to recognise it. */
const short = (value: string) => (value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value);

const TransferCard = ({ transfer }: { transfer: CryptoTransferView }) => {
  const { t } = useTranslation();
  const [review, { isLoading }] = useStaffReviewCryptoTransferMutation();
  const [note, setNote] = React.useState("");
  const noteId = React.useId();
  const waiting = ["unmatched", "late", "wrong_amount"].includes(transfer.match);

  const decide = (decision: "settle" | "refunded" | "ignored") =>
    review({ id: transfer.id, body: { decision, note } })
      .unwrap()
      .then(() => toast.success(t("staff.crypto.done")))
      .catch((error: unknown) => toast.error(errorText(error)));

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums" dir="ltr">
          {transfer.amount} USDT
        </p>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            waiting ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
          )}
        >
          {t(`staff.crypto.matches.${transfer.match}`)}
        </span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("staff.crypto.from")}</dt>
          <dd dir="ltr" className="text-start font-mono">
            {short(transfer.fromAddress)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("staff.crypto.time")}</dt>
          <dd>{formatDateTime(transfer.blockTime)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("staff.crypto.transaction")}</dt>
          <dd>
            <a href={transfer.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              <bdi dir="ltr" className="font-mono">
                {short(transfer.txHash)}
              </bdi>{" "}
              · {t("staff.crypto.viewOnChain")}
            </a>
          </dd>
        </div>
      </dl>

      {transfer.suspected ? (
        <p className="rounded-md bg-muted/60 p-3 text-sm">
          {t("staff.crypto.suspected", {
            number: formatNumber(transfer.suspected.orderNumber),
            email: transfer.suspected.customerEmail,
            amount: `${transfer.suspected.amount} USDT`,
          })}
        </p>
      ) : null}

      {transfer.reviewNote ? <p className="text-sm text-muted-foreground">{transfer.reviewNote}</p> : null}

      {waiting ? (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-sm">
              {t("staff.crypto.note")}
            </label>
            <input
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {transfer.suspected ? (
              <ConfirmButton
                label={t("staff.crypto.settle")}
                question={t("staff.crypto.settleConfirm")}
                disabled={isLoading}
                onConfirm={() => void decide("settle")}
              />
            ) : null}
            <ConfirmButton
              label={t("staff.crypto.refunded")}
              question={t("staff.crypto.refundedConfirm")}
              disabled={isLoading}
              onConfirm={() => void decide("refunded")}
            />
            <ConfirmButton
              label={t("staff.crypto.ignored")}
              question={t("staff.crypto.ignoredConfirm")}
              tone="danger"
              disabled={isLoading}
              onConfirm={() => void decide("ignored")}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
};

/** USDT transfers that matched no open invoice, for staff to decide on. */
export const CryptoTransfersSection = () => {
  const { t } = useTranslation();
  const [which, setWhich] = React.useState<"waiting" | "decided">("waiting");
  const transfers = useStaffCryptoTransfersQuery(which, { pollingInterval: 60_000 });

  return (
    <Section
      title={t("staff.crypto.title")}
      actions={
        <div className="flex gap-1.5" role="group">
          {(["waiting", "decided"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={which === value}
              onClick={() => setWhich(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                which === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {t(`staff.payments.${value}`)}
            </button>
          ))}
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">{t("staff.crypto.description")}</p>
      {transfers.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !transfers.data?.length ? (
        <Placeholder>{which === "waiting" ? t("staff.crypto.empty") : t("staff.common.empty")}</Placeholder>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {transfers.data.map((transfer) => (
            <TransferCard key={transfer.id} transfer={transfer} />
          ))}
        </div>
      )}
    </Section>
  );
};
