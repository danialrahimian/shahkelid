import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";
import * as React from "react";

/**
 * The motion vocabulary the whole interface shares.
 *
 * These variants and the count-up were copied between the home page, the
 * product cards and the invoice list, each copy drifting a little in duration
 * or easing. Defining them once is what makes separate screens feel like one
 * product.
 */

/** Staggers children so a group arrives in sequence, not all at once. */
export const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
};

/** Text and small elements rising into focus. */
export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

/** Cards, which settle with a little spring rather than a linear fade. */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 34, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 200, damping: 24, mass: 0.9 },
  },
};

/** Rows in a list, sliding in from the leading edge. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -18 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Play an in-view animation once, after a fifth of the element is visible. */
export const VIEWPORT = { once: true, amount: 0.2 } as const;

/** The moving sheen used behind gradient headings. */
export const SHEEN =
  "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)";

/**
 * Counts up to `value` the first time it scrolls into view.
 *
 * Respects a reduced-motion preference by jumping straight to the final
 * number, so the information is never withheld from someone who asked the
 * system for less movement.
 */
export const CountUp = ({
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  duration = 1.4,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
}) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const shouldReduceMotion = useReducedMotion();
  const raw = useMotionValue(0);
  const text = useTransform(
    raw,
    (current: number) => `${prefix}${current.toFixed(decimals)}${suffix}`,
  );

  React.useEffect(() => {
    if (!inView) return;

    if (shouldReduceMotion) {
      raw.set(value);
      return;
    }

    const controls = animate(raw, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, raw, value, shouldReduceMotion, duration]);

  return <motion.span ref={ref}>{text}</motion.span>;
};

/**
 * The eyebrow, heading and optional blurb that opens a section.
 */
export const SectionHeading = ({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) => (
  <motion.div
    variants={containerVariants}
    initial="hidden"
    whileInView="show"
    viewport={VIEWPORT}
    className="mb-14 flex flex-col items-center gap-3 text-center"
  >
    <motion.span
      variants={riseVariants}
      className="text-xs font-medium tracking-widest text-muted-foreground uppercase"
    >
      {eyebrow}
    </motion.span>
    <motion.h2 variants={riseVariants} className="text-3xl font-bold sm:text-4xl">
      {title}
    </motion.h2>
    {children ? (
      <motion.div variants={riseVariants}>{children}</motion.div>
    ) : null}
  </motion.div>
);
