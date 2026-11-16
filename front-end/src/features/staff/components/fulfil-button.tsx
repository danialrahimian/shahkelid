import type { OrderView } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useStaffFulfilOrderMutation } from "@/api/staff";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";

import { Button } from "./staff-ui";

/**
 * "Make subscription" (or, for a renewal, "apply it again") for a paid order
 * that has no service. When it still cannot be made, the toast says why in
 * the server's own words: which panel, server or capacity is in the way.
 */
export const FulfilButton = ({ order }: { order: Pick<OrderView, "id" | "kind"> }) => {
  const { t } = useTranslation();
  const [fulfil, { isLoading }] = useStaffFulfilOrderMutation();
  const renewal = order.kind === "renewal";
  return (
    <Button
      tone="primary"
      busy={isLoading}
      onClick={() =>
        fulfil(order.id)
          .unwrap()
          .then(() => toast.success(renewal ? t("staff.orders.renewalRequested") : t("staff.orders.fulfilled")))
          .catch((error: unknown) => {
            const detail = normalizeError(error).message;
            toast.error(errorText(error), {
              description: detail ? <span dir="ltr">{detail}</span> : undefined,
            });
          })
      }
    >
      {renewal ? t("staff.orders.applyRenewal") : t("staff.orders.fulfil")}
    </Button>
  );
};
