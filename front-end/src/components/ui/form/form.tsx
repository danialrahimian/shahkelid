import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import {
  FormProvider,
  useForm,
  useFormContext,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { ZodType } from "zod";

import { cn } from "@/lib/utils";

/**
 * One form abstraction for the whole application.
 *
 * Every form used to keep a `useState` per field plus its own error object,
 * which is where most of the duplicated code in the auth and product screens
 * came from. This wraps react-hook-form and zod so a screen declares a schema
 * and a set of fields, and validation, error display and submit state come
 * for free and behave identically everywhere.
 */

/**
 * The submit handler is given the form's own methods as a second argument.
 *
 * Without it, a form that needs to clear itself after a successful submit had
 * to bypass the <form> element entirely and drive submission from a button's
 * onClick, because `reset` was only reachable from the render prop. Passing
 * the methods through keeps every form a real form.
 */
type FormSubmitHandler<TFormValues extends FieldValues> = (
  values: TFormValues,
  methods: UseFormReturn<TFormValues>,
) => unknown | Promise<unknown>;

type FormProps<TFormValues extends FieldValues> = {
  onSubmit: FormSubmitHandler<TFormValues>;
  schema: ZodType<TFormValues>;
  className?: string;
  children: (methods: UseFormReturn<TFormValues>) => React.ReactNode;
  options?: Omit<UseFormProps<TFormValues>, "resolver">;
  id?: string;
};

export const Form = <TFormValues extends FieldValues>({
  onSubmit,
  children,
  className,
  options,
  id,
  schema,
}: FormProps<TFormValues>) => {
  const methods = useForm<TFormValues>({
    ...options,
    resolver: zodResolver(schema) as Resolver<TFormValues>,
    // Check a field once the user has left it, then live as they fix it.
    // Validating from the first keystroke shouts at someone still typing.
    mode: options?.mode ?? "onTouched",
  });

  return (
    <FormProvider {...methods}>
      <form
        className={cn("space-y-5", className)}
        onSubmit={methods.handleSubmit((values) =>
          onSubmit(values, methods),
        )}
        id={id}
        noValidate
      >
        {children(methods)}
      </form>
    </FormProvider>
  );
};

/** Reads a possibly nested error message, e.g. "address.city". */
const messageAt = (
  errors: Record<string, unknown>,
  name: string,
): string | undefined => {
  const node = name.split(".").reduce<unknown>((accumulator, key) => {
    if (accumulator && typeof accumulator === "object") {
      return (accumulator as Record<string, unknown>)[key];
    }
    return undefined;
  }, errors);

  if (node && typeof node === "object" && "message" in node) {
    const { message } = node as { message?: unknown };
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
};

/**
 * The message under a field.
 *
 * It slides open rather than appearing instantly, so the layout shift reads as
 * deliberate and the eye is drawn to what needs fixing.
 */
export const FieldError = ({ name }: { name: string }) => {
  const {
    formState: { errors },
  } = useFormContext();

  const message = messageAt(errors as Record<string, unknown>, name);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {message ? (
        <motion.p
          key={message}
          role="alert"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden text-sm font-medium text-destructive"
        >
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
};
