import { subscriptionDomainInput, type SubscriptionDomainInput } from "@shah-kelid/contracts";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useStaffAddSubscriptionDomainMutation,
  useStaffCheckSubscriptionDomainMutation,
  useStaffMakePrimarySubscriptionDomainMutation,
  useStaffRemoveSubscriptionDomainMutation,
  useStaffSubscriptionDomainsQuery,
} from "@/api/staff";
import { FieldError, Form } from "@/components/ui/form/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/error-text";

import { showSaveError } from "../form-errors";
import { Button, ConfirmButton, Placeholder } from "./staff-ui";

const CheckButton = ({ domain }: { domain: string }) => {
  const { t } = useTranslation();
  const [check, { isLoading }] = useStaffCheckSubscriptionDomainMutation();
  return (
    <Button
      busy={isLoading}
      onClick={() =>
        check(domain)
          .unwrap()
          .then((result) =>
            result.ok
              ? toast.success(t("staff.domains.reached"))
              : toast.error(t("staff.domains.notReached", { error: result.error ?? "" })),
          )
          .catch((error: unknown) => toast.error(errorText(error)))
      }
    >
      {t("staff.domains.check")}
    </Button>
  );
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
      {n}
    </span>
    <span className="pt-0.5 leading-6">{children}</span>
  </li>
);

/**
 * The shop's own domains for customers' subscription links, apart from the
 * site (as PasarGuard's subscription domain). Only links are answered on
 * them; the site and the API are not.
 */
export const SubscriptionDomains = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useStaffSubscriptionDomainsQuery();
  const [add, adding] = useStaffAddSubscriptionDomainMutation();
  const [makePrimary] = useStaffMakePrimarySubscriptionDomainMutation();
  const [remove] = useStaffRemoveSubscriptionDomainMutation();
  const failed = (error: unknown) => toast.error(errorText(error));

  return (
    <section aria-labelledby="subscription-domains-title" className="space-y-5 rounded-lg border bg-card p-5">
      <header className="space-y-2">
        <h2 id="subscription-domains-title" className="text-lg font-semibold">
          {t("staff.domains.title")}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("staff.domains.description")}</p>
      </header>

      <ol className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm">
        <Step n={1}>{t("staff.domains.step1")}</Step>
        <Step n={2}>{t("staff.domains.step2")}</Step>
        <Step n={3}>{t("staff.domains.step3")}</Step>
      </ol>

      <Form<SubscriptionDomainInput>
        schema={subscriptionDomainInput}
        options={{ defaultValues: { domain: "" } }}
        className="space-y-1.5"
        onSubmit={async (values, methods) => {
          try {
            await add(values).unwrap();
            methods.reset({ domain: "" });
            toast.success(t("staff.domains.added"));
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {(methods) => (
          <>
            <Label htmlFor="subscription-domain" className="text-sm font-medium">
              {t("staff.domains.domain")}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="subscription-domain"
                dir="ltr"
                placeholder="sub.example.com"
                autoComplete="off"
                className="h-10 font-mono sm:flex-1"
                {...methods.register("domain")}
              />
              <Button type="submit" tone="primary" className="h-10 sm:w-32" busy={adding.isLoading}>
                {t("staff.domains.add")}
              </Button>
            </div>
            <FieldError name="domain" />
          </>
        )}
      </Form>

      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : isError || !data ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("staff.domains.linksOn")}</span>
            <bdi dir="ltr" className="rounded bg-muted px-2 py-0.5 font-mono text-xs break-all">
              {data.linkBase}/s/…
            </bdi>
          </div>

          {data.domains.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t("staff.domains.none")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.domains.map((row) => (
                <li key={row.domain} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <bdi dir="ltr" className="truncate font-mono text-sm">
                      {row.domain}
                    </bdi>
                    {row.isPrimary ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {t("staff.domains.primary")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CheckButton domain={row.domain} />
                    {!row.isPrimary ? (
                      <Button onClick={() => makePrimary(row.domain).unwrap().catch(failed)}>
                        {t("staff.domains.makePrimary")}
                      </Button>
                    ) : null}
                    <ConfirmButton
                      tone="danger"
                      label={t("staff.domains.remove")}
                      question={t("staff.domains.removeQuestion", { domain: row.domain })}
                      onConfirm={() => remove(row.domain).unwrap().catch(failed)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
