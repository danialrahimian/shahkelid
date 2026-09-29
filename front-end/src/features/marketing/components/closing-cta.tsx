import { Key } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cardVariants, VIEWPORT } from "@/components/ui/motion-primitives";
import { paths } from "@/config/paths";

export const ClosingCta = () => (
  <section className="mx-auto max-w-4xl px-2 pb-24 text-center">
    <motion.div
      variants={cardVariants}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      className="group relative"
    >
      {/* A halo that breathes, drawing the eye to the last call to action. */}
      <motion.div
        aria-hidden
        animate={{ opacity: [0.2, 0.45, 0.2] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -inset-1 rounded-xl bg-foreground/15 blur-xl"
      />

      <Card className="relative overflow-hidden border-border bg-card px-6 py-14">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-full w-1/3 -skew-x-12 bg-linear-to-r from-transparent via-foreground/10 to-transparent transition-all duration-1000 group-hover:left-[200%]"
        />
        <CardContent className="flex flex-col items-center gap-6 p-0">
          <motion.div
            animate={{ rotate: [0, -8, 8, 0], y: [0, -5, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Key className="size-8" strokeWidth={1.5} />
          </motion.div>

          <h2 className="text-2xl font-bold sm:text-3xl">
            Grab your key. We'll handle the rest.
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Start today at 75% off, backed by a 30-day money-back guarantee, no
            questions asked.
          </p>

          <motion.div
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 20 }}
          >
            <Button size="lg" asChild className="px-10">
              <Link to={paths.pricing.getHref()}>Get Shah Kelid now</Link>
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  </section>
);
