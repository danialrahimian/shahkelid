import {
  COMMENT_STATUSES,
  POST_STATUSES,
  postInput,
  type CommentStatus,
  type PostInput,
  type PostStatus,
  type StaffPostView,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  coverSrc,
  useStaffCommentsQuery,
  useStaffDeleteCommentMutation,
  useStaffModerateCommentMutation,
  useStaffPostQuery,
  useStaffPostsQuery,
  useStaffSavePostMutation,
  useStaffSetCoverMutation,
} from "@/api/journal";
import { paths } from "@/config/paths";
import { normalizeError } from "@/lib/api-client";
import { codeText, errorText, isErrorCode } from "@/lib/error-text";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button, ConfirmButton, PageHeader, Placeholder, TableFrame } from "./staff-ui";

// ------------------------------------------------------------------ the list

const STATUS_TONE: Record<PostStatus, string> = {
  draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  published: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  archived: "bg-zinc-500/10 text-zinc-500",
};

const Pills = <T extends string>({
  values,
  value,
  onChange,
  label,
}: {
  values: readonly (T | "")[];
  value: T | "";
  onChange: (value: T | "") => void;
  label: (value: T | "") => string;
}) => (
  <div className="mb-4 flex flex-wrap gap-1.5">
    {values.map((candidate) => (
      <button
        key={candidate || "all"}
        type="button"
        aria-pressed={value === candidate}
        onClick={() => onChange(candidate)}
        className={cn(
          "h-8 rounded-full border px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          value === candidate ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
      >
        {label(candidate)}
      </button>
    ))}
  </div>
);

export const PostsPage = () => {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<PostStatus | "">("");
  const { data: posts, isLoading } = useStaffPostsQuery({ status: status || undefined });

  return (
    <>
      <PageHeader
        title={t("staff.posts.title")}
        description={t("staff.posts.description")}
        actions={
          <Link
            to={paths.staffPost.getHref("new")}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("staff.posts.new")}
          </Link>
        }
      />
      <Pills<PostStatus>
        values={["", ...POST_STATUSES]}
        value={status}
        onChange={setStatus}
        label={(value) => (value ? t(`staff.posts.statuses.${value}`) : t("staff.posts.all"))}
      />
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !posts?.length ? (
        <Placeholder>{t("staff.posts.empty")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.posts.titleField")}</th>
              <th>{t("staff.posts.status")}</th>
              <th>{t("staff.posts.author")}</th>
              <th>{t("staff.posts.published")}</th>
              <th>{t("staff.nav.comments")}</th>
              <th>{t("staff.posts.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id}>
                <td className="max-w-96">
                  <Link to={paths.staffPost.getHref(post.id)} className="font-medium underline-offset-4 hover:underline">
                    {post.title}
                  </Link>
                </td>
                <td>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[post.status])}>
                    {t(`staff.posts.statuses.${post.status}`)}
                  </span>
                </td>
                <td>{post.authorName}</td>
                <td>{formatDate(post.publishedAt)}</td>
                <td className="tabular-nums">{formatNumber(post.commentCount)}</td>
                <td className="text-muted-foreground">{formatDateTime(post.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </>
  );
};

// ---------------------------------------------------------------- the editor

type Draft = {
  title: string;
  excerpt: string;
  body: string;
  tags: string;
  status: PostStatus;
  seoTitle: string;
  seoDescription: string;
};

const draftOf = (post?: StaffPostView): Draft => ({
  title: post?.title ?? "",
  excerpt: post?.excerpt ?? "",
  body: post?.body ?? "",
  tags: post?.tags.join("، ") ?? "",
  status: post?.status ?? "draft",
  seoTitle: post?.seoTitle ?? "",
  seoDescription: post?.seoDescription ?? "",
});

const fieldClass =
  "block w-full rounded-md border bg-background px-3 py-2 text-sm leading-7 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

const Field = ({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">
      {label}
    </label>
    {children}
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    {error ? (
      <p role="alert" className="text-sm font-medium text-destructive">
        {error}
      </p>
    ) : null}
  </div>
);

const CoverField = ({ post }: { post: StaffPostView }) => {
  const { t } = useTranslation();
  const [setCover, { isLoading }] = useStaffSetCoverMutation();
  const cover = coverSrc(post.coverUrl);
  const fail = (error: unknown) => toast.error(errorText(error));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("staff.posts.cover")}</p>
      {cover ? <img src={cover} alt="" className="aspect-video w-full max-w-md rounded-lg border object-cover" /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t("staff.posts.cover")}
          disabled={isLoading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set("cover", file, file.name);
            setCover({ id: post.id, form }).unwrap().catch(fail);
            event.target.value = "";
          }}
          className="block text-sm file:me-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        />
        {cover ? (
          <Button tone="ghost" busy={isLoading} onClick={() => setCover({ id: post.id, form: null }).unwrap().catch(fail)}>
            {t("staff.posts.removeCover")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("staff.posts.coverHint")}</p>
    </div>
  );
};

const PostEditor = ({ post }: { post?: StaffPostView }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [save, { isLoading }] = useStaffSavePostMutation();
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(post));
  const [errors, setErrors] = React.useState<Partial<Record<keyof Draft, string>>>({});
  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [key]: event.target.value });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body: PostInput = {
      title: draft.title,
      excerpt: draft.excerpt,
      body: draft.body,
      tags: draft.tags
        .split(/[,،]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      status: draft.status,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
    };
    const checked = postInput.safeParse(body);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(
          checked.error.issues.map((issue) => [
            issue.path[0],
            isErrorCode(issue.message) ? codeText(issue.message) : issue.message,
          ]),
        ),
      );
      return;
    }
    setErrors({});
    save({ id: post?.id, body })
      .unwrap()
      .then((saved) => {
        toast.success(t("staff.posts.saved"));
        if (!post) void navigate(paths.staffPost.getHref(saved.id), { replace: true });
      })
      .catch((error: unknown) => {
        const fields = normalizeError(error).errors.filter((entry) => entry.path);
        if (fields.length) {
          setErrors(
            Object.fromEntries(fields.map((field) => [field.path, isErrorCode(field.msg) ? codeText(field.msg) : errorText(error)])),
          );
        } else toast.error(errorText(error));
      });
  };

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-5">
        <Field id="post-title" label={t("staff.posts.titleField")} error={errors.title}>
          <input id="post-title" value={draft.title} onChange={set("title")} maxLength={160} dir="auto" className={fieldClass} />
        </Field>
        <Field id="post-excerpt" label={t("staff.posts.excerpt")} hint={t("staff.posts.excerptHint")} error={errors.excerpt}>
          <textarea id="post-excerpt" value={draft.excerpt} onChange={set("excerpt")} rows={2} maxLength={300} dir="auto" className={fieldClass} />
        </Field>
        <Field id="post-body" label={t("staff.posts.body")} hint={t("staff.posts.bodyHint")} error={errors.body}>
          <textarea id="post-body" value={draft.body} onChange={set("body")} rows={18} dir="auto" className={fieldClass} />
        </Field>
      </div>
      <aside className="space-y-5">
        <Field id="post-status" label={t("staff.posts.status")}>
          <select id="post-status" value={draft.status} onChange={set("status")} className={cn(fieldClass, "h-10 py-0")}>
            {POST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`staff.posts.statuses.${status}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="post-tags" label={t("staff.posts.tags")} hint={t("staff.posts.tagsHint")} error={errors.tags}>
          <input id="post-tags" value={draft.tags} onChange={set("tags")} className={fieldClass} />
        </Field>
        <Field id="post-seo-title" label={t("staff.posts.seoTitle")} error={errors.seoTitle}>
          <input id="post-seo-title" value={draft.seoTitle} onChange={set("seoTitle")} maxLength={70} className={fieldClass} />
        </Field>
        <Field id="post-seo-description" label={t("staff.posts.seoDescription")} error={errors.seoDescription}>
          <textarea
            id="post-seo-description"
            value={draft.seoDescription}
            onChange={set("seoDescription")}
            rows={3}
            maxLength={160}
            className={fieldClass}
          />
        </Field>
        {post ? (
          <>
            <CoverField post={post} />
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{t("staff.posts.address")}</p>
              <p dir="auto" className="break-all">
                /posts/{post.slug}
              </p>
              {post.status === "published" ? (
                <Link to={paths.post.getHref(post.slug)} className="underline underline-offset-4">
                  {t("staff.posts.view")}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("staff.posts.coverAfterSave")}</p>
        )}
        <Button type="submit" tone="primary" busy={isLoading} className="w-full">
          {t("staff.common.save")}
        </Button>
      </aside>
    </form>
  );
};

/** /staff/posts/:postId, or /staff/posts/new for a new one. */
export const PostEditorPage = ({ postId }: { postId: string }) => {
  const { t } = useTranslation();
  const isNew = postId === "new";
  const { data: post, isLoading, isError } = useStaffPostQuery(postId, { skip: isNew });

  return (
    <div className="space-y-6">
      <Link to={paths.staffPosts.getHref()} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("staff.posts.back")}
      </Link>
      <PageHeader title={isNew ? t("staff.posts.new") : (post?.title ?? t("staff.posts.edit"))} />
      {isNew ? (
        <PostEditor />
      ) : isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : isError || !post ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : (
        <PostEditor key={post.id} post={post} />
      )}
    </div>
  );
};

// -------------------------------------------------------------- moderation

export const CommentsPage = () => {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<CommentStatus | "">("pending");
  const { data: comments, isLoading } = useStaffCommentsQuery(status || "pending");
  const [moderate, { isLoading: isModerating }] = useStaffModerateCommentMutation();
  const [remove] = useStaffDeleteCommentMutation();
  const fail = (error: unknown) => toast.error(errorText(error));

  return (
    <>
      <PageHeader title={t("staff.comments.title")} description={t("staff.comments.description")} />
      <Pills<CommentStatus>
        values={COMMENT_STATUSES}
        value={status}
        onChange={(value) => setStatus(value || "pending")}
        label={(value) => t(`staff.comments.statuses.${value || "pending"}`)}
      />
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !comments?.length ? (
        <Placeholder>{t("staff.comments.empty")}</Placeholder>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="space-y-2 rounded-lg border bg-card p-4">
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.authorName}</span>
                {comment.authorEmail ? <bdi dir="ltr">{comment.authorEmail}</bdi> : null}
                <span>{formatDateTime(comment.createdAt)}</span>
                <Link to={paths.post.getHref(comment.post.slug)} className="underline underline-offset-4">
                  {t("staff.comments.on", { title: comment.post.title })}
                </Link>
              </p>
              <p className="text-sm leading-7 whitespace-pre-line" dir="auto">
                {comment.body}
              </p>
              <div className="flex flex-wrap gap-2">
                {comment.status !== "approved" ? (
                  <Button
                    tone="primary"
                    busy={isModerating}
                    onClick={() => moderate({ id: comment.id, decision: "approve" }).unwrap().catch(fail)}
                  >
                    {t("staff.comments.approve")}
                  </Button>
                ) : null}
                {comment.status !== "rejected" ? (
                  <Button busy={isModerating} onClick={() => moderate({ id: comment.id, decision: "reject" }).unwrap().catch(fail)}>
                    {t("staff.comments.reject")}
                  </Button>
                ) : null}
                <ConfirmButton
                  tone="danger"
                  label={t("staff.comments.delete")}
                  question={t("staff.comments.deleteQuestion")}
                  onConfirm={() => remove(comment.id).unwrap().catch(fail)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
