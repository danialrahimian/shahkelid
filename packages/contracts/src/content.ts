import { z } from "zod";

/**
 * The journal: posts written by staff, read by everyone, liked and commented
 * on by signed-in customers. A comment appears once staff approve it.
 *
 * A post's address (its slug) is made from its title and fixed once the post
 * has been published, because links to it are out in the world by then.
 */

export const POST_STATUSES = ["draft", "published", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const COMMENT_STATUSES = ["pending", "approved", "rejected"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const POST_MAX_TAGS = 8;
export const POST_COVER_MAX_BYTES = 5 * 1024 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "TOO_LONG")
    .optional()
    .transform((value) => value || null);

/** A tag is a filter in a URL: lower case, hyphens for spaces, so "VPN" and "vpn" are one tag. */
const tag = z
  .string()
  .trim()
  .min(1, "REQUIRED")
  .max(30, "TOO_LONG")
  .transform((value) => value.toLowerCase().replace(/\s+/g, "-"));

export const postInput = z.object({
  title: z.string().trim().min(3, "TOO_SHORT").max(160, "TOO_LONG"),
  excerpt: z.string().trim().min(10, "TOO_SHORT").max(300, "TOO_LONG"),
  /** Plain text; a blank line starts a new paragraph. */
  body: z.string().trim().min(50, "TOO_SHORT").max(50_000, "TOO_LONG"),
  tags: z
    .array(tag)
    .max(POST_MAX_TAGS, "TOO_LONG")
    .default([])
    .transform((tags) => [...new Set(tags)]),
  status: z.enum(POST_STATUSES).default("draft"),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
});
export type PostInput = z.input<typeof postInput>;

export const commentInput = z.object({
  body: z.string().trim().min(1, "REQUIRED").max(1000, "TOO_LONG"),
});
export type CommentInput = z.input<typeof commentInput>;

export const moderateCommentInput = z.object({
  decision: z.enum(["approve", "reject"]),
});
export type ModerateCommentInput = z.input<typeof moderateCommentInput>;

/** A post in the feed: everything but the body. */
export type PostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  /** A path on the API, or null when the post has no cover. */
  coverUrl: string | null;
  authorName: string;
  publishedAt: string;
  readingMinutes: number;
  likeCount: number;
  commentCount: number;
};

export type PostView = PostSummary & {
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  likedByMe: boolean;
};

export type PostPage = { posts: PostSummary[]; total: number; page: number; pageSize: number };

export type CommentView = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** The viewer wrote it. Their own pending comment is shown to them, marked as waiting. */
  mine: boolean;
  status: CommentStatus;
};

export type StaffPostSummary = {
  id: string;
  slug: string;
  title: string;
  status: PostStatus;
  authorName: string;
  publishedAt: string | null;
  updatedAt: string;
  commentCount: number;
  likeCount: number;
};

export type StaffPostView = StaffPostSummary & {
  excerpt: string;
  body: string;
  tags: string[];
  coverUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type StaffCommentView = {
  id: string;
  post: { id: string; slug: string; title: string };
  authorName: string;
  authorEmail: string | null;
  body: string;
  status: CommentStatus;
  createdAt: string;
};
