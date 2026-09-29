import {
  passwordSchema,
  requestCodeInput,
  signInCodeSchema,
  type RequestCodeInput,
} from "@shah-kelid/contracts";
import { AtSign } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import * as z from "zod";

import {
  useAccountForgotPasswordMutation,
  useAccountResetPasswordMutation,
} from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";

import { isolated } from "../sign-in-steps";
import { AccountCard, SubmitButton, TextButton } from "./account-card";

const resetForm = z.object({ code: signInCodeSchema, newPassword: passwordSchema });
type ResetForm = z.infer<typeof resetForm>;

/**
 * A forgotten password: an emailed code, then a new password.
 *
 * The answer to "send me a code" is the same whether or not the address has
 * an account, so this screen cannot be used to find out who is a customer.
 */
export const ForgotPasswordFlow = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState<string>();
  const [forgot, { isLoading: isSending }] = useAccountForgotPasswordMutation();
  const [reset, { isLoading: isResetting }] = useAccountResetPasswordMutation();

  const backToSignIn = (
    <div className="text-center">
      <Link
        to={paths.accountSignIn.getHref()}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("account.forgot.backToSignIn")}
      </Link>
    </div>
  );

  if (!email) {
    return (
      <AccountCard title={t("account.forgot.title")} description={t("account.forgot.description")}>
        <div className="space-y-5">
          <Form<RequestCodeInput>
            schema={requestCodeInput}
            options={{ defaultValues: { email: "" } }}
            onSubmit={async (values, methods) => {
              try {
                await forgot(values).unwrap();
                setEmail(values.email);
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
                  busy={isSending}
                  label={t("account.forgot.sendCode")}
                  busyLabel={t("account.signIn.sending")}
                />
              </>
            )}
          </Form>
          {backToSignIn}
        </div>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      title={t("account.forgot.title")}
      description={t("account.forgot.sentTo", { email: isolated(email) })}
    >
      <div className="space-y-5">
        <Form<ResetForm>
          schema={resetForm}
          options={{ defaultValues: { code: "", newPassword: "" } }}
          onSubmit={async (values, methods) => {
            try {
              await reset({ email, ...values }).unwrap();
              toast.success(t("account.forgot.done"));
              onDone();
            } catch (error) {
              methods.setError("code", { message: errorText(error) });
            }
          }}
        >
          {() => (
            <>
              <InputField<ResetForm>
                name="code"
                label={t("account.forgot.codeLabel")}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={12}
                autoFocus
                className="text-center text-lg tracking-[0.5em] tabular-nums"
              />
              <PasswordField<ResetForm>
                name="newPassword"
                label={t("account.forgot.newPassword")}
                description={t("account.forgot.newPasswordHint")}
                autoComplete="new-password"
                dir="ltr"
              />
              <SubmitButton
                busy={isResetting}
                label={t("account.forgot.submit")}
                busyLabel={t("account.code.checking")}
              />
            </>
          )}
        </Form>
        <div className="text-center">
          <TextButton onClick={() => setEmail(undefined)}>{t("account.code.changeEmail")}</TextButton>
        </div>
      </div>
    </AccountCard>
  );
};
