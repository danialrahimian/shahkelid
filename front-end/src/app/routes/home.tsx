import { motion, useScroll, useSpring } from "motion/react";
import { useTranslation } from "react-i18next";

import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { ClosingCta } from "@/features/marketing/components/closing-cta";
import { FaqSection } from "@/features/marketing/components/faq-section";
import { FeaturesSection } from "@/features/marketing/components/features-section";
import { Hero } from "@/features/marketing/components/hero";
import { PlanCards } from "@/features/shop/components/plan-cards";

/**
 * The landing page, composed from sections rather than written as one piece.
 *
 * It used to be a single 800-line component holding its own copy, its own
 * animation variants and its own data fetching. Each section is now its own
 * file, and the only section that talks to the server sits behind its own
 * boundary, so a catalogue outage costs the pricing table and nothing else.
 */
const HomeRoute = () => {
  const { t } = useTranslation();
  const { scrollYProgress } = useScroll();
  // Spring-smoothed, so the bar glides instead of tracking every wheel tick.
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <div className="text-foreground">
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-foreground/70"
      />

      <Hero />
      <FeaturesSection />

      <AppErrorBoundary>
        <section id="plans" className="mx-auto max-w-5xl scroll-mt-20 space-y-8 px-4 py-16" aria-labelledby="home-plans-title">
          <div className="space-y-2 text-center">
            <h2 id="home-plans-title" className="text-3xl font-bold text-balance">
              {t("shop.plans.title")}
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">{t("shop.plans.subtitle")}</p>
          </div>
          <PlanCards />
        </section>
      </AppErrorBoundary>

      <FaqSection />
      <ClosingCta />
    </div>
  );
};

export default HomeRoute;
