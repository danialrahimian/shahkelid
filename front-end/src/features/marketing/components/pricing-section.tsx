import { Check } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import {
  cardVariants,
  containerVariants,
  CountUp,
  riseVariants,
  SectionHeading,
  VIEWPORT,
} from "@/components/ui/motion-primitives";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";
import { useGetProductsQuery } from "@/api/products";
import type { Product } from "@/types/api";

/** Holds the card's shape while the real plan loads, so nothing jumps. */
const PlanSkeleton = () => (
  <motion.div variants={cardVariants}>
    <Card className="h-full border-border bg-card">
      <CardContent className="flex flex-col gap-6 p-8">
        <div className="space-y-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Separator />
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
        <Skeleton className="mt-2 h-9 w-full" />
      </CardContent>
    </Card>
  </motion.div>
);

const PlanCard = ({
  plan,
  popular,
}: {
  plan: Product;
  popular: boolean;
}) => (
  <motion.div
    variants={cardVariants}
    whileHover={{ y: -10 }}
    transition={{ type: "spring", stiffness: 260, damping: 22 }}
    // A margin, not a translate: a motion transform elsewhere on the element
    // would override a Tailwind translate class.
    className={popular ? "relative lg:-mt-4 lg:mb-4" : "relative"}
  >
    {popular ? (
      <motion.span
        aria-hidden
        animate={{ opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -inset-px rounded-xl bg-foreground/20 blur-md"
      />
    ) : null}

    <Card
      className={
        popular
          ? "relative h-full border-transparent bg-primary text-primary-foreground shadow-lg"
          : "relative h-full border-border bg-card"
      }
    >
      {popular ? (
        <motion.span
          initial={{ opacity: 0, y: -8, scale: 0.8 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={VIEWPORT}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 18,
            delay: 0.3,
          }}
          style={{ x: "-50%" }}
          className="absolute -top-3 left-1/2 z-10 rounded-full border border-border bg-background px-4 py-1 text-xs font-medium whitespace-nowrap text-foreground"
        >
          Most popular
        </motion.span>
      ) : null}

      <CardContent className="flex h-full flex-col gap-6 p-8">
        <div>
          <h3 className="text-lg font-semibold">{plan.name}</h3>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-extrabold tabular-nums">
              <CountUp value={plan.price} prefix="$" />
            </span>
            <span
              className={
                popular
                  ? "text-sm text-primary-foreground/60"
                  : "text-sm text-muted-foreground"
              }
            >
              {plan.period}
            </span>
          </div>
          <span
            className={
              popular
                ? "font-mono text-xs text-primary-foreground/45 line-through"
                : "font-mono text-xs text-muted-foreground/70 line-through"
            }
          >
            ${plan.price * 4}
          </span>
        </div>

        <Separator
          className={popular ? "bg-primary-foreground/15" : "bg-border"}
        />

        <motion.ul
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
          className="flex flex-col gap-3 text-sm"
        >
          {(plan.perks ?? []).map((perk) => (
            <motion.li
              key={perk}
              variants={riseVariants}
              className="flex items-center gap-2"
            >
              <Check className="size-4 shrink-0" strokeWidth={2.5} />
              {perk}
            </motion.li>
          ))}
        </motion.ul>

        <motion.div
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          className="mt-auto pt-2"
        >
          <Button
            asChild
            variant={popular ? "secondary" : "default"}
            className="w-full"
          >
            <Link to={paths.pricing.getHref()}>Choose {plan.name}</Link>
          </Button>
        </motion.div>
      </CardContent>
    </Card>
  </motion.div>
);

export const PricingSection = () => {
  // The landing page only shows the first three plans.
  const { data, isLoading, isError, error, refetch } = useGetProductsQuery({
    limit: 3,
  });
  const plans = data?.products ?? [];

  let content;
  if (isError) {
    content = (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the plans right now"
      />
    );
  } else if (isLoading) {
    content = (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {[0, 1, 2].map((index) => (
          <PlanSkeleton key={index} />
        ))}
      </motion.div>
    );
  } else if (plans.length === 0) {
    content = (
      <EmptyState
        title="No plans are available right now"
        description="Check back shortly, or get in touch and we will sort you out."
      />
    );
  } else {
    content = (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {plans.map((plan, index) => (
          <PlanCard
            key={plan._id}
            plan={plan}
            popular={index === 1 && plans.length > 1}
          />
        ))}
      </motion.div>
    );
  }

  return (
    <section id="plans" className="mx-auto max-w-6xl scroll-mt-20 px-2 py-24">
      <SectionHeading eyebrow="Plans" title="One key, every plan">
        <p className="max-w-lg text-sm text-muted-foreground">
          All three plans ship with 75% off — the only difference is length and
          perks.
        </p>
      </SectionHeading>

      {content}
    </section>
  );
};
