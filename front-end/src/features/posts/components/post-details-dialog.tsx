import {
  CalendarClock,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Heart,
  Info,
  MessageCircle,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetStaffPostQuery } from "@/api/posts";
import { paths } from "@/config/paths";
import { assetUrl } from "@/utils/asset-url";
import { copyText } from "@/utils/clipboard";
import { formatCount, formatDateTime } from "@/utils/format";
import { postUrl } from "@/utils/share-links";
import type { StaffPost } from "@/types/api";

/**
 * Everything about one post, in a dialog.
 *
 * The full post is fetched only once the dialog opens. The list it is opened
 * from carries no article bodies, and loading every body up front to show one
 * of them would be most of the page's weight spent on text nobody asked for.
 */

/** One figure in the row across the top. */
const Stat = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) => (
  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </p>
    <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
  </div>
);

/** One labelled line in the facts list. */
const Fact = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
    <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
    <dd className="min-w-0 text-sm">{children}</dd>
  </div>
);

/**
 * The public address, with a copy button.
 *
 * Shown in full because it is the thing people ask for most: "what is the
 * link to that article?"
 */
const AddressFact = ({ slug }: { slug: string }) => {
  const [copied, setCopied] = React.useState(false);
  const url = postUrl(slug);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
        {url}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label="Copy the link"
        onClick={async () => {
          if (await copyText(url)) {
            setCopied(true);
            toast.success("Link copied");
          } else {
            toast.error("Could not copy automatically", { description: url });
          }
        }}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
};

/**
 * Whether a post has been edited since it went out.
 *
 * Mongo stamps `updatedAt` on every save, including the one that created the
 * post, so the two are compared with a little slack rather than for equality.
 */
const wasEdited = (post: StaffPost) =>
  new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() >
  60_000;

const DetailsBody = ({ post }: { post: StaffPost }) => {
  const cover = assetUrl(post.coverImage);
  const authorAvatar = assetUrl(post.author.avatar);

  return (
    <div className="space-y-6">
      {cover ? (
        <img
          src={cover}
          alt=""
          className="aspect-video w-full rounded-lg border border-border object-cover"
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Heart} label="Likes" value={formatCount(post.likeCount)} />
        <Stat
          icon={MessageCircle}
          label="Comments"
          value={formatCount(post.commentCount)}
        />
        <Stat
          icon={Clock}
          label="Reading time"
          value={`${post.readingMinutes} min`}
        />
        <Stat
          icon={FileText}
          label="Words"
          value={formatCount(post.wordCount)}
        />
      </div>

      <dl className="space-y-3">
        <Fact label="Author">
          <span className="flex items-center gap-2">
            <Avatar className="size-6">
              {authorAvatar ? <AvatarImage src={authorAvatar} alt="" /> : null}
              <AvatarFallback className="text-[10px]">
                {post.author.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{post.author.name}</span>
            {post.canEdit ? (
              <Badge variant="secondary" className="font-normal">
                You
              </Badge>
            ) : null}
          </span>
        </Fact>

        <Fact label="Published">{formatDateTime(post.createdAt)}</Fact>

        <Fact label="Last edited">
          {wasEdited(post) ? (
            formatDateTime(post.updatedAt)
          ) : (
            <span className="text-muted-foreground">Never edited</span>
          )}
        </Fact>

        <Fact label="Address">
          <AddressFact slug={post.slug} />
        </Fact>

        <Fact label="Tags">
          {post.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {post.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                  #{tag}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">No tags</span>
          )}
        </Fact>

        <Fact label="Post ID">
          <code className="text-xs text-muted-foreground">{post._id}</code>
        </Fact>
      </dl>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Summary
        </h3>
        <p className="text-sm leading-6">{post.excerpt}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Article
        </h3>
        {/* Paragraphs are separated by blank lines in the stored text, which
            is how the public page renders them too. */}
        <div
          dir="auto"
          className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm leading-7 whitespace-pre-line"
        >
          {post.content}
        </div>
      </section>
    </div>
  );
};

const DetailsSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="aspect-video w-full rounded-lg" />
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-14 rounded-lg" />
      ))}
    </div>
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} className="h-5 w-full" />
      ))}
    </div>
  </div>
);

export const PostDetailsDialog = ({
  postId,
  title,
  canEdit,
  slug,
}: {
  postId: string;
  /** Shown in the header straight away, before the full post has loaded. */
  title: string;
  canEdit: boolean;
  slug: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const { data, isFetching, isError, error, refetch } = useGetStaffPostQuery(
    postId,
    { skip: !open },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Info className="size-3.5" />
          Details
        </Button>
      </DialogTrigger>

      {/* Header and footer stay put while the body scrolls, so the actions
          are reachable without scrolling past a long article. */}
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/60 p-6 pb-4 pr-12">
          <DialogTitle dir="auto" className="leading-snug">
            {data?.title ?? title}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            {data
              ? `Published ${formatDateTime(data.createdAt)}`
              : "Loading the full post…"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {isError ? (
            <ErrorState
              error={error}
              onRetry={() => void refetch()}
              title="We could not load this post"
            />
          ) : isFetching && !data ? (
            <DetailsSkeleton />
          ) : data ? (
            <DetailsBody post={data} />
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/60 p-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </DialogClose>

          <Button asChild variant="outline" className="gap-1.5">
            <a
              href={paths.post.getHref(slug)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              Open in journal
            </a>
          </Button>

          {canEdit ? (
            <Button asChild className="gap-1.5">
              <Link
                to={paths.dashboardPost.getHref(postId)}
                onClick={() => setOpen(false)}
              >
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
