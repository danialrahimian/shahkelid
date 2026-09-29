import { signInCodeSchema, type SessionView } from "@shah-kelid/contracts";
import QRCode from "qrcode";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import {
  useAccountTwoFactorEnableMutation,
  useAccountTwoFactorSetupMutation,
} from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { errorText } from "@/lib/error-text";

import { SubmitButton, TextButton } from "./account-card";

// Only an authenticator code proves the app is set up; a recovery code would not.
const enableForm = z.object({ code: signInCodeSchema });
type EnableForm = z.infer<typeof enableForm>;

/** "ABCD EFGH IJKL …": easier to type into an app by hand. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * Setting up an authenticator app: scan, type the code it shows, done.
 *
 * The server keeps the new secret aside until a code from it is proved, so
 * leaving half way changes nothing. Setup is asked for once per mount: a
 * second request would replace the secret behind a QR code already on screen.
 */
export const TwoFactorSetup = ({
  onEnabled,
}: {
  onEnabled: (result: { recoveryCodes: string[]; session: SessionView }) => void;
}) => {
  const { t } = useTranslation();
  const [setup, setupState] = useAccountTwoFactorSetupMutation();
  const [enable, { isLoading: isEnabling }] = useAccountTwoFactorEnableMutation();
  const [qr, setQr] = React.useState<string>();

  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    setup()
      .unwrap()
      .then(({ otpauthUri }) => QRCode.toDataURL(otpauthUri, { margin: 1, width: 192 }))
      .then(setQr)
      .catch((error: unknown) => toast.error(errorText(error)));
  }, [setup]);

  const secret = setupState.data?.secret;

  if (!secret || !qr) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" aria-live="polite">
        {setupState.isError ? errorText(setupState.error) : t("account.setup.preparing")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6">{t("account.setup.scan")}</p>

      {/* White behind the code in both themes: scanners want dark on light. */}
      <div className="flex justify-center">
        <img
          src={qr}
          alt={t("account.setup.qrAlt")}
          width={192}
          height={192}
          className="rounded-md bg-white p-2"
        />
      </div>

      <div className="space-y-1.5 rounded-md bg-muted p-3">
        <p className="text-xs text-muted-foreground">{t("account.setup.cantScan")}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code dir="ltr" className="font-mono text-sm break-all select-all">
            {grouped(secret)}
          </code>
          <TextButton
            onClick={() =>
              void navigator.clipboard
                .writeText(secret)
                .then(() => toast.success(t("account.recovery.copied")))
            }
          >
            {t("account.setup.copyKey")}
          </TextButton>
        </div>
      </div>

      <Form<EnableForm>
        schema={enableForm}
        options={{ defaultValues: { code: "" } }}
        onSubmit={async (values, methods) => {
          try {
            onEnabled(await enable(values).unwrap());
          } catch (error) {
            methods.setError("code", { message: errorText(error) });
          }
        }}
      >
        {() => (
          <>
            <InputField<EnableForm>
              name="code"
              label={t("account.setup.codeLabel")}
              description={t("account.setup.enterCode")}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={12}
              className="text-center text-lg tracking-[0.5em] tabular-nums"
            />
            <SubmitButton
              busy={isEnabling}
              label={t("account.setup.submit")}
              busyLabel={t("account.code.checking")}
            />
          </>
        )}
      </Form>
    </div>
  );
};
