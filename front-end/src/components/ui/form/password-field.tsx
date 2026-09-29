import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import type { FieldValues, Path } from "react-hook-form";

import { InputField } from "@/components/ui/form/input-field";

/**
 * A password field with a reveal toggle.
 *
 * The eye swaps with a small cross-fade and rotation instead of snapping, and
 * the button keeps the press-and-hover response the original inputs had.
 */
type PasswordFieldProps<TFormValues extends FieldValues> = {
  name: Path<TFormValues>;
  label: string;
  icon?: React.ReactNode;
  description?: string;
} & Omit<React.ComponentProps<"input">, "name" | "type">;

export const PasswordField = <TFormValues extends FieldValues>({
  name,
  label,
  ...props
}: PasswordFieldProps<TFormValues>) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <InputField<TFormValues>
      name={name}
      label={label}
      type={visible ? "text" : "password"}
      autoComplete="current-password"
      trailing={
        <motion.button
          type="button"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={visible ? "visible" : "hidden"}
              initial={{ opacity: 0, rotate: -35, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 35, scale: 0.7 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {visible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      }
      {...props}
    />
  );
};
