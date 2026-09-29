import { ArrowLeft, Clock, MessageCircle } from "lucide-react";
import { motion, useScroll, useSpring } from "motion/react";
import * as React from "react";
import { Link, useParams } from "react-router";

import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";
import { useGetPostQuery } from "@/api/posts";
import { CommentForm } from "@/features/posts/components/comment-form";
import { CommentList } from "@/features/posts/components/comment-list";
import { LikeButton } from "@/features/posts/components/like-button";
import { ShareButton } from "@/features/posts/components/share-button";
import { normalizeError } from "@/lib/api-client";
import { assetUrl } from "@/utils/asset-url";
import { formatDate } from "@/utils/format";

const ArticleSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-8 w-3/4" />
    <div className="flex items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
    <Skeleton className="aspect-video w-full rounded-xl" />
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  </div>
);

/**
 * The article body.
 *
 * The content is stored as plain text with blank lines between paragraphs, so
 * it is split and rendered as real elements. Nothing is interpreted as markup:
 * rendering stored HTML would be an injection route the moment anyone other
 * than the seed script can write a post.
 */
const ArticleBody = ({ content }: { content: string }) => {
  const paragraphs = React.useMemo(
    () =>
      content
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
    [content],
  );

  return (
    <div className="space-y-5">
      {paragraphs.map((paragraph, index) => (
        <motion.p
          key={paragraph.slice(0, 40)}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{
            duration: 0.45,
            delay: Math.min(index * 0.04, 0.3),
            ease: [0.22, 1, 0.36, 1],
          }}
          className="text-[1.0625rem] leading-8 text-foreground/90"
        >
          {paragraph}
        </motion.p>
      ))}
    </div>
  );
};

/**
 * One article, opened from the feed.
 *
 * The cover, the words, then the conversation. The comment section sits behind
 * its own boundary, so a failure there leaves the article readable.
 */
const PostRoute = () => {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: post, isLoading, isError, error, refetch } = useGetPostQuery(
    slug,
    { skip: !slug },
  );

  // A reading-progress bar, which is the one piece of chrome a long article
  // genuinely benefits from.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  if (isError) {
    const { status } = normalizeError(error);

    return (
      <div className="mx-auto w-full max-w-2xl pb-14">
        <ErrorState
          error={error}
          onRetry={status === 404 ? undefined : () => void refetch()}
          title={
            status === 404
              ? "That article does not exist"
              : "We could not load the article"
          }
        />
        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline" className="gap-2">
            <Link to={paths.posts.getHref()}>
              <ArrowLeft className="size-4" />
              Back to the journal
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !post) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-14">
        <ArticleSkeleton />
      </div>
    );
  }

  const cover = assetUrl(post.coverImage);
  const authorAvatar = assetUrl(post.author.avatar);

  return (
    <div className="mx-auto w-full max-w-2xl pb-14">
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary"
      />

      <Button asChild variant="ghost" size="sm" className="mb-6 gap-2">
        <Link to={paths.posts.getHref()}>
          <ArrowLeft className="size-4" />
          Journal
        </Link>
      </Button>

      <motion.article
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Link key={tag} to={`${paths.posts.getHref()}?tag=${tag}`}>
                <Badge
                  variant="secondary"
                  className="transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  #{tag}
                </Badge>
              </Link>
            ))}
          </div>

          <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            {post.title}
          </h1>

          <p className="text-lg leading-8 text-muted-foreground">
            {post.excerpt}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="size-10 ring-2 ring-primary/30">
              {authorAvatar ? <AvatarImage src={authorAvatar} alt="" /> : null}
              <AvatarFallback className="text-xs">
                {post.author.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div>
              <p className="text-sm font-semibold">{post.author.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {formatDate(post.createdAt)}
                <span aria-hidden>·</span>
                <Clock className="size-3" />
                {post.readingMinutes} min read
              </p>
            </div>
          </div>
        </header>

        <motion.img
          src={cover ?? ""}
          alt=""
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="my-8 aspect-video w-full rounded-xl border border-border object-cover"
        />

        <ArticleBody content={post.content} />
      </motion.article>

      <Separator className="my-8" />

      {/* The same actions as the card, so the two never disagree. */}
      <div className="flex items-center gap-5">
        <LikeButton
          postId={post._id}
          slug={post.slug}
          likeCount={post.likeCount}
          likedByMe={post.likedByMe}
          size="large"
        />

        <span className="flex items-center gap-1.5 text-muted-foreground">
          <MessageCircle className="size-6" />
          <span className="font-medium tabular-nums">{post.commentCount}</span>
        </span>

        <div className="ml-auto flex">
          <ShareButton
            slug={post.slug}
            title={post.title}
            excerpt={post.excerpt}
            size="large"
          />
        </div>
      </div>

      <section id="comments" className="mt-10 scroll-mt-24 space-y-6">
        <h2 className="text-lg font-semibold">
          {post.commentCount === 1
            ? "1 comment"
            : `${post.commentCount} comments`}
        </h2>

        <AppErrorBoundary resetKeys={[post._id]}>
          <CommentForm postId={post._id} slug={post.slug} />
          <div className="pt-2">
            <CommentList postId={post._id} slug={post.slug} />
          </div>
        </AppErrorBoundary>
      </section>
    </div>
  );
};

export default PostRoute;
