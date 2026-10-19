import {
  passwordSignInInput,
  type PasswordSignInInput,
  type SessionView,
} from "@shah-kelid/contracts";
import { AtSign } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useAccountPasswordSignInMutation } from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { paths } from "@/config/paths";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";

import { SubmitButton, TextButton } from "./account-card";

/**
 * Signing in with a password, for accounts that have set one: with the
 * email, or with a staff username (the owner the installer made).
 *
 * Five wrong passwords close this door for a while; the emailed code still
 * works, and the message says so.
 */
export const PasswordStep = ({
  defaultEmail = "",
  onSession,
  onUseCode,
}: {
  defaultEmail?: string;
  onSession: (session: SessionView) => void;
  onUseCode: (email: string) => void;
}) => {
  const { t } = useTranslation();
  const [signIn, { isLoading }] = useAccountPasswordSignInMutation();

  return (
    <div className="space-y-5">
      <Form<PasswordSignInInput>
        schema={passwordSignInInput}
        options={{ defaultValues: { login: defaultEmail, password: "" } }}
        onSubmit={async (values, methods) => {
          try {
            onSession(await signIn(values).unwrap());
          } catch (error) {
            const locked = normalizeError(error).code === "ACCOUNT_LOCKED";
            methods.setError("password", {
              message: locked
                ? `${errorText(error)} ${t("account.signIn.lockedHint")}`
                : errorText(error),
            });
          }
        }}
      >
        {(methods) => (
          <>
            <InputField<PasswordSignInInput>
              name="login"
              label={t("account.signIn.login")}
              placeholder={t("account.signIn.loginPlaceholder")}
              type="text"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="username"
              dir="ltr"
              autoFocus={!defaultEmail}
              icon={<AtSign className="size-4" />}
            />
            <div className="space-y-1.5">
              <PasswordField<PasswordSignInInput>
                name="password"
                label={t("account.signIn.password")}
                placeholder={t("account.signIn.passwordPlaceholder")}
                autoComplete="current-password"
                dir="ltr"
                autoFocus={Boolean(defaultEmail)}
              />
              <Link
                to={paths.accountForgotPassword.getHref()}
                className="inline-block text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("account.signIn.forgotPassword")}
              </Link>
            </div>
            <SubmitButton
              busy={isLoading}
              label={t("account.signIn.submit")}
              busyLabel={t("account.signIn.signingIn")}
            />
            <div className="text-center">
              <TextButton
                onClick={() => {
                  const login = methods.getValues("login");
                  onUseCode(login.includes("@") ? login : "");
                }}
              >
                {t("account.signIn.useCode")}
              </TextButton>
            </div>
          </>
        )}
      </Form>
    </div>
  );
};
