import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { toastFormErrors } from "@/components/ui/form/form";
import { normalizeError } from "@/lib/api-client";
import { codeText, errorText, isErrorCode } from "@/lib/error-text";

/**
 * Shows a failed save where it belongs: a field the server named gets its
 * message under that field (a taken slug, a group not on the panel), and
 * every failure is a toast too, so none goes unseen.
 */
export const showSaveError = <T extends FieldValues>(
  error: unknown,
  methods: UseFormReturn<T>,
  /** Server field names that the form calls something else ("panels" → "panelIds"). */
  rename: Record<string, Path<T>> = {},
) => {
  const normalized = normalizeError(error);
  const fields = normalized.errors.filter((entry) => entry.path);
  if (fields.length > 0) {
    const messages = fields.map((field) => {
      const message = isErrorCode(field.msg) ? codeText(field.msg) : errorText(error);
      methods.setError(rename[field.path!] ?? (field.path as Path<T>), { message });
      return message;
    });
    toastFormErrors(messages);
    return;
  }
  toast.error(errorText(error));
};
