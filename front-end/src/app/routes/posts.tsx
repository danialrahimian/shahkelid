import { Newspaper, Search, X } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPostsQuery, useGetPostTagsQuery } from "@/api/posts";
import { PostCard } from "@/features/posts/components/post-card";
import { cn } from "@/lib/utils";

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

/** Mirrors the card's proportions, so nothing shifts when the data lands. */
const PostCardSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
    <Skeleton className="aspect-square w-full rounded-none" />
    <div className="space-y-3 p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  </div>
);

/** The tag filters, as a row of pills. */
const TagFilter = ({
  tags,
  active,
  onChange,
}: {
  tags: string[];
  active: string;
  onChange: (tag: string) => void;
}) => (
  <div className="mb-6 flex flex-wrap gap-2">
    {["", ...tags].map((tag) => {
      const isActive = active === tag;

      return (
        <motion.button
          key={tag || "all"}
          type="button"
          onClick={() => onChange(tag)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          aria-pressed={isActive}
          className="relative"
        >
          {/* One pill that slides between tags rather than fading in place. */}
          {isActive ? (
            <motion.span
              layoutId="post-tag-pill"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="absolute inset-0 rounded-full bg-primary"
            />
          ) : null}

          <Badge
            variant="outline"
            className={cn(
              "relative border-border bg-transparent px-3 py-1 transition-colors",
              isActive
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tag ? `#${tag}` : "All"}
          </Badge>
        </motion.button>
      );
    })}
  </div>
);

/**
 * The article feed.
 *
 * Laid out as a grid of social-style cards rather than a list of headlines:
 * the covers carry the page, and the tags and search sit above them. Filters
 * live in the URL so a filtered feed can be shared and reloaded.
 */
const PostsRoute = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const tag = searchParams.get("tag") ?? "";
  const search = searchParams.get("search") ?? "";
  const [searchInput, setSearchInput] = React.useState(search);

  // When the URL's search changes from outside the box (back button, a
  // cleared filter), the box follows. Adjusted during render, which React
  // recommends over an effect: the effect drew the stale text first.
  const [syncedSearch, setSyncedSearch] = React.useState(search);
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchInput(search);
  }

  const { data: tags } = useGetPostTagsQuery();
  const { data, isLoading, isFetching, isError, error, refetch } =
    useGetPostsQuery({
      tag: tag || undefined,
      search: search || undefined,
      limit: 12,
    });

  const posts = data?.posts ?? [];
  const hasFilters = Boolean(tag || search);

  const apply = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params);
  };

  let content: ReactNode;
  if (isError) {
    content = (
      <motion.div key="error" exit={{ opacity: 0 }}>
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load the articles"
        />
      </motion.div>
    );
  } else if (isLoading) {
    content = (
      <motion.div
        key="loading"
        exit={{ opacity: 0 }}
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <PostCardSkeleton key={index} />
        ))}
      </motion.div>
    );
  } else if (posts.length === 0) {
    content = (
      <motion.div key="empty" exit={{ opacity: 0 }}>
        <EmptyState
          icon={<Newspaper className="size-8" />}
          title={
            hasFilters ? "Nothing matches those filters" : "No articles yet"
          }
          description={
            hasFilters ? "Try another tag, or clear the search." : undefined
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                className="gap-1"
                onClick={() => setSearchParams({})}
              >
                <X className="size-4" />
                Clear filters
              </Button>
            ) : undefined
          }
        />
      </motion.div>
    );
  } else {
    content = (
      <motion.div
        key={`grid-${searchParams.toString()}`}
        variants={gridVariants}
        initial="hidden"
        animate="show"
        exit={{ opacity: 0, y: -10 }}
        // Dims while a new page arrives rather than emptying out.
        className="grid grid-cols-1 gap-6 transition-opacity duration-300 sm:grid-cols-2 lg:grid-cols-3"
        style={{ opacity: isFetching ? 0.6 : 1 }}
      >
        {posts.map((post, index) => (
          <PostCard key={post._id} post={post} index={index} />
        ))}
      </motion.div>
    );
  }

  return (
    <div className="pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 18,
              delay: 0.1,
            }}
            className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Newspaper className="size-5" />
          </motion.div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? "Loading articles…"
                : `${data?.totalPostsLength ?? 0} articles on privacy, speed and trust`}
            </p>
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search: searchInput });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search articles…"
            aria-label="Search articles"
            className="w-full pl-9 transition-all duration-300 focus-visible:w-72 sm:w-56"
          />
        </motion.form>
      </motion.header>

      <TagFilter
        tags={tags ?? []}
        active={tag}
        onChange={(next) => apply({ tag: next === tag ? "" : next })}
      />

      <AnimatePresence mode="wait">{content}</AnimatePresence>
    </div>
  );
};

export default PostsRoute;
