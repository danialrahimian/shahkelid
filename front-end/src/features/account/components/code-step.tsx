import { signInCodeSchema, type SessionView } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import {
  useAccountRequestCodeMutation,
  useAccountVerifyCodeMutation,
} from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";

import { RESEND_COOLDOWN_SECONDS } from "../sign-in-steps";
import { useCountdown } from "../use-countdown";
import { SubmitButton, TextButton } from "./account-card";

const codeForm = z.object({ code: signInCodeSchema });
type CodeForm = z.infer<typeof codeForm>;

/**
 * The emailed code. Persian digits typed on a Persian keyboard are accepted
 * as they are: the shared schema turns them into Latin ones.
 */
export const CodeStep = ({
  email,
  onSession,
  onChangeEmail,
}: {
  email: string;
  onSession: (session: SessionView) => void;
  onChangeEmail: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const [verify, { isLoading }] = useAccountVerifyCodeMutation();
  const [requestCode, { isLoading: isResending }] = useAccountRequestCodeMutation();
  const { remaining, restart } = useCountdown(RESEND_COOLDOWN_SECONDS);

  const resend = async () => {
    try {
      await requestCode({ email }).unwrap();
      restart();
      toast.success(t("account.code.resent"));
    } catch (error) {
      // "Too many codes" says how long to wait; the button waits that long.
      const retryAfter = normalizeError(error).retryAfterSeconds;
      if (retryAfter) restart(retryAfter);
      toast.error(errorText(error));
    }
  };

  return (
    <div className="space-y-5">
      <Form<CodeForm>
        schema={codeForm}
        options={{ defaultValues: { code: "" } }}
        onSubmit={async (values, methods) => {
          try {
            onSession(await verify({ email, code: values.code }).unwrap());
          } catch (error) {
            methods.setError("code", { message: errorText(error) });
          }
        }}
      >
        {() => (
          <>
            <InputField<CodeForm>
              name="code"
              label={t("account.code.label")}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={12}
              autoFocus
              className="text-center text-lg tracking-[0.5em] tabular-nums"
            />
            <SubmitButton
              busy={isLoading}
              label={t("account.code.submit")}
              busyLabel={t("account.code.checking")}
            />
          </>
        )}
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {remaining > 0 ? (
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t("account.code.resendIn", {
              seconds: new Intl.NumberFormat(i18n.language).format(remaining),
            })}
          </span>
        ) : (
          <TextButton onClick={resend}>
            {isResending ? t("account.signIn.sending") : t("account.code.resend")}
          </TextButton>
        )}
        <TextButton onClick={onChangeEmail}>{t("account.code.changeEmail")}</TextButton>
      </div>

      <p className="text-xs text-muted-foreground">{t("account.code.checkSpam")}</p>
    </div>
  );
};
