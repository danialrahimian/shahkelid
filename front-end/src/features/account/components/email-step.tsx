import { requestCodeInput, type RequestCodeInput } from "@shah-kelid/contracts";
import { AtSign } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAccountRequestCodeMutation } from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { errorText } from "@/lib/error-text";

import { SubmitButton, TextButton } from "./account-card";

/**
 * The first step: an email address, and a code sent to it.
 *
 * The same for new and returning people. Signing in with a code is also how
 * an account is made, so there is no separate sign-up form to choose.
 */
export const EmailStep = ({
  defaultEmail = "",
  onCodeSent,
  onUsePassword,
}: {
  defaultEmail?: string;
  onCodeSent: (email: string) => void;
  onUsePassword: () => void;
}) => {
  const { t } = useTranslation();
  const [requestCode, { isLoading }] = useAccountRequestCodeMutation();

  return (
    <div className="space-y-5">
      <Form<RequestCodeInput>
        schema={requestCodeInput}
        options={{ defaultValues: { email: defaultEmail } }}
        onSubmit={async (values, methods) => {
          try {
            await requestCode(values).unwrap();
            onCodeSent(values.email);
          } catch (error) {
            methods.setError("email", { message: errorText(error) });
          }
        }}
      >
        {() => (
          <>
            <InputField<RequestCodeInput>
              name="email"
              label={t("account.signIn.email")}
              placeholder={t("account.signIn.emailPlaceholder")}
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              autoFocus
              icon={<AtSign className="size-4" />}
            />
            <SubmitButton
              busy={isLoading}
              label={t("account.signIn.sendCode")}
              busyLabel={t("account.signIn.sending")}
            />
          </>
        )}
      </Form>

      <div className="text-center">
        <TextButton onClick={onUsePassword}>{t("account.signIn.usePassword")}</TextButton>
      </div>
    </div>
  );
};
