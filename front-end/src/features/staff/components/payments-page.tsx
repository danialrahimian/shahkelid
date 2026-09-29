import {
  paymentCardInput,
  type PaymentCardInput,
  type ReceiptReviewView,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import type { ZodType } from "zod";

import {
  receiptImageUrl,
  useStaffPaymentCardsQuery,
  useStaffReceiptsQuery,
  useStaffReviewReceiptMutation,
  useStaffSavePaymentCardMutation,
  type StaffPaymentCard,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { env } from "@/config/env";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatDateTime, formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { showSaveError } from "../form-errors";
import { CryptoTransfersSection } from "./crypto-transfers-section";
import { CheckField, FormActions, NumberField, TextField } from "./fields";
import { Button, ConfirmButton, FormDialog, PageHeader, Placeholder, Section, TableFrame } from "./staff-ui";

/** Card numbers in groups of four, left to right. */
const grouped = (number: string) => number.match(/.{1,4}/g)?.join(" ") ?? number;

// ---------------------------------------------------------------- receipts

const Row = ({ label, children, alert }: { label: string; children: React.ReactNode; alert?: boolean }) => (
  <div className="flex flex-wrap justify-between gap-2 py-1.5 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className={cn("tabular-nums", alert && "font-semibold text-amber-700 dark:text-amber-300")}>{children}</dd>
  </div>
);

const RejectForm = ({ paymentId, onDone }: { paymentId: string; onDone: () => void }) => {
  const { t } = useTranslation();
  const [review, { isLoading }] = useStaffReviewReceiptMutation();
  const [note, setNote] = React.useState("");
  const id = React.useId();
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        review({ paymentId, body: { decision: "reject", note } })
          .unwrap()
          .then(() => {
            toast.success(t("staff.payments.rejected"));
            onDone();
          })
          .catch((error: unknown) => toast.error(errorText(error)));
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {t("staff.payments.rejectNote")}
      </label>
      <textarea
        id={id}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        required
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <div className="flex gap-2">
        <Button type="submit" tone="danger" busy={isLoading} disabled={!note.trim()}>
          {t("staff.payments.reject")}
        </Button>
        <Button onClick={onDone}>{t("staff.common.cancel")}</Button>
      </div>
    </form>
  );
};

const ReceiptCard = ({ receipt }: { receipt: ReceiptReviewView }) => {
  const { t } = useTranslation();
  const [review, { isLoading }] = useStaffReviewReceiptMutation();
  const [rejecting, setRejecting] = React.useState(false);
  const image = receiptImageUrl(env.API_URL, receipt.paymentId);
  const waiting = receipt.status === "pending_review";

  return (
    <article className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[minmax(0,14rem)_1fr]">
      <a href={image} target="_blank" rel="noreferrer" title={t("staff.payments.openImage")} className="block">
        <img
          src={image}
          alt={t("staff.payments.imageAlt")}
          loading="lazy"
          className="max-h-72 w-full rounded-md border bg-muted object-contain"
        />
      </a>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">
            {t("staff.payments.order")} {formatNumber(receipt.orderNumber)} · {receipt.planName}
          </p>
          {!waiting ? (
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                receipt.status === "succeeded"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-500/10 text-red-700 dark:text-red-300",
              )}
            >
              {t(`staff.payments.result.${receipt.status === "succeeded" ? "succeeded" : "failed"}`)}
            </span>
          ) : null}
        </div>

        {receipt.flags.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="flags">
            {receipt.flags.map((flag) => (
              <li
                key={flag}
                className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                ⚠ {t(`staff.payments.flags.${flag}`)}
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="divide-y">
          <Row label={t("staff.payments.customer")}>
            <Link to={paths.staffCustomer.getHref(receipt.customer.id)} className="underline-offset-4 hover:underline">
              <bdi dir="ltr">{receipt.customer.email}</bdi>
            </Link>
          </Row>
          <Row label={t("staff.payments.amount")}>{formatToman(receipt.orderTotalToman)}</Row>
          <Row label={t("staff.payments.claimed")} alert={receipt.flags.includes("amount_mismatch")}>
            {formatToman(receipt.claimedAmountToman)}
          </Row>
          <Row label={t("staff.payments.tracking")} alert={receipt.flags.includes("duplicate_tracking")}>
            <bdi dir="ltr" className="font-mono">
              {receipt.trackingNumber}
            </bdi>
          </Row>
          <Row label={t("staff.payments.card")}>
            {receipt.destinationCard.label} · <bdi dir="ltr">{grouped(receipt.destinationCard.cardNumber)}</bdi>
          </Row>
          {receipt.payerCardLast4 ? (
            <Row label={t("staff.payments.last4")}>
              <bdi dir="ltr">…{receipt.payerCardLast4}</bdi>
            </Row>
          ) : null}
          <Row label={t("staff.payments.submitted")}>{formatDateTime(receipt.submittedAt)}</Row>
          {!waiting && receipt.reviewerEmail ? (
            <Row label={t("staff.payments.reviewer")}>
              <bdi dir="ltr">{receipt.reviewerEmail}</bdi>
            </Row>
          ) : null}
          {receipt.reviewNote ? <Row label={t("staff.payments.note")}>{receipt.reviewNote}</Row> : null}
        </dl>

        {waiting ? (
          rejecting ? (
            <RejectForm paymentId={receipt.paymentId} onDone={() => setRejecting(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <ConfirmButton
                label={t("staff.payments.approve")}
                question={t("staff.payments.approveConfirm")}
                disabled={isLoading}
                onConfirm={() =>
                  review({ paymentId: receipt.paymentId, body: { decision: "approve" } })
                    .unwrap()
                    .then(() => toast.success(t("staff.payments.approved")))
                    .catch((error: unknown) => toast.error(errorText(error)))
                }
              />
              <Button tone="danger" onClick={() => setRejecting(true)}>
                {t("staff.payments.reject")}
              </Button>
            </div>
          )
        ) : null}
      </div>
    </article>
  );
};

// ------------------------------------------------------------------- cards

const CardDialog = ({ card, onClose }: { card?: StaffPaymentCard; onClose: () => void }) => {
  const { t } = useTranslation();
  const [save, { isLoading }] = useStaffSavePaymentCardMutation();
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={card ? t("staff.cards.edit") : t("staff.cards.add")}>
      <Form<PaymentCardInput>
        schema={paymentCardInput as unknown as ZodType<PaymentCardInput>}
        options={{
          defaultValues: {
            label: card?.label ?? "",
            bankName: card?.bankName ?? "",
            cardNumber: card?.cardNumber ?? "",
            holderName: card?.holderName ?? "",
            isActive: card?.isActive ?? true,
            sortOrder: card?.sortOrder ?? 0,
          },
        }}
        onSubmit={async (values, methods) => {
          try {
            await save({ id: card?.id, body: values }).unwrap();
            toast.success(t("staff.common.saved"));
            onClose();
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {() => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField<PaymentCardInput> name="label" label={t("staff.cards.label")} autoFocus />
              <TextField<PaymentCardInput> name="bankName" label={t("staff.cards.bankName")} />
            </div>
            <TextField<PaymentCardInput>
              name="cardNumber"
              label={t("staff.cards.cardNumber")}
              dir="ltr"
              inputMode="numeric"
              placeholder="6104 3378 1234 5678"
            />
            <TextField<PaymentCardInput> name="holderName" label={t("staff.cards.holderName")} />
            <NumberField<PaymentCardInput> name="sortOrder" label={t("staff.cards.sortOrder")} />
            <CheckField<PaymentCardInput> name="isActive" label={t("staff.common.active")} />
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

const CardsSection = () => {
  const { t } = useTranslation();
  const { data: cards, isLoading } = useStaffPaymentCardsQuery();
  const [editing, setEditing] = React.useState<StaffPaymentCard | "new">();

  return (
    <Section
      title={t("staff.cards.title")}
      actions={<Button onClick={() => setEditing("new")}>{t("staff.cards.add")}</Button>}
    >
      <p className="text-sm text-muted-foreground">{t("staff.cards.description")}</p>
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !cards?.length ? (
        <Placeholder>{t("staff.common.empty")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.cards.label")}</th>
              <th>{t("staff.cards.cardNumber")}</th>
              <th>{t("staff.cards.holderName")}</th>
              <th>{t("staff.common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className={card.isActive ? undefined : "opacity-60"}>
                <td>
                  {card.label}
                  <p className="text-xs text-muted-foreground">{card.bankName}</p>
                </td>
                <td>
                  <bdi dir="ltr" className="font-mono">
                    {grouped(card.cardNumber)}
                  </bdi>
                </td>
                <td>{card.holderName}</td>
                <td>
                  <Button onClick={() => setEditing(card)}>{t("staff.common.edit")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
      {editing ? <CardDialog card={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} /> : null}
    </Section>
  );
};

// -------------------------------------------------------------------- page

export const PaymentsPage = ({ canReview, canManageCards }: { canReview: boolean; canManageCards: boolean }) => {
  const { t } = useTranslation();
  const [which, setWhich] = React.useState<"waiting" | "decided">("waiting");
  const receipts = useStaffReceiptsQuery(which, { skip: !canReview, pollingInterval: 60_000 });

  return (
    <div className="space-y-10">
      <PageHeader title={t("staff.payments.title")} description={t("staff.payments.description")} />

      {canReview ? (
        <section className="space-y-4">
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
                {value === "waiting" && which === "waiting" && receipts.data?.length
                  ? ` (${formatNumber(receipts.data.length)})`
                  : ""}
              </button>
            ))}
          </div>
          {receipts.isLoading ? (
            <Placeholder>{t("common.loading")}</Placeholder>
          ) : receipts.isError ? (
            <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
          ) : !receipts.data?.length ? (
            <Placeholder>{which === "waiting" ? t("staff.payments.empty") : t("staff.common.empty")}</Placeholder>
          ) : (
            <div className="space-y-4">
              {receipts.data.map((receipt) => (
                <ReceiptCard key={receipt.paymentId} receipt={receipt} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {canReview ? <CryptoTransfersSection /> : null}

      {canManageCards ? <CardsSection /> : null}
    </div>
  );
};
