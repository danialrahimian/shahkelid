import { motion } from "motion/react";

import { VIEWPORT } from "@/components/ui/motion-primitives";
import { SERVERS } from "@/features/marketing/constants";

/**
 * The band of server locations sliding past.
 *
 * The list is rendered twice and the track is translated by exactly half its
 * width, which is what makes the loop seamless. Hovering pauses it so a name
 * can actually be read, and the CSS turns the animation off entirely for
 * anyone who asked for reduced motion.
 */
export const ServerMarquee = () => (
  <motion.div
    initial={{ opacity: 0 }}
    whileInView={{ opacity: 1 }}
    viewport={VIEWPORT}
    transition={{ duration: 0.6 }}
    className="marquee-mask overflow-hidden border-y border-border bg-muted/20 py-4"
  >
    <div className="marquee flex w-max gap-10 text-sm whitespace-nowrap text-muted-foreground">
      {[...SERVERS, ...SERVERS].map((server, index) => (
        <span
          key={`${server}-${index}`}
          className="flex items-center gap-2 transition-colors hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          {server}
        </span>
      ))}
    </div>
  </motion.div>
);
