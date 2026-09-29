import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * How strong the password being typed looks.
 *
 * There was no feedback here at all before: the only signal was a rejection
 * after submitting. The score is a rough count of the habits that actually
 * help, and it is advisory, so nothing here blocks a submission the schema
 * already accepts.
 */
const score = (value: string) => {
  if (!value) return 0;

  let points = 0;
  if (value.length >= 6) points += 1;
  if (value.length >= 12) points += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1;
  if (/\d/.test(value)) points += 1;
  if (/[^\w\s]/.test(value)) points += 1;

  return Math.min(points, 4);
};

const LEVELS = [
  { label: "Too short", bar: "bg-destructive", text: "text-destructive" },
  { label: "Weak", bar: "bg-destructive", text: "text-destructive" },
  { label: "Fair", bar: "bg-amber-500", text: "text-amber-500" },
  { label: "Good", bar: "bg-sky-500", text: "text-sky-500" },
  { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-500" },
];

export const PasswordStrength = ({ value }: { value: string }) => {
  const level = score(value);
  const meta = LEVELS[level];

  return (
    <AnimatePresence initial={false}>
      {value ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 pt-1">
            <div
              className="flex flex-1 gap-1"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={level}
              aria-label="Password strength"
            >
              {[0, 1, 2, 3].map((segment) => (
                <span
                  key={segment}
                  className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  {/* Each segment fills from the left as the score climbs. */}
                  <motion.span
                    className={cn("block h-full origin-left rounded-full", meta.bar)}
                    initial={false}
                    animate={{ scaleX: segment < level ? 1 : 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </span>
              ))}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={meta.label}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className={cn("w-14 text-right text-xs font-medium", meta.text)}
              >
                {meta.label}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
