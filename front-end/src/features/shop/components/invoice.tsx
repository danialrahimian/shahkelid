import { useTranslation } from "react-i18next";

import { useShopInvoiceQuery } from "@/api/shop";
import { formatDateTime, formatNumber, formatToman } from "@/lib/format";

/** An issued invoice, laid out to read and to print. */
export const Invoice = ({ orderId }: { orderId: string }) => {
  const { t } = useTranslation();
  const { data: invoice, isLoading, isError } = useShopInvoiceQuery(orderId);

  if (isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (isError || !invoice) return <p className="text-muted-foreground">{t("shop.invoice.notYet")}</p>;

  return (
    <article className="space-y-6 rounded-xl border bg-card p-6 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{t("shop.invoice.title", { number: formatNumber(invoice.number) })}</h1>
          <p className="text-sm text-muted-foreground">
            {t("shop.invoice.order", { number: formatNumber(invoice.orderNumber) })} · {t("shop.invoice.issued")}:{" "}
            {formatDateTime(invoice.issuedAt)}
          </p>
        </div>
        <p className="text-lg font-semibold">{t("app.name")}</p>
      </header>

      <div className="text-sm">
        <p className="text-muted-foreground">{t("shop.invoice.customer")}</p>
        <p>{invoice.customer.displayName || null}</p>
        <p dir="ltr" className="text-start">
          {invoice.customer.email}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 text-start font-medium">{t("shop.invoice.item")}</th>
              <th className="py-2 text-start font-medium">{t("shop.invoice.quantity")}</th>
              <th className="py-2 text-end font-medium">{t("shop.invoice.price")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b">
                <td className="py-2">{line.description}</td>
                <td className="py-2 tabular-nums">{formatNumber(line.quantity)}</td>
                <td className="py-2 text-end tabular-nums">{formatToman(line.unitPriceToman * line.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ms-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("shop.invoice.subtotal")}</dt>
          <dd className="tabular-nums">{formatToman(invoice.subtotalToman)}</dd>
        </div>
        {invoice.discountToman > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("shop.invoice.discount")}</dt>
            <dd className="tabular-nums">{formatToman(invoice.discountToman)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
          <dt>{t("shop.invoice.total")}</dt>
          <dd className="tabular-nums">{formatToman(invoice.totalToman)}</dd>
        </div>
      </dl>

      {invoice.payment ? (
        <p className="text-sm text-muted-foreground">
          {t("shop.invoice.payment")}: {t(`shop.methods.${invoice.payment.method as "zarinpal"}`)}
          {invoice.payment.refId ? (
            <>
              {" · "}
              {t("shop.invoice.reference")}: <bdi dir="ltr">{invoice.payment.refId}</bdi>
            </>
          ) : null}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent print:hidden"
      >
        {t("shop.invoice.print")}
      </button>
    </article>
  );
};
