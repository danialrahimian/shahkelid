import {
  setPasswordInput,
  updateProfileInput,
  type AccountView,
  type SetPasswordInput,
  type UpdateProfileInput,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAppDispatch } from "@/stores";
import {
  setAccountSession,
  useAccountDeleteAccountMutation,
  useAccountSetPasswordMutation,
  useAccountSignOutMutation,
  useAccountUpdateProfileMutation,
} from "@/api/account";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
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
/** The name on invoices and the one support sees. */
const DisplayNameForm = ({ current }: { current: string }) => {
  const { t } = useTranslation();
  const [update, { isLoading }] = useAccountUpdateProfileMutation();

  return (
    <Form<UpdateProfileInput>
      schema={updateProfileInput}
      options={{ defaultValues: { displayName: current } }}
      onSubmit={async (values, methods) => {
        try {
          await update(values).unwrap();
          toast.success(t("account.profile.nameSaved"));
        } catch (error) {
          methods.setError("displayName", { message: errorText(error) });
        }
      }}
    >
      {() => (
        <>
          <InputField<UpdateProfileInput>
            name="displayName"
            label={t("account.profile.displayName")}
            description={t("account.profile.displayNameHint")}
            autoComplete="name"
          />
          <SubmitButton busy={isLoading} label={t("account.profile.saveName")} busyLabel={t("account.code.checking")} />
        </>
      )}
    </Form>
  );
};

/**
 * Deleting one's own account. Typing the email is the confirmation, and the
 * server checks it again. Staff are removed from the team first, so the
 * section is not offered to them.
 */
const DeleteAccount = ({ email }: { email: string }) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [remove, { isLoading }] = useAccountDeleteAccountMutation();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-destructive underline-offset-4 hover:underline"
      >
        {t("account.delete.title")}
      </button>
    );
  }
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <form
      className="space-y-3 rounded-lg border border-destructive/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        remove({ email: typed })
          .unwrap()
          .then(() => toast.success(t("account.delete.done")))
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <p className="leading-6">{t("account.delete.body")}</p>
      <label htmlFor="delete-confirm" className="block text-sm font-medium text-foreground">
        {t("account.delete.confirm")}
      </label>
      <input
        id="delete-confirm"
        dir="ltr"
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={email}
        className="block h-10 w-full rounded-md border bg-background px-3 text-start text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!matches || isLoading}
          className="inline-flex h-10 items-center rounded-md bg-destructive px-4 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
        >
          {t("account.delete.button")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="inline-flex h-10 items-center rounded-md border px-4 text-sm hover:bg-accent">
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
};

export const AccountOverview = ({ account }: { account: AccountView }) => {
  const { t } = useTranslation();
  const [signOut, { isLoading: isSigningOut }] = useAccountSignOutMutation();

  return (
    <div className="space-y-4">
      <Row label={t("account.profile.email")}>
        <p className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="text-foreground">
            {account.email ?? account.username}
          </bdi>
          {account.isStaff ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {t("account.profile.staff")}
            </span>
          ) : null}
        </p>
      </Row>

      <Row label={t("account.profile.displayName")}>
        <DisplayNameForm current={account.displayName} />
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

      {account.isStaff ? null : (
        <div className="border-t pt-4">
          <DeleteAccount email={account.email ?? account.username ?? ""} />
        </div>
      )}
    </div>
  );
};
