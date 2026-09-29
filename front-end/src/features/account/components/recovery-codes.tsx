import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TextButton } from "./account-card";

/**
 * The recovery codes, shown the one time they exist in readable form (the
 * server keeps only their hashes). Moving on needs a tick first, so nobody
 * clicks past them by habit.
 */
export const RecoveryCodes = ({
  codes,
  onContinue,
}: {
  codes: string[];
  onContinue: () => void;
}) => {
  const { t } = useTranslation();
  const [saved, setSaved] = React.useState(false);

  const copy = () =>
    void navigator.clipboard
      .writeText(codes.join("\n"))
      .then(() => toast.success(t("account.recovery.copied")));

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">{t("account.recovery.description")}</p>

      <ol
        dir="ltr"
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md bg-muted p-4 font-mono text-sm tabular-nums"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ol>

      <div className="text-center">
        <TextButton onClick={copy}>{t("account.recovery.copy")}</TextButton>
      </div>

      <label htmlFor="recovery-saved" className="flex items-start gap-3 text-sm">
        <input
          id="recovery-saved"
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        {t("account.recovery.confirm")}
      </label>

      <button
        type="button"
        disabled={!saved}
        onClick={onContinue}
        className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {t("account.recovery.continue")}
      </button>
    </div>
  );
};
