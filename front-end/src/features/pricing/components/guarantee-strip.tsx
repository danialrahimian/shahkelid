import { CreditCard, Headphones, RotateCcw, ShieldCheck } from "lucide-react";
import { motion, type Variants } from "motion/react";

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const PROMISES = [
  {
    icon: RotateCcw,
    title: "30-day money-back guarantee",
    body: "Change your mind within a month and you get everything back, no questions asked.",
  },
  {
    icon: ShieldCheck,
    title: "No logs, by design",
    body: "There is no record of what you did, because none is written in the first place.",
  },
  {
    icon: CreditCard,
    title: "Cancel whenever",
    body: "No notice period and no exit fee. Your plan simply stops renewing.",
  },
  {
    icon: Headphones,
    title: "Support that answers",
    body: "Real people, every day of the week, on every plan we sell.",
  },
];

/**
 * What the price comes with, beyond the features.
 *
 * A pricing page asks for money, and the objections at that moment are about
 * risk rather than capability. This answers those, which is why it sits
 * directly beneath the cards.
 */
export const GuaranteeStrip = () => (
  <motion.section
    variants={containerVariants}
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.2 }}
    className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
    aria-label="What every plan includes"
  >
    {PROMISES.map(({ icon: Icon, title, body }) => (
      <motion.div
        key={title}
        variants={itemVariants}
        whileHover={{ y: -6 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        className="group rounded-xl border border-border bg-card/50 p-5"
      >
        <motion.div
          whileHover={{ rotate: -10, scale: 1.1 }}
          transition={{ type: "spring", stiffness: 320, damping: 14 }}
          className="mb-3 grid size-10 place-items-center rounded-lg border border-border bg-muted/40 text-primary"
        >
          <Icon className="size-5" />
        </motion.div>

        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </motion.div>
    ))}
  </motion.section>
);
