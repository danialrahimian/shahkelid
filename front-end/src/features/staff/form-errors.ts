import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { normalizeError } from "@/lib/api-client";
import { codeText, errorText, isErrorCode } from "@/lib/error-text";

/**
 * Shows a failed save where it belongs: a field the server named gets its
 * message under that field (a taken slug, a group not on the panel), and
 * anything else becomes a toast.
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
    for (const field of fields) {
      methods.setError(rename[field.path!] ?? (field.path as Path<T>), {
        message: isErrorCode(field.msg) ? codeText(field.msg) : errorText(error),
      });
    }
    return;
  }
  toast.error(errorText(error));
};
