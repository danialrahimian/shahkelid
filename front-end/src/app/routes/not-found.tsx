import { Compass, Home } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { paths } from "@/config/paths";

/**
 * The catch-all route. There was none before, so a typo in the URL rendered a
 * blank page with the navigation still on it and no explanation.
 */
const NotFoundRoute = () => {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative isolate flex min-h-[70vh] flex-col items-center justify-center gap-6 overflow-hidden text-center">
      {/* A drifting halo behind the numerals, matching the home page's orbs. */}
      {!shouldReduceMotion ? (
        <motion.div
          aria-hidden
          className="absolute -z-10 size-[26rem] rounded-full bg-primary/10 blur-[100px]"
          animate={{ x: [0, 40, -30, 0], y: [0, -30, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      <motion.p
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="bg-linear-to-b from-foreground to-foreground/30 bg-clip-text text-8xl font-bold tracking-tighter text-transparent sm:text-9xl"
      >
        404
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-2"
      >
        <h1 className="text-2xl font-semibold tracking-tight">{t("notFound.title")}</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{t("notFound.body")}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-center justify-center gap-3"
      >
        <Button asChild className="group gap-2">
          <Link to={paths.home.getHref()}>
            <Home className="size-4 transition-transform group-hover:-translate-y-0.5" />
            {t("notFound.home")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="group gap-2">
          <Link to={paths.pricing.getHref()}>
            <Compass className="size-4 transition-transform duration-500 group-hover:rotate-180" />
            {t("nav.pricing")}
          </Link>
        </Button>
      </motion.div>
    </div>
  );
};

export default NotFoundRoute;
