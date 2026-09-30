import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import {
  cardVariants,
  containerVariants,
  SectionHeading,
  VIEWPORT,
} from "@/components/ui/motion-primitives";
import { FEATURES } from "@/features/marketing/constants";

export const FeaturesSection = () => {
  const { t } = useTranslation();
  return (
    <section id="features" className="mx-auto max-w-6xl px-2 py-24">
      <SectionHeading eyebrow={t("marketing.features.eyebrow")} title={t("marketing.features.title")} />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        {FEATURES.map(({ icon: Icon, key }) => (
          <motion.div
            key={key}
            variants={cardVariants}
            whileHover={{ y: -8 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="group relative"
          >
            <Card className="relative h-full overflow-hidden border-border bg-card transition-colors duration-300 group-hover:border-foreground/25">
              {/* A band of light sweeping across the card on hover. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -start-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-foreground/10 to-transparent transition-all duration-700 group-hover:start-[150%]"
              />
              <CardContent className="flex flex-col gap-4 p-6">
                <motion.div
                  whileHover={{ rotate: -10, scale: 1.12 }}
                  transition={{ type: "spring", stiffness: 300, damping: 14 }}
                  className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/40"
                >
                  <Icon className="size-5" strokeWidth={2} />
                </motion.div>
                <h3 className="text-lg font-semibold">{t(`marketing.features.items.${key}.title`)}</h3>
                <p className="text-sm leading-7 text-muted-foreground">{t(`marketing.features.items.${key}.desc`)}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
};
