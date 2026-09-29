import { Clock, MessageCircle } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { paths } from "@/config/paths";
import { LikeButton } from "@/features/posts/components/like-button";
import { ShareButton } from "@/features/posts/components/share-button";
import type { PostSummary } from "@/types/api";
import { assetUrl } from "@/utils/asset-url";
import { formatDate } from "@/utils/format";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 220, damping: 24, mass: 0.9 },
  },
};

/**
 * One article, laid out the way a social post is: author, then the image, then
 * the actions, then the words.
 *
 * That order is deliberate. The picture is what draws the eye, the buttons sit
 * where the thumb already is, and the text comes last because it is what you
 * read only if the first three interested you.
 *
 * The card is not itself a link. It contains a like button and an author, so
 * wrapping the whole thing in an anchor would put interactive controls inside
 * a link, which breaks keyboard use and right-click alike. The image and the
 * title are the links instead.
 */
export const PostCard = ({
  post,
  index = 0,
}: {
  post: PostSummary;
  index?: number;
}) => {
  const cover = assetUrl(post.coverImage);
  const href = paths.post.getHref(post.slug);
  const authorAvatar = assetUrl(post.author.avatar);
  const initials = post.author.name.slice(0, 2).toUpperCase();

  return (
    <motion.article
      layout
      variants={cardVariants}
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <Avatar className="size-9 ring-2 ring-primary/30">
          {authorAvatar ? <AvatarImage src={authorAvatar} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{post.author.name}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {formatDate(post.createdAt)}
            <span aria-hidden>·</span>
            <Clock className="size-3" />
            {post.readingMinutes} min
          </p>
        </div>
      </header>

      <Link
        to={href}
        aria-label={`Read ${post.title}`}
        className="relative block aspect-square overflow-hidden bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <img
          src={cover ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />

        {/* The title sits on the image, revealed as the card is approached. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        <motion.span
          aria-hidden
          initial={false}
          className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 p-4 text-sm font-medium text-white opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
        >
          Read the article
        </motion.span>
      </Link>

      <div className="flex items-center gap-4 px-4 pt-3">
        <LikeButton
          postId={post._id}
          slug={post.slug}
          likeCount={post.likeCount}
          likedByMe={post.likedByMe}
        />

        <Link
          to={`${href}#comments`}
          className="flex items-center gap-1.5 text-sm transition-colors hover:text-primary"
          aria-label={`${post.commentCount} comments`}
        >
          <MessageCircle className="size-5" />
          <span className="font-medium tabular-nums">{post.commentCount}</span>
        </Link>

        <div className="ml-auto flex">
          <ShareButton
            slug={post.slug}
            title={post.title}
            excerpt={post.excerpt}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-4 pt-2 pb-4">
        <h2 className="leading-snug font-semibold">
          <Link
            to={href}
            className="transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {post.title}
          </Link>
        </h2>

        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {post.excerpt}
        </p>

        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {post.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              #{tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* A quiet rule that draws itself in, staggered across the grid. */}
      <motion.span
        aria-hidden
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{
          duration: 0.6,
          delay: 0.1 + index * 0.05,
          ease: "easeOut",
        }}
        className="absolute inset-x-0 top-0 h-0.5 origin-left bg-primary/40"
      />
    </motion.article>
  );
};
