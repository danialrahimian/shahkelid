import { ArrowRight, ChevronDown } from "lucide-react";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Link } from "react-router";

import { GradientText } from "@/components/animate-ui/primitives/texts/gradient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  containerVariants,
  CountUp,
  riseVariants,
  SHEEN,
} from "@/components/ui/motion-primitives";
import { paths } from "@/config/paths";
import { STATS } from "@/features/marketing/constants";

/**
 * The keyhole that glows behind the headline: the page's signature image.
 *
 * It is an SVG mask rather than a picture, so it takes its colour from the
 * theme and stays crisp at any size. Translation uses a motion `x` value
 * instead of a Tailwind transform class, because an inline transform from
 * motion overrides the class entirely and the two cannot be mixed.
 */
const KeyholeGlow = ({
  y,
  scale,
}: {
  y: MotionValue<number>;
  scale: MotionValue<number>;
}) => (
  <motion.div
    aria-hidden
    style={{ x: "-50%", y, scale }}
    className="pointer-events-none absolute top-4 left-1/2 z-0 h-140 w-140 opacity-[0.14] sm:h-180 sm:w-180"
  >
    <motion.div
      animate={{ opacity: [0.75, 1, 0.75], scale: [1, 1.04, 1] }}
      transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      className="h-full w-full"
    >
      <svg viewBox="0 0 200 200" className="h-full w-full">
        <defs>
          <radialGradient id="keyholeGlow" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="var(--foreground)" />
            <stop offset="55%" stopColor="var(--muted-foreground)" />
            <stop offset="100%" stopColor="var(--background)" stopOpacity="0" />
          </radialGradient>
          <mask id="keyholeMask">
            <rect width="200" height="200" fill="white" />
            <circle cx="100" cy="70" r="26" fill="black" />
            <path
              d="M 88 92 L 112 92 L 124 156 A 24 24 0 0 1 76 156 Z"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="200"
          height="200"
          fill="url(#keyholeGlow)"
          mask="url(#keyholeMask)"
        />
      </svg>
    </motion.div>
  </motion.div>
);

/** Two slow-drifting orbs and a masked grid, sitting behind everything. */
const HeroBackdrop = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
    <div className="hero-grid absolute inset-0 opacity-[0.06]" />
    <motion.div
      animate={{ x: [0, 40, 0], y: [0, -30, 0], scale: [1, 1.15, 1] }}
      transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      className="absolute top-24 -left-20 size-72 rounded-full bg-foreground/10 blur-3xl"
    />
    <motion.div
      animate={{ x: [0, -50, 0], y: [0, 40, 0], scale: [1, 1.2, 1] }}
      transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      className="absolute top-40 -right-24 size-80 rounded-full bg-primary/10 blur-3xl"
    />
  </div>
);

export const Hero = () => {
  const { scrollY } = useScroll();
  // The glow sinks and swells as the page scrolls, giving the hero depth.
  const glowY = useTransform(scrollY, [0, 700], [0, 140]);
  const glowScale = useTransform(scrollY, [0, 700], [1, 1.25]);
  const heroFade = useTransform(scrollY, [0, 420], [1, 0]);

  return (
    <section className="relative overflow-hidden px-2 pt-14 pb-24 sm:pt-20">
      <KeyholeGlow y={glowY} scale={glowScale} />
      <HeroBackdrop />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto flex max-w-4xl flex-col items-center gap-6 text-center"
      >
        <motion.div variants={riseVariants}>
          <motion.div
            whileHover={{ scale: 1.04 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
          >
            <Badge
              variant="outline"
              className="rounded-full border-border bg-muted/40 px-4 py-1.5 text-foreground/90"
            >
              <GradientText
                gradient={SHEEN}
                text="🔑 Limited-time offer — 75% off today"
                className="text-sm font-medium"
              />
            </Badge>
          </motion.div>
        </motion.div>

        <motion.div variants={riseVariants} className="w-full">
          <GradientText
            gradient={SHEEN}
            text="The master key to an open internet"
            className="w-full text-4xl leading-[1.15] font-extrabold sm:text-5xl lg:text-6xl"
          />
        </motion.div>

        <motion.p
          variants={riseVariants}
          className="max-w-2xl text-base leading-8 text-balance text-muted-foreground sm:text-lg"
        >
          Real speeds, strong encryption, and 80+ servers in 50 countries.
          Connect to anything, anywhere — no throttling, no limits.
        </motion.p>

        <motion.div
          variants={riseVariants}
          className="mt-2 flex flex-col items-center gap-3 sm:flex-row"
        >
          <motion.div
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 20 }}
          >
            <Button size="lg" asChild className="group gap-2 px-8">
              <Link to={paths.pricing.getHref()}>
                Get Shah Kelid now
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 20 }}
          >
            <Button size="lg" variant="ghost" asChild>
              <a href="#plans">View plans</a>
            </Button>
          </motion.div>
        </motion.div>

        <motion.div
          variants={containerVariants}
          className="mt-10 grid w-full grid-cols-2 gap-6 border-t border-border pt-8 sm:grid-cols-4"
        >
          {STATS.map((stat) => (
            <motion.div
              key={stat.label}
              variants={riseVariants}
              whileHover={{ y: -4, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex flex-col items-center gap-1"
            >
              <span className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">
                {stat.text ?? (
                  <CountUp
                    value={stat.value ?? 0}
                    decimals={stat.decimals}
                    suffix={stat.suffix}
                  />
                )}
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {stat.label}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      {/* Fades out as soon as the visitor takes the hint and scrolls. */}
      <motion.div
        aria-hidden
        style={{ opacity: heroFade }}
        className="pointer-events-none mt-14 flex justify-center"
      >
        <motion.span
          animate={{ y: [0, 9, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </motion.div>
    </section>
  );
};
