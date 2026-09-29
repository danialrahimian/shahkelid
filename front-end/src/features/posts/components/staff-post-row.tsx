import { Heart, MessageCircle, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { paths } from "@/config/paths";
import { PostDetailsDialog } from "@/features/posts/components/post-details-dialog";
import { assetUrl } from "@/utils/asset-url";
import { formatCount, formatDate } from "@/utils/format";
import type { StaffPostSummary } from "@/types/api";

/**
 * One post in the dashboard list.
 *
 * Edit appears only on the viewer's own posts. The server refuses the rest
 * regardless, so this is about not offering a button that can only fail.
 */

const rowVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 220, damping: 26 },
  },
};

export const StaffPostRow = ({ post }: { post: StaffPostSummary }) => {
  const cover = assetUrl(post.coverImage);

  return (
    <motion.li
      variants={rowVariants}
      layout
      className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card p-3 sm:flex-nowrap"
    >
      <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-36">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 dir="auto" className="truncate font-medium">
            {post.title}
          </h3>
          {post.canEdit ? (
            <Badge variant="secondary" className="font-normal">
              Yours
            </Badge>
          ) : null}
        </div>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{post.author.name}</span>
          <span aria-hidden>·</span>
          <span>{formatDate(post.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1 tabular-nums">
            <Heart className="size-3" />
            {formatCount(post.likeCount)}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <MessageCircle className="size-3" />
            {formatCount(post.commentCount)}
          </span>
        </p>

        {post.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {post.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <PostDetailsDialog
          postId={post._id}
          title={post.title}
          canEdit={post.canEdit}
          slug={post.slug}
        />

        {post.canEdit ? (
          <Button asChild size="sm" className="gap-1.5">
            <Link to={paths.dashboardPost.getHref(post._id)}>
              <Pencil className="size-3.5" />
              Edit
            </Link>
          </Button>
        ) : null}
      </div>
    </motion.li>
  );
};
