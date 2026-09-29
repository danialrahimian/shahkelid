import { motion } from "motion/react";

/**
 * What fills the page while a lazily loaded route arrives.
 *
 * A pulsing keyhole rather than a bare spinner, so the wait matches the rest
 * of the interface instead of looking like a different application.
 */
export const RouteFallback = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
    <div className="relative grid place-items-center">
      {/* Two rings expanding outward, staggered, like a slow sonar ping. */}
      {[0, 0.6].map((delay) => (
        <motion.span
          key={delay}
          aria-hidden
          className="absolute size-16 rounded-full border border-primary/40"
          initial={{ scale: 0.6, opacity: 0.7 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeOut",
            delay,
          }}
        />
      ))}

      <motion.span
        aria-hidden
        className="size-10 rounded-full bg-primary/15 ring-1 ring-primary/40"
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>

    <motion.p
      className="text-sm text-muted-foreground"
      animate={{ opacity: [0.45, 1, 0.45] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    >
      Loading
    </motion.p>
    <span className="sr-only" role="status">
      Loading page
    </span>
  </div>
);
