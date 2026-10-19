import type { SessionView } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { useAppDispatch } from "@/stores";
import { setAccountSession, useAccountSessionQuery } from "@/api/account";

import { isolated, stepAfter, type SignInStep } from "../sign-in-steps";
import { AccountCard } from "./account-card";
import { CodeStep } from "./code-step";
import { EmailStep } from "./email-step";
import { PasswordStep } from "./password-step";
import { RecoveryCodes } from "./recovery-codes";
import { SecondFactorStep } from "./second-factor-step";
import { TwoFactorSetup } from "./two-factor-setup";

type Recovery = { codes: string[]; session: SessionView };

/**
 * Signing in, from the email address to a finished session.
 *
 * Until the person does something, the step follows the session the server
 * reports: someone who reloads half way (password accepted, authenticator
 * code still to come) lands back on the step they left. Once signed in the
 * session cache says so, and the route takes them on.
 */
export const SignInFlow = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data: session } = useAccountSessionQuery();
  const [searchParams] = useSearchParams();
  // Headed for the staff area, or sent here by the installer: the password
  // first, since a username has no email to send a code to.
  const passwordFirst =
    searchParams.get("with") === "password" || (searchParams.get("redirectTo") ?? "").startsWith("/staff");
  const [chosen, setChosen] = React.useState<SignInStep | undefined>(passwordFirst ? { kind: "password" } : undefined);
  const [email, setEmail] = React.useState("");
  const [recovery, setRecovery] = React.useState<Recovery>();

  const step = chosen ?? (session ? stepAfter(session) : { kind: "email" as const });

  const follow = (next: SessionView) => {
    if (next.status === "signed_in") toast.success(t("account.signIn.welcome"));
    setChosen(stepAfter(next));
  };

  if (recovery) {
    return (
      <AccountCard title={t("account.recovery.title")}>
        <RecoveryCodes
          codes={recovery.codes}
          // Only now does the session move on, taking the route with it.
          onContinue={() => {
            dispatch(setAccountSession(recovery.session));
            toast.success(t("account.setup.enabled"));
          }}
        />
      </AccountCard>
    );
  }

  switch (step.kind) {
    case "email":
      return (
        <AccountCard title={t("account.signIn.title")} description={t("account.signIn.subtitle")}>
          <EmailStep
            defaultEmail={email}
            onCodeSent={(address) => {
              setEmail(address);
              setChosen({ kind: "code", email: address });
            }}
            onUsePassword={() => setChosen({ kind: "password" })}
          />
        </AccountCard>
      );

    case "password":
      return (
        <AccountCard title={t("account.signIn.title")}>
          <PasswordStep
            defaultEmail={email}
            onSession={follow}
            onUseCode={(address) => {
              setEmail(address);
              setChosen({ kind: "email" });
            }}
          />
        </AccountCard>
      );

    case "code":
      return (
        <AccountCard
          title={t("account.code.title")}
          description={t("account.code.sentTo", { email: isolated(step.email) })}
        >
          <CodeStep
            email={step.email}
            onSession={follow}
            onChangeEmail={() => setChosen({ kind: "email" })}
          />
        </AccountCard>
      );

    case "second-factor":
      return (
        <AccountCard
          title={t("account.secondFactor.title")}
          description={t("account.secondFactor.description")}
        >
          <SecondFactorStep onSession={follow} />
        </AccountCard>
      );

    case "setup":
      return (
        <AccountCard title={t("account.setup.title")} description={t("account.setup.requiredForStaff")}>
          <TwoFactorSetup
            onEnabled={({ recoveryCodes, session: next }) =>
              setRecovery({ codes: recoveryCodes, session: next })
            }
          />
        </AccountCard>
      );

    case "done":
      return null;
  }
};
