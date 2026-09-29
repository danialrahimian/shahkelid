import QRCode from "qrcode";
import * as React from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * A subscription link as a VPN app takes it: a QR code to scan and the link
 * itself to copy. The QR sits on white in both themes; scanners want dark
 * on light. The words come from the caller, so this stays language-free.
 */
export const QrLink = ({
  link,
  hint,
  qrAlt,
  copyLabel,
  copiedLabel,
  size = 180,
  className,
}: {
  link: string;
  hint: string;
  qrAlt: string;
  copyLabel: string;
  copiedLabel: string;
  size?: number;
  className?: string;
}) => {
  const [qr, setQr] = React.useState<string>();

  React.useEffect(() => {
    let current = true;
    QRCode.toDataURL(link, { margin: 1, width: size })
      .then((url) => current && setQr(url))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [link, size]);

  return (
    <div className={cn("flex flex-wrap items-start gap-4 rounded-lg border bg-card p-4", className)}>
      {qr ? (
        <img src={qr} alt={qrAlt} width={size} height={size} className="rounded-md bg-white p-1.5" />
      ) : (
        <div style={{ width: size, height: size }} className="animate-pulse rounded-md bg-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1 basis-56 space-y-3">
        <p className="text-sm leading-6 text-muted-foreground">{hint}</p>
        <code dir="ltr" className="block rounded bg-muted p-2 font-mono text-xs break-all select-all">
          {link}
        </code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(copiedLabel))}
          className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {copyLabel}
        </button>
      </div>
    </div>
  );
};
