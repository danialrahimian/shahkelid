import { subscriptionDomainInput, type SubscriptionDomainInput } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useStaffAddSubscriptionDomainMutation,
  useStaffCheckSubscriptionDomainMutation,
  useStaffMakePrimarySubscriptionDomainMutation,
  useStaffRemoveSubscriptionDomainMutation,
  useStaffSubscriptionDomainsQuery,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { errorText } from "@/lib/error-text";

import { showSaveError } from "../form-errors";
import { TextField } from "./fields";
import { Button, ConfirmButton, Placeholder, Section, TableFrame } from "./staff-ui";

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
    <Section title={t("staff.domains.title")}>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t("staff.domains.description")}</p>
        <p>{t("staff.domains.dns")}</p>
      </div>

      <Form<SubscriptionDomainInput>
        schema={subscriptionDomainInput}
        options={{ defaultValues: { domain: "" } }}
        className="flex flex-wrap items-end gap-2"
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
        {() => (
          <>
            <TextField<SubscriptionDomainInput>
              name="domain"
              label={t("staff.domains.domain")}
              dir="ltr"
              placeholder="sub.example.com"
              className="min-w-60 flex-1"
            />
            <Button type="submit" tone="primary" busy={adding.isLoading}>
              {t("staff.domains.add")}
            </Button>
          </>
        )}
      </Form>

      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : isError || !data ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : (
        <>
          <p className="text-sm">
            {t("staff.domains.linksOn")}{" "}
            <bdi dir="ltr" className="font-mono text-xs">
              {data.linkBase}/s/…
            </bdi>
          </p>
          {data.domains.length === 0 ? (
            <Placeholder>{t("staff.domains.none")}</Placeholder>
          ) : (
            <TableFrame>
              <thead>
                <tr>
                  <th>{t("staff.domains.domain")}</th>
                  <th>{t("staff.common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.domains.map((row) => (
                  <tr key={row.domain}>
                    <td>
                      <bdi dir="ltr" className="font-mono text-xs">
                        {row.domain}
                      </bdi>
                      {row.isPrimary ? (
                        <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          {t("staff.domains.primary")}
                        </span>
                      ) : null}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </>
      )}
    </Section>
  );
};
