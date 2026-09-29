import { MessageCircle, Trash2 } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteCommentMutation,
  useGetCommentsQuery,
} from "@/api/posts";
import { notifyApiError } from "@/lib/api-client";
import { useAuthorization } from "@/lib/authorization";
import type { Comment } from "@/types/api";
import { assetUrl } from "@/utils/asset-url";
import { formatDateTime } from "@/utils/format";

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -14 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, x: 24, height: 0, transition: { duration: 0.22 } },
};

const CommentRow = ({
  comment,
  slug,
  canModerate,
}: {
  comment: Comment;
  slug: string;
  canModerate: boolean;
}) => {
  const [deleteComment, { isLoading }] = useDeleteCommentMutation();
  const avatar = assetUrl(comment.author.avatar);

  // The server allows the author or a moderator; the button follows the same
  // rule so it is never offered where it would be refused.
  const canDelete = comment.mine || canModerate;

  const handleDelete = async () => {
    try {
      await deleteComment({
        commentId: comment._id,
        postId: comment.postId,
        slug,
      }).unwrap();
      toast.success("Comment deleted");
    } catch (error) {
      notifyApiError(error, "Could not delete that comment");
    }
  };

  return (
    <motion.li
      layout
      variants={rowVariants}
      exit="exit"
      className="group flex gap-3"
    >
      <Avatar className="mt-0.5 size-8 shrink-0">
        {avatar ? <AvatarImage src={avatar} alt="" /> : null}
        <AvatarFallback className="text-xs">
          {comment.author.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{comment.author.name}</span>
          {comment.mine ? (
            <span className="text-xs text-primary">you</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {formatDateTime(comment.createdAt)}
          </span>
        </div>

        <p className="mt-0.5 text-sm leading-6 whitespace-pre-line">
          {comment.body}
        </p>
      </div>

      {canDelete ? (
        <motion.div
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
          // Hidden until the row is approached, so a long thread is not a wall
          // of delete buttons. Focus reveals it too, for keyboard use.
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete this comment"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            <Trash2 className="size-4" />
          </Button>
        </motion.div>
      ) : null}
    </motion.li>
  );
};

/**
 * The conversation under an article, newest first.
 */
export const CommentList = ({
  postId,
  slug,
}: {
  postId: string;
  slug: string;
}) => {
  const { data, isLoading, isError, error, refetch } = useGetCommentsQuery({
    postId,
  });
  const { checkPolicy } = useAuthorization();
  const canModerate = checkPolicy("user:manage");

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the comments"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const comments = data?.comments ?? [];

  if (comments.length === 0) {
    return (
      <EmptyState
        icon={<MessageCircle className="size-8" />}
        title="No comments yet"
        description="Be the first to say something."
      />
    );
  }

  return (
    <motion.ul
      variants={listVariants}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      {/* popLayout so the remaining comments close the gap when one goes. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {comments.map((comment) => (
          <CommentRow
            key={comment._id}
            comment={comment}
            slug={slug}
            canModerate={canModerate}
          />
        ))}
      </AnimatePresence>
    </motion.ul>
  );
};
