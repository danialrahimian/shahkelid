import { Send } from "lucide-react";
import { motion } from "motion/react";
import { useFormContext } from "react-hook-form";
import { Link } from "react-router";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FieldError, Form } from "@/components/ui/form/form";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import {
  commentInputSchema,
  useAddCommentMutation,
  type CommentInput,
} from "@/api/posts";
import { notifyApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { assetUrl } from "@/utils/asset-url";

const LIMIT = 1000;

/** The box itself, plus a counter that only appears once it matters. */
const CommentBox = ({ isSending }: { isSending: boolean }) => {
  const { register, watch } = useFormContext<CommentInput>();
  const value = watch("body") ?? "";
  const remaining = LIMIT - value.length;
  const canSend = value.trim().length > 0 && remaining >= 0 && !isSending;

  return (
    <div className="flex-1 space-y-2">
      <textarea
        rows={2}
        placeholder="Add a comment…"
        aria-label="Add a comment"
        className="flex w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        {...register("body")}
        onKeyDown={(event) => {
          // Enter alone inserts a newline; the modifier sends, which is what
          // people expect from a comment box rather than a document.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <FieldError name="body" />

        <div className="ml-auto flex items-center gap-3">
          {/* Silent until the limit is within reach, then it speaks up. */}
          {remaining < 120 ? (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={
                remaining < 0
                  ? "text-xs font-medium text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {remaining}
            </motion.span>
          ) : null}

          <motion.div
            whileHover={canSend ? { scale: 1.04 } : undefined}
            whileTap={canSend ? { scale: 0.96 } : undefined}
            transition={{ type: "spring", stiffness: 360, damping: 20 }}
          >
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={!canSend}
            >
              {isSending ? (
                <Spinner className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {isSending ? "Posting…" : "Post"}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

/**
 * Writing a comment.
 *
 * Signed-out readers see an invitation to sign in rather than a box that
 * rejects them after they have typed a paragraph.
 */
export const CommentForm = ({
  postId,
  slug,
}: {
  postId: string;
  slug: string;
}) => {
  const { user, isLoggedIn } = useSession();
  const [addComment, { isLoading }] = useAddCommentMutation();

  if (!isLoggedIn) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3"
      >
        <p className="text-sm text-muted-foreground">
          Sign in to join the conversation.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to={paths.auth.getHref(paths.post.getHref(slug))}>Sign in</Link>
        </Button>
      </motion.div>
    );
  }

  const avatar = assetUrl(user?.avatar);
  const name = user?.displayName || user?.username || "";

  return (
    <Form<CommentInput>
      schema={commentInputSchema}
      options={{ defaultValues: { body: "" } }}
      className="space-y-0"
      onSubmit={async (values, methods) => {
        try {
          await addComment({ postId, slug, body: values.body }).unwrap();
          // Emptied only on success, so a failed send does not lose the text.
          methods.reset();
          toast.success("Comment posted");
        } catch (error) {
          notifyApiError(error, "Could not post your comment");
        }
      }}
    >
      {() => (
        <div className="flex gap-3">
          <Avatar className="mt-1 size-9 shrink-0">
            {avatar ? <AvatarImage src={avatar} alt="" /> : null}
            <AvatarFallback className="text-xs">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <CommentBox isSending={isLoading} />
        </div>
      )}
    </Form>
  );
};
