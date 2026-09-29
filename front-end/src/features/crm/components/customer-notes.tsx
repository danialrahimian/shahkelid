import { NotebookPen, Send, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldError, Form } from "@/components/ui/form/form";
import { Spinner } from "@/components/ui/spinner";
import {
  noteInputSchema,
  useAddCustomerNoteMutation,
  useDeleteCustomerNoteMutation,
  type NoteInput,
} from "@/api/crm";
import { notifyApiError } from "@/lib/api-client";
import { formatDateTime } from "@/utils/format";
import type { CustomerDetail } from "@/types/api";

/**
 * What the team knows that the orders do not say.
 *
 * Notes are attributed and timestamped, and they are never shown to the
 * customer. Both of those are the point: an unattributed note is a rumour, and
 * a note the subject can read is a different document entirely.
 */

const NoteBox = ({ isSending }: { isSending: boolean }) => {
  const { register, watch } = useFormContext<NoteInput>();
  const value = watch("body") ?? "";
  const canSend = value.trim().length > 0 && !isSending;

  return (
    <div className="space-y-2">
      <textarea
        rows={3}
        placeholder="What happened? Who asked for what?"
        aria-label="Add a note"
        maxLength={2000}
        className="flex w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        {...register("body")}
        onKeyDown={(event) => {
          // Enter makes a new line; the modifier saves. A note is prose.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <FieldError name="body" />

        <Button
          type="submit"
          size="sm"
          className="ml-auto gap-1.5"
          disabled={!canSend}
        >
          {isSending ? (
            <Spinner className="size-4" />
          ) : (
            <Send className="size-4" />
          )}
          {isSending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
};

export const CustomerNotes = ({ customer }: { customer: CustomerDetail }) => {
  const [addNote, { isLoading: isAdding }] = useAddCustomerNoteMutation();
  const [deleteNote, { isLoading: isDeleting }] =
    useDeleteCustomerNoteMutation();

  return (
    <div className="space-y-5">
      <Form<NoteInput>
        schema={noteInputSchema}
        options={{ defaultValues: { body: "" } }}
        className="space-y-0"
        onSubmit={async (values, methods) => {
          try {
            await addNote({
              userId: customer.userId,
              body: values.body,
            }).unwrap();
            // Cleared only on success, so a failed save does not lose the text.
            methods.reset();
            toast.success("Note added");
          } catch (error) {
            notifyApiError(error, "Could not save the note");
          }
        }}
      >
        {() => <NoteBox isSending={isAdding} />}
      </Form>

      {customer.notes.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          <NotebookPen className="size-4 shrink-0" />
          Nothing recorded about this account yet.
        </p>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence mode="popLayout">
            {customer.notes.map((note) => (
              <motion.li
                key={note._id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="group rounded-lg border border-border/60 bg-muted/30 p-3"
              >
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>

                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {note.author.name}
                  </span>
                  <span aria-hidden>·</span>
                  <time dateTime={note.createdAt}>
                    {formatDateTime(note.createdAt)}
                  </time>

                  <button
                    type="button"
                    aria-label="Delete this note"
                    disabled={isDeleting}
                    className="ml-auto rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                    onClick={async () => {
                      try {
                        await deleteNote({
                          userId: customer.userId,
                          noteId: note._id,
                        }).unwrap();
                        toast.success("Note deleted");
                      } catch (error) {
                        notifyApiError(error, "Could not delete the note");
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
};
