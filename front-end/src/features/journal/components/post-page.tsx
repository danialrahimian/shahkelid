import type { CommentView, PostView } from "@shah-kelid/contracts";
import { Heart, Link2, Send } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

import { useAccountSessionQuery } from "@/api/account";
import {
  coverSrc,
  useJournalAddCommentMutation,
  useJournalCommentsQuery,
  useJournalDeleteCommentMutation,
  useJournalLikeMutation,
  useJournalPostQuery,
} from "@/api/journal";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { postUrl, shareHref } from "@/utils/share-links";

/**
 * One post: the article, a like, sharing, and the comments.
 *
 * The body is plain text, split into paragraphs at blank lines and rendered
 * as text: nothing in it is ever read as markup.
 */

const Paragraphs = ({ body }: { body: string }) => (
  <div className="space-y-5">
    {body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph, index) => (
        <p key={index} className="text-[1.0625rem] leading-9 whitespace-pre-line text-foreground/90" dir="auto">
          {paragraph}
        </p>
      ))}
  </div>
);

const LikeButton = ({ post, signedIn }: { post: PostView; signedIn: boolean }) => {
  const { t } = useTranslation();
  const [like, { isLoading }] = useJournalLikeMutation();
  return (
    <button
      type="button"
      aria-pressed={post.likedByMe}
      disabled={isLoading}
      onClick={() => {
        if (!signedIn) {
          toast.info(t("journal.signInToLike"));
          return;
        }
        like({ postId: post.id, slug: post.slug })
          .unwrap()
          .catch((error: unknown) => toast.error(errorText(error)));
      }}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        post.likedByMe ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "hover:bg-accent",
      )}
    >
      <Heart className={cn("size-4", post.likedByMe && "fill-current")} aria-hidden />
      {t("journal.likes", { amount: formatNumber(post.likeCount) })}
    </button>
  );
};

const Share = ({ post }: { post: PostView }) => {
  const { t } = useTranslation();
  const url = postUrl(post.slug);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("journal.share")}>
      <a
        href={shareHref("telegram", { url, title: post.title })}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-full border px-4 hover:bg-accent"
      >
        <Send className="size-4" aria-hidden />
        Telegram
      </a>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success(t("journal.copied")))}
        className="inline-flex h-9 items-center gap-2 rounded-full border px-4 hover:bg-accent"
      >
        <Link2 className="size-4" aria-hidden />
        {t("journal.copyLink")}
      </button>
    </div>
  );
};

const CommentItem = ({ comment, postId }: { comment: CommentView; postId: string }) => {
  const { t } = useTranslation();
  const [remove, { isLoading }] = useJournalDeleteCommentMutation();
  return (
    <li className={cn("space-y-2 rounded-lg border p-4", comment.status === "pending" && "border-dashed bg-muted/30")}>
      <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground" dir="auto">
          {comment.authorName}
        </span>
        <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
        {comment.status === "pending" ? (
          <span className="font-medium text-amber-700 dark:text-amber-300">{t("journal.pending")}</span>
        ) : null}
      </p>
      <p className="text-sm leading-7 whitespace-pre-line" dir="auto">
        {comment.body}
      </p>
      {comment.mine ? (
        <button
          type="button"
          disabled={isLoading}
          onClick={() =>
            remove({ postId, commentId: comment.id })
              .unwrap()
              .catch((error: unknown) => toast.error(errorText(error)))
          }
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("journal.deleteComment")}
        </button>
      ) : null}
    </li>
  );
};

const Comments = ({ postId, signedIn }: { postId: string; signedIn: boolean }) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: comments = [], isLoading } = useJournalCommentsQuery(postId);
  const [add, { isLoading: isSending }] = useJournalAddCommentMutation();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string>();

  return (
    <section className="space-y-5" aria-labelledby="comments-title">
      <h2 id="comments-title" className="text-xl font-semibold">
        {t("journal.commentsTitle")}
      </h2>

      {signedIn ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim()) {
              setError(t("errors.codes.REQUIRED"));
              return;
            }
            add({ postId, body })
              .unwrap()
              .then(() => {
                setBody("");
                setError(undefined);
                toast.success(t("journal.sent"));
              })
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          <label htmlFor="comment-body" className="text-sm font-medium">
            {t("journal.commentLabel")}
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            maxLength={1000}
            dir="auto"
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm leading-7 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSending}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSending ? t("common.loading") : t("journal.send")}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link to={paths.accountSignIn.getHref(pathname)} className="underline underline-offset-4">
            {t("journal.signInToComment")}
          </Link>
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !comments.length ? (
        <p className="text-sm text-muted-foreground">{t("journal.noComments")}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} postId={postId} />
          ))}
        </ul>
      )}
    </section>
  );
};

export const PostPage = ({ slug }: { slug: string }) => {
  const { t } = useTranslation();
  const { data: post, isLoading, isError } = useJournalPostQuery(slug);
  const { data: session } = useAccountSessionQuery();
  const signedIn = session?.status === "signed_in";

  React.useEffect(() => {
    if (post) document.title = `${post.seoTitle ?? post.title} · ${t("app.name")}`;
  }, [post, t]);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError || !post) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-muted-foreground">{t("journal.notFound")}</p>
        <Link to={paths.posts.getHref()} className="text-sm underline underline-offset-4">
          {t("journal.back")}
        </Link>
      </div>
    );
  }
  const cover = coverSrc(post.coverUrl);

  return (
    <article className="mx-auto max-w-2xl space-y-8 pb-16">
      <Link to={paths.posts.getHref()} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("journal.back")}
      </Link>
      <header className="space-y-4">
        <h1 className="text-3xl leading-[1.5] font-bold text-balance">{post.title}</h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{post.authorName}</span>
          <span>{formatDate(post.publishedAt)}</span>
          <span>{t("journal.minutes", { amount: formatNumber(post.readingMinutes) })}</span>
        </p>
        {post.tags.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <li key={tag}>
                <Link
                  to={`${paths.posts.getHref()}?tag=${encodeURIComponent(tag)}`}
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
                >
                  #{tag}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {cover ? <img src={cover} alt="" className="aspect-video w-full rounded-xl object-cover" /> : null}
      <Paragraphs body={post.body} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-4">
        <LikeButton post={post} signedIn={signedIn} />
        <Share post={post} />
      </div>
      <Comments postId={post.id} signedIn={signedIn} />
    </article>
  );
};
