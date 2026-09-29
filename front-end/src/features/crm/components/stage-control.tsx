import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useUpdateCustomerMutation } from "@/api/crm";
import { notifyApiError } from "@/lib/api-client";
import {
  LIFECYCLE_STAGE_ORDER,
  MANUAL_ONLY_STAGES,
  stageMetaFor,
} from "@/utils/lifecycle-stages";
import type { CustomerDetail, LifecycleStage } from "@/types/api";

/**
 * Setting a customer's stage by hand.
 *
 * An override wins, because somebody who has just spoken to the customer knows
 * more than a threshold does. What the rule says stays on screen next to it:
 * hiding it would leave a stale "VIP" from two years ago looking exactly like
 * a live one, with nothing to tell them apart.
 */

/** A Radix item cannot carry an empty value, so the reset uses a sentinel. */
const DERIVED = "__derived";

export const StageControl = ({ customer }: { customer: CustomerDetail }) => {
  const [updateCustomer, { isLoading }] = useUpdateCustomerMutation();

  const setStage = async (stage: LifecycleStage | "") => {
    try {
      await updateCustomer({ userId: customer.userId, stage }).unwrap();
      toast.success(
        stage === "" ? "Stage handed back to the data" : "Stage updated",
      );
    } catch (error) {
      notifyApiError(error, "Could not change the stage");
    }
  };

  const computed = stageMetaFor(customer.computedStage);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={customer.stageOverride ?? DERIVED}
          disabled={isLoading}
          onValueChange={(value) =>
            void setStage(value === DERIVED ? "" : (value as LifecycleStage))
          }
        >
          <SelectTrigger className="w-48" aria-label="Lifecycle stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DERIVED}>
              Follow the data ({computed.label})
            </SelectItem>
            {LIFECYCLE_STAGE_ORDER.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {stageMetaFor(stage).label}
                {MANUAL_ONLY_STAGES.includes(stage) ? " (by hand only)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLoading ? <Spinner className="size-4" /> : null}

        {customer.stageOverride !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={isLoading}
            onClick={() => void setStage("")}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>

      {customer.stageOverride !== null ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Set by hand. The data says
          <StageBadge stage={customer.computedStage} />
          {customer.computedStage !== customer.stageOverride
            ? "— reset to follow it again."
            : null}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{computed.description}</p>
      )}
    </div>
  );
};
