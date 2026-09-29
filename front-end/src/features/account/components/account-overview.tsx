import {
  setPasswordInput,
  type AccountView,
  type SetPasswordInput,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAppDispatch } from "@/stores";
import {
  setAccountSession,
  useAccountSetPasswordMutation,
  useAccountSignOutMutation,
} from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { PasswordField } from "@/components/ui/form/password-field";
import { errorText } from "@/lib/error-text";

import { SubmitButton, TextButton } from "./account-card";
import { RecoveryCodes } from "./recovery-codes";
import { TwoFactorSetup } from "./two-factor-setup";

/** One labelled row of the account page. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
    <h2 className="text-sm font-medium">{label}</h2>
    <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
  </div>
);

const SetPasswordForm = () => {
  const { t } = useTranslation();
  const [setPassword, { isLoading }] = useAccountSetPasswordMutation();

  return (
    <Form<SetPasswordInput>
      schema={setPasswordInput}
      options={{ defaultValues: { newPassword: "" } }}
      onSubmit={async (values, methods) => {
        try {
          await setPassword(values).unwrap();
          toast.success(t("account.profile.passwordSaved"));
        } catch (error) {
          methods.setError("newPassword", { message: errorText(error) });
        }
      }}
    >
      {() => (
        <>
          <PasswordField<SetPasswordInput>
            name="newPassword"
            label={t("account.forgot.newPassword")}
            description={t("account.forgot.newPasswordHint")}
            autoComplete="new-password"
            dir="ltr"
          />
          <SubmitButton
            busy={isLoading}
            label={t("account.profile.setPassword")}
            busyLabel={t("account.code.checking")}
          />
        </>
      )}
    </Form>
  );
};

/** Two-step sign-in, from "off" to set up, for a customer who chooses it. */
const TwoFactorRow = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [phase, setPhase] = React.useState<"idle" | "setup">("idle");
  const [codes, setCodes] = React.useState<{ codes: string[]; finish: () => void }>();

  if (codes) {
    return <RecoveryCodes codes={codes.codes} onContinue={codes.finish} />;
  }
  if (enabled) return <p>{t("account.profile.twoFactorOn")}</p>;
  if (phase === "setup") {
    return (
      <>
        <p>{t("account.setup.optional")}</p>
        <TwoFactorSetup
          onEnabled={({ recoveryCodes, session }) =>
            setCodes({
              codes: recoveryCodes,
              finish: () => {
                setCodes(undefined);
                dispatch(setAccountSession(session));
                toast.success(t("account.setup.enabled"));
              },
            })
          }
        />
      </>
    );
  }
  return (
    <>
      <p>{t("account.profile.twoFactorOff")}</p>
      <TextButton onClick={() => setPhase("setup")}>{t("account.profile.enableTwoFactor")}</TextButton>
    </>
  );
};

/**
 * The account page: who is signed in, their password, two-step sign-in, and
 * signing out. Orders and subscriptions join it in later milestones.
 */
export const AccountOverview = ({ account }: { account: AccountView }) => {
  const { t } = useTranslation();
  const [signOut, { isLoading: isSigningOut }] = useAccountSignOutMutation();

  return (
    <div className="space-y-4">
      <Row label={t("account.profile.email")}>
        <p className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="text-foreground">
            {account.email}
          </bdi>
          {account.isStaff ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {t("account.profile.staff")}
            </span>
          ) : null}
        </p>
      </Row>

      <Row label={t("account.profile.password")}>
        {account.hasPassword ? (
          <>
            <p>{t("account.profile.passwordSet")}</p>
            <p className="text-xs">{t("account.profile.passwordChangeHint")}</p>
          </>
        ) : (
          <>
            <p>{t("account.profile.passwordNotSet")}</p>
            <SetPasswordForm />
          </>
        )}
      </Row>

      <Row label={t("account.profile.twoFactor")}>
        <TwoFactorRow enabled={account.twoFactor.enabled} />
      </Row>

      <div className="border-t pt-4">
        <button
          type="button"
          disabled={isSigningOut}
          onClick={() =>
            void signOut()
              .unwrap()
              .then(() => toast.success(t("account.profile.signedOut")))
              .catch((error: unknown) => toast.error(errorText(error)))
          }
          className="inline-flex h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          {t("account.profile.signOut")}
        </button>
      </div>
    </div>
  );
};
