import { cardTransferInput, type CardTransferInput } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ZodType } from "zod";

import { useShopCardsQuery, useShopPayCardMutation } from "@/api/shop";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { Label } from "@/components/ui/label";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";
import { formatToman } from "@/lib/format";

/** Card numbers read in groups of four, left to right, whatever the page direction. */
const grouped = (number: string) => number.match(/.{1,4}/g)?.join(" ") ?? number;

/**
 * Card to card: the cards to transfer to, then what the customer fills in
 * once they have: which card, the tracking number, the amount, the last
 * four digits of their own card, and a picture of the receipt.
 */
export const CardTransferForm = ({
  orderId,
  amountToman,
  onSent,
}: {
  orderId: string;
  amountToman: number;
  onSent: () => void;
}) => {
  const { t } = useTranslation();
  const { data: cards, isLoading } = useShopCardsQuery();
  const [pay, { isLoading: isSending }] = useShopPayCardMutation();
  const [receipt, setReceipt] = React.useState<File>();
  const [receiptError, setReceiptError] = React.useState<string>();
  const receiptId = React.useId();

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!cards?.length) return <p className="text-sm text-muted-foreground">{t("shop.card.noCards")}</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm leading-6">{t("shop.card.transferTo", { amount: formatToman(amountToman) })}</p>
      <ul className="space-y-3">
        {cards.map((card) => (
          <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{card.bankName}</p>
              <p dir="ltr" className="text-start font-mono text-lg tracking-wider tabular-nums">
                {grouped(card.cardNumber)}
              </p>
              <p className="text-sm">{t("shop.card.holder", { name: card.holderName })}</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(card.cardNumber).then(() => toast.success(t("shop.card.copied")))
              }
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t("shop.card.copy")}
            </button>
          </li>
        ))}
      </ul>

      <Form<CardTransferInput>
        schema={cardTransferInput as unknown as ZodType<CardTransferInput>}
        options={{
          defaultValues: {
            destinationCardId: cards[0]!.id,
            trackingNumber: "",
            claimedAmountToman: String(amountToman),
            payerCardLast4: "",
          },
        }}
        onSubmit={async (values, methods) => {
          if (!receipt) {
            setReceiptError(t("errors.codes.RECEIPT_INVALID"));
            return;
          }
          const form = new FormData();
          for (const [key, value] of Object.entries(values)) form.set(key, String(value));
          form.set("receipt", receipt, receipt.name);
          try {
            await pay({ orderId, form }).unwrap();
            onSent();
          } catch (error) {
            const fields = normalizeError(error).errors.filter((entry) => entry.path);
            if (fields.some((field) => field.path === "receipt")) setReceiptError(errorText(error));
            else if (fields.length) {
              for (const field of fields) {
                methods.setError(field.path as keyof CardTransferInput, { message: field.msg });
              }
            } else toast.error(errorText(error));
          }
        }}
      >
        {(methods) => (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("shop.card.destination")}</legend>
              {cards.map((card) => (
                <label key={card.id} className="flex items-center gap-2.5 text-sm">
                  <input type="radio" value={card.id} className="size-4 accent-primary" {...methods.register("destinationCardId")} />
                  {card.bankName} · <bdi dir="ltr">…{card.cardNumber.slice(-4)}</bdi>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField<CardTransferInput>
                name="trackingNumber"
                label={t("shop.card.tracking")}
                description={t("shop.card.trackingHint")}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
              />
              <InputField<CardTransferInput>
                name="claimedAmountToman"
                label={t("shop.card.amount")}
                dir="ltr"
                inputMode="numeric"
              />
              <InputField<CardTransferInput>
                name="payerCardLast4"
                label={t("shop.card.last4")}
                dir="ltr"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={receiptId}>{t("shop.card.receipt")}</Label>
              <input
                id={receiptId}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-describedby={`${receiptId}-hint`}
                onChange={(event) => {
                  setReceipt(event.target.files?.[0]);
                  setReceiptError(undefined);
                }}
                className="block w-full text-sm file:me-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
              <p id={`${receiptId}-hint`} className="text-xs text-muted-foreground">
                {t("shop.card.receiptHint")}
              </p>
              {receiptError ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {receiptError}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isSending}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            >
              {isSending ? t("common.loading") : t("shop.card.submit")}
            </button>
          </>
        )}
      </Form>
    </div>
  );
};
