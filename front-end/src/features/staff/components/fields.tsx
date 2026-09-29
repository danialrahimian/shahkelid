import { toLatinDigits } from "@shah-kelid/contracts";
import * as React from "react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";

import { FieldError } from "@/components/ui/form/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Form fields for the staff forms, wired to the surrounding <Form>.
 * Errors are the shared schemas' codes, shown as sentences by FieldError.
 */

type Common<T extends FieldValues> = {
  name: Path<T>;
  label: string;
  hint?: string;
  className?: string;
};

const Frame = ({
  id,
  label,
  hint,
  name,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  name: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn("space-y-1.5", className)}>
    <Label htmlFor={id} className="text-sm font-medium">
      {label}
    </Label>
    {children}
    {hint ? (
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        {hint}
      </p>
    ) : null}
    <FieldError name={name} />
  </div>
);

export const TextField = <T extends FieldValues>({
  name,
  label,
  hint,
  className,
  ...input
}: Common<T> & Omit<React.ComponentProps<"input">, "name">) => {
  const { register } = useFormContext<T>();
  const id = React.useId();
  return (
    <Frame id={id} label={label} hint={hint} name={name} className={className}>
      <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className="h-10" {...input} {...register(name)} />
    </Frame>
  );
};

/**
 * A number, typed in any digits (۱۵۰۰۰۰ or 150,000). Empty is null, which
 * the schema reads as "unlimited" where that is allowed and as missing
 * where it is not.
 */
export const NumberField = <T extends FieldValues>({
  name,
  label,
  hint,
  className,
  placeholder,
}: Common<T> & { placeholder?: string }) => {
  const { register } = useFormContext<T>();
  const id = React.useId();
  return (
    <Frame id={id} label={label} hint={hint} name={name} className={className}>
      <Input
        id={id}
        dir="ltr"
        inputMode="decimal"
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-10 tabular-nums"
        {...register(name, {
          setValueAs: (value: unknown) => {
            if (value === null || value === undefined) return null;
            const text = toLatinDigits(String(value)).replace(/[,٬\s]/g, "");
            return text === "" ? null : Number(text);
          },
        })}
      />
    </Frame>
  );
};

export const SelectField = <T extends FieldValues>({
  name,
  label,
  hint,
  className,
  options,
  placeholder,
  numeric = false,
}: Common<T> & {
  options: { value: string; label: string }[];
  placeholder?: string;
  /** The value is a number (a panel group id), not text. */
  numeric?: boolean;
}) => {
  const { register } = useFormContext<T>();
  const id = React.useId();
  return (
    <Frame id={id} label={label} hint={hint} name={name} className={className}>
      <select
        id={id}
        className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        {...register(
          name,
          numeric ? { setValueAs: (value: string) => (value === "" ? null : Number(value)) } : {},
        )}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Frame>
  );
};

export const CheckField = <T extends FieldValues>({
  name,
  label,
  className,
}: Omit<Common<T>, "hint">) => {
  const { register } = useFormContext<T>();
  const id = React.useId();
  return (
    <label htmlFor={id} className={cn("flex items-center gap-2.5 text-sm", className)}>
      <input id={id} type="checkbox" className="size-4 accent-primary" {...register(name)} />
      {label}
    </label>
  );
};

/** The form's buttons: the action first (on the start side), then cancel. */
export const FormActions = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap gap-2 border-t pt-4">{children}</div>
);
