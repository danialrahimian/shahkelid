import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";

import { FieldError } from "@/components/ui/form/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled text input wired to the surrounding form.
 *
 * The caller passes a field name and a label; registration, the invalid state
 * and the error message are handled here, so no screen repeats that wiring.
 */
type InputFieldProps<TFormValues extends FieldValues> = {
  name: Path<TFormValues>;
  label: string;
  /** Sits to the left inside the field. */
  icon?: React.ReactNode;
  /** Rendered to the right inside the field, e.g. a reveal toggle. */
  trailing?: React.ReactNode;
  description?: string;
} & Omit<React.ComponentProps<"input">, "name">;

export const InputField = <TFormValues extends FieldValues>({
  name,
  label,
  icon,
  trailing,
  description,
  className,
  ...props
}: InputFieldProps<TFormValues>) => {
  const {
    register,
    formState: { errors },
  } = useFormContext<TFormValues>();
  const shouldReduceMotion = useReducedMotion();
  const fieldId = React.useId();

  const hasError = Boolean(
    name.split(".").reduce<unknown>((accumulator, key) => {
      if (accumulator && typeof accumulator === "object") {
        return (accumulator as Record<string, unknown>)[key];
      }
      return undefined;
    }, errors),
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </Label>

      {/* A wrong answer shakes once, which reads faster than colour alone. */}
      <motion.div
        className="relative"
        animate={
          hasError && !shouldReduceMotion
            ? { x: [0, -5, 5, -3, 3, 0] }
            : { x: 0 }
        }
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {icon ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary"
          >
            {icon}
          </span>
        ) : null}

        <Input
          id={fieldId}
          aria-invalid={hasError}
          aria-describedby={description ? `${fieldId}-description` : undefined}
          className={cn(
            "h-11 transition-shadow duration-200",
            icon && "pl-10",
            trailing && "pr-11",
            className,
          )}
          {...register(name)}
          {...props}
        />

        {trailing ? (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        ) : null}
      </motion.div>

      {description ? (
        <p id={`${fieldId}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}

      <FieldError name={name} />
    </div>
  );
};
