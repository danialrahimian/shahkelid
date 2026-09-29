import {
  ChevronLeft,
  ChevronRight,
  FilePen,
  LayoutList,
  Newspaper,
  PenLine,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetStaffPostsQuery } from "@/api/posts";
import { paths } from "@/config/paths";
import { PostForm } from "@/features/posts/components/post-form";
import { StaffPostRow } from "@/features/posts/components/staff-post-row";
import { formatCount } from "@/utils/format";

/**
 * The journal, from the inside.
 *
 * Any member of staff may publish; each may edit only what they wrote. The
 * list shows everyone's posts regardless, because the useful question before
 * writing is what has already been said.
 *
 * The URL decides the mode, the same way the products screen does:
 * `/dashboard/posts` lists and writes, `/dashboard/posts/:postId` edits. An
 * edit screen is then linkable and survives a reload.
 */

type ActiveTab = "posts" | "form";
type Scope = "all" | "mine";

const PAGE_SIZE = 10;

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const PostsRoute = () => {
  const { postId } = useParams<{ postId?: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = React.useState<ActiveTab>(
    postId ? "form" : "posts",
  );
  const [scope, setScope] = React.useState<Scope>("all");
  const [page, setPage] = React.useState(1);
  const [term, setTerm] = React.useState("");
  const [search, setSearch] = React.useState("");

  // Following an edit link should also switch to the form.
  React.useEffect(() => {
    if (postId) setActiveTab("form");
  }, [postId]);

  // Debounced, so a title typed at speed is one request rather than twenty.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useGetStaffPostsQuery({
      page,
      limit: PAGE_SIZE,
      search: search || undefined,
      mine: scope === "mine",
    });

  const posts = data?.posts ?? [];
  const total = data?.totalPostsLength ?? 0;
  const pages = Math.max(Math.ceil(total / (data?.limit ?? PAGE_SIZE)), 1);

  const goToList = () => {
    navigate(paths.dashboardPosts.getHref());
    setActiveTab("posts");
  };

  const countLabel = isLoading
    ? "Loading the journal"
    : `${formatCount(total)} ${total === 1 ? "post" : "posts"}${scope === "mine" ? " by you" : ""}`;

  let list: React.ReactNode;
  if (isError) {
    list = (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the posts"
      />
    );
  } else if (isLoading) {
    list = (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  } else if (posts.length === 0) {
    list = (
      <EmptyState
        icon={<Newspaper className="size-8" />}
        title={
          search
            ? "No post matches that search"
            : scope === "mine"
              ? "You have not written anything yet"
              : "The journal is empty"
        }
        action={
          search ? undefined : (
            <Button className="gap-2" onClick={() => setActiveTab("form")}>
              <PenLine className="size-4" />
              Write the first one
            </Button>
          )
        }
      />
    );
  } else {
    list = (
      <>
        <motion.ul
          key={`${scope}-${search}-${page}`}
          variants={listVariants}
          initial="hidden"
          animate="show"
          className={
            "space-y-3 transition-opacity " +
            (isFetching ? "opacity-60" : "opacity-100")
          }
        >
          {posts.map((post) => (
            <StaffPostRow key={post._id} post={post} />
          ))}
        </motion.ul>

        {pages > 1 ? (
          <nav
            aria-label="Post pages"
            className="mt-6 flex items-center justify-center gap-3"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              Page {page} of {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={page >= pages}
              onClick={() => setPage((current) => Math.min(current + 1, pages))}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        ) : null}
      </>
    );
  }

  return (
    <div className="pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex items-center gap-3"
      >
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
          <FilePen className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
          <AnimatePresence mode="wait">
            <motion.p
              key={countLabel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              {countLabel}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = value as ActiveTab;
          setActiveTab(next);
          // Leaving the form drops the post being edited from the URL.
          if (next === "posts" && postId) {
            navigate(paths.dashboardPosts.getHref());
          }
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="posts" className="gap-1.5">
            <LayoutList className="size-4" />
            All posts
          </TabsTrigger>
          <TabsTrigger value="form" className="gap-1.5">
            <PenLine className="size-4" />
            {postId ? "Edit post" : "Write a post"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search by title, summary or address"
                aria-label="Search posts"
                className="pl-9"
              />
            </div>

            <div
              role="group"
              aria-label="Whose posts"
              className="flex items-center rounded-lg border border-border p-0.5"
            >
              {(
                [
                  ["all", "Everyone's"],
                  ["mine", "Mine"],
                ] as const
              ).map(([option, label]) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={scope === option ? "secondary" : "ghost"}
                  aria-pressed={scope === option}
                  className="h-7 px-3 text-xs"
                  onClick={() => {
                    setScope(option);
                    setPage(1);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {list}
        </TabsContent>

        <TabsContent value="form">
          {/* Keyed so switching between writing and editing starts clean. */}
          <PostForm
            key={postId ?? "new"}
            postId={postId}
            onSaved={goToList}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PostsRoute;
