import type { PostSummary } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { coverSrc, useJournalPostsQuery, useJournalTagsQuery } from "@/api/journal";
import { Input } from "@/components/ui/input";
import { paths } from "@/config/paths";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The journal's front page: published posts, newest first, filtered by tag
 * or a search. The filters live in the address, so a filtered page can be
 * shared and the back button undoes a filter.
 */

const PostCard = ({ post }: { post: PostSummary }) => {
  const { t } = useTranslation();
  const cover = coverSrc(post.coverUrl);
  return (
    <li>
      <Link
        to={paths.post.getHref(post.slug)}
        className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="aspect-video w-full object-cover" />
        ) : (
          <div aria-hidden className="aspect-video w-full bg-muted/50" />
        )}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <h2 className="text-lg leading-8 font-semibold text-balance group-hover:underline group-hover:underline-offset-4">
            {post.title}
          </h2>
          <p className="line-clamp-3 flex-1 text-sm leading-7 text-muted-foreground">{post.excerpt}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatDate(post.publishedAt)}</span>
            <span>{t("journal.minutes", { amount: formatNumber(post.readingMinutes) })}</span>
            <span>{t("journal.likes", { amount: formatNumber(post.likeCount) })}</span>
            <span>{t("journal.comments", { amount: formatNumber(post.commentCount) })}</span>
          </p>
        </div>
      </Link>
    </li>
  );
};

export const JournalFeed = () => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const tag = params.get("tag") ?? undefined;
  const search = params.get("q") ?? undefined;
  const [draft, setDraft] = React.useState(search ?? "");

  const { data, isLoading, isError } = useJournalPostsQuery({ page, tag, search });
  const { data: tags = [] } = useJournalTagsQuery();

  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-8 pb-16">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold">{t("journal.title")}</h1>
        <p className="leading-7 text-muted-foreground">{t("journal.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form
          role="search"
          className="w-full max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            set({ q: draft.trim() || undefined, page: undefined });
          }}
        >
          <label htmlFor="journal-search" className="sr-only">
            {t("journal.search")}
          </label>
          <Input
            id="journal-search"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("journal.search")}
            className="h-10"
          />
        </form>
        {tags.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label={t("staff.posts.tags")}>
            {[undefined, ...tags].map((candidate) => (
              <button
                key={candidate ?? "all"}
                type="button"
                aria-pressed={tag === candidate}
                onClick={() => set({ tag: candidate, page: undefined })}
                className={cn(
                  "h-8 rounded-full border px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  tag === candidate ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {candidate ? `#${candidate}` : t("journal.allTags")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">{t("errors.generic")}</p>
      ) : !data.posts.length ? (
        <p className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {tag || search ? t("journal.noResults") : t("journal.empty")}
        </p>
      ) : (
        <>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="flex items-center justify-center gap-4 text-sm" aria-label={t("journal.title")}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => set({ page: String(page - 1) })}
                className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-40"
              >
                {t("journal.previous")}
              </button>
              <span className="text-muted-foreground">
                {t("journal.page", { page: formatNumber(page), pages: formatNumber(pages) })}
              </span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => set({ page: String(page + 1) })}
                className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-40"
              >
                {t("journal.next")}
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
};
