import { motion, useScroll, useSpring } from "motion/react";

import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { ClosingCta } from "@/features/marketing/components/closing-cta";
import { FaqSection } from "@/features/marketing/components/faq-section";
import { FeaturesSection } from "@/features/marketing/components/features-section";
import { Hero } from "@/features/marketing/components/hero";
import { PricingSection } from "@/features/marketing/components/pricing-section";
import { ServerMarquee } from "@/features/marketing/components/server-marquee";

/**
 * The landing page, composed from sections rather than written as one piece.
 *
 * It used to be a single 800-line component holding its own copy, its own
 * animation variants and its own data fetching. Each section is now its own
 * file, and the only section that talks to the server sits behind its own
 * boundary, so a catalogue outage costs the pricing table and nothing else.
 */
const HomeRoute = () => {
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
      <ServerMarquee />
      <FeaturesSection />

      <AppErrorBoundary>
        <PricingSection />
      </AppErrorBoundary>

      <FaqSection />
      <ClosingCta />
    </div>
  );
};

export default HomeRoute;
