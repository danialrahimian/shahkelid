import { secondFactorInput, type SecondFactorInput, type SessionView } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";

import { useAccountTwoFactorVerifyMutation } from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { errorText } from "@/lib/error-text";

import { SubmitButton } from "./account-card";

/** The authenticator code (or a recovery code) after the password or email code. */
export const SecondFactorStep = ({ onSession }: { onSession: (session: SessionView) => void }) => {
  const { t } = useTranslation();
  const [verify, { isLoading }] = useAccountTwoFactorVerifyMutation();

  return (
    <Form<SecondFactorInput>
      schema={secondFactorInput}
      options={{ defaultValues: { code: "" } }}
      onSubmit={async (values, methods) => {
        try {
          onSession(await verify(values).unwrap());
        } catch (error) {
          methods.setError("code", { message: errorText(error) });
        }
      }}
    >
      {() => (
        <>
          <InputField<SecondFactorInput>
            name="code"
            label={t("account.secondFactor.label")}
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={12}
            autoFocus
            description={t("account.secondFactor.recoveryHint")}
            className="text-center text-lg tracking-[0.3em] tabular-nums"
          />
          <SubmitButton
            busy={isLoading}
            label={t("account.secondFactor.submit")}
            busyLabel={t("account.code.checking")}
          />
        </>
      )}
    </Form>
  );
};
