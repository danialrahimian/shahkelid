import type { CryptoQuote } from "@shah-kelid/contracts";
import { AlertTriangle, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";

/** A value to copy, left to right whatever the page direction, with its own button. */
const Copyable = ({ label, value, copyLabel, large }: { label: string; value: string; copyLabel: string; large?: boolean }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className={`rounded bg-muted px-3 py-2 font-mono break-all select-all ${large ? "text-2xl font-bold tabular-nums" : "text-sm"}`}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(t("shop.usdt.copied")))}
          className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {copyLabel}
        </button>
      </div>
    </div>
  );
};

/**
 * What to send for a direct USDT payment: the exact amount (the tail is how
 * the payment is recognised), the address and its QR code, and the three
 * ways people get it wrong, said before they do.
 */
export const UsdtPayment = ({ quote }: { quote: CryptoQuote }) => {
  const { t } = useTranslation();
  const [qr, setQr] = React.useState<string>();

  React.useEffect(() => {
    let current = true;
    QRCode.toDataURL(quote.address, { margin: 1, width: 168 })
      .then((url) => current && setQr(url))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [quote.address]);

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{t("shop.usdt.title")}</h2>
      <div className="flex flex-wrap items-start gap-5">
        {qr ? <img src={qr} alt={t("shop.usdt.qrAlt")} width={168} height={168} className="rounded-md bg-white p-1.5" /> : null}
        <div className="min-w-0 flex-1 basis-60 space-y-4">
          <Copyable label={t("shop.usdt.amount")} value={`${quote.amount}`} copyLabel={t("shop.usdt.copyAmount")} large />
          <Copyable label={t("shop.usdt.address")} value={quote.address} copyLabel={t("shop.usdt.copyAddress")} />
        </div>
      </div>
      <ul className="space-y-2 text-sm leading-6">
        {(["exact", "network", "fee"] as const).map((key) => (
          <li key={key} className="flex gap-2">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>{t(`shop.usdt.${key}`)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{t("shop.usdt.expires", { time: formatDateTime(quote.expiresAt) })}</p>
      <p className="flex items-center gap-2 text-sm" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t("shop.usdt.watching")}
      </p>
    </div>
  );
};
