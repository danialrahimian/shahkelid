import { Check, Minus } from "lucide-react";
import { motion } from "motion/react";

import {
  collectFeatures,
  type PricingPlan,
} from "@/features/pricing/billing-term";
import { cn } from "@/lib/utils";

/**
 * Every feature against every plan.
 *
 * The cards say what each plan includes; this says what each plan leaves out,
 * which is the question somebody comparing them is actually asking. The
 * columns are built from the plans themselves, so adding a plan in the admin
 * panel widens the table without anyone editing it.
 */
export const PlanComparison = ({ plans }: { plans: PricingPlan[] }) => {
  const features = collectFeatures(plans);

  // Nothing to compare with a single plan, or with no features on any of them.
  if (plans.length < 2 || features.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mt-20"
      aria-labelledby="compare-heading"
    >
      <h2
        id="compare-heading"
        className="mb-8 text-center text-2xl font-bold tracking-tight sm:text-3xl"
      >
        Compare the plans
      </h2>

      {/* The only element allowed to scroll sideways, and it does so on its
          own rather than pushing the page out at narrow widths. */}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-150 border-collapse text-sm">
          <caption className="sr-only">
            Features included in each subscription plan
          </caption>

          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="p-4 text-left font-semibold">
                Feature
              </th>

              {plans.map((plan) => (
                <th
                  key={plan.product._id}
                  scope="col"
                  className={cn(
                    "p-4 text-center font-semibold",
                    plan.recommended && "text-primary",
                  )}
                >
                  <span className="block">{plan.product.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    ${plan.monthlyPrice.toFixed(2)}/mo
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {features.map((feature, rowIndex) => (
              <motion.tr
                key={feature}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.3,
                  delay: Math.min(rowIndex * 0.04, 0.4),
                }}
                className="border-b border-border last:border-b-0 hover:bg-muted/30"
              >
                <th
                  scope="row"
                  className="p-4 text-left font-normal text-muted-foreground"
                >
                  {feature}
                </th>

                {plans.map((plan) => {
                  const included = (plan.product.perks ?? []).some(
                    (perk) => perk.trim() === feature,
                  );

                  return (
                    <td
                      key={plan.product._id}
                      className={cn(
                        "p-4 text-center",
                        plan.recommended && "bg-primary/5",
                      )}
                    >
                      {/* A word for screen readers, an icon for everyone else. */}
                      <span className="sr-only">
                        {included ? "Included" : "Not included"}
                      </span>

                      {included ? (
                        <span
                          aria-hidden
                          className="inline-grid size-5 place-items-center rounded-full bg-emerald-500/15 text-emerald-500"
                        >
                          <Check className="size-3.5" strokeWidth={3} />
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          className="inline-grid size-5 place-items-center text-muted-foreground/40"
                        >
                          <Minus className="size-3.5" />
                        </span>
                      )}
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
};
