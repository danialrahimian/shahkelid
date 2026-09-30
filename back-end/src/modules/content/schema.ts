import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { files } from "../files/schema";
import { users } from "../identity/schema";
import { at, createdAt, id, updatedAt } from "../../platform/db/columns";

export const contentStatus = pgEnum("content_status", ["draft", "published", "archived"]);

/**
 * Persian is the default language. Each piece of content is one row per
 * language, linked by translation_group_id, so English can be added later
 * without changing the schema.
 */
export const posts = pgTable(
  "posts",
  {
    id: id(),
    translationGroupId: uuid("translation_group_id").notNull().default(sql`uuidv7()`),
    locale: text("locale").notNull().default("fa"),
    slug: text("slug").notNull(), // fixed once published: links are out there
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull(),
    body: text("body").notNull(), // markdown, sanitized when rendered
    tags: text("tags").array().notNull().default(sql`'{}'`),
    coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    status: contentStatus("status").notNull().default("draft"),
    publishedAt: at("published_at"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("posts_locale_slug_key").on(t.locale, t.slug),
    unique("posts_translation_group_id_locale_key").on(t.translationGroupId, t.locale),
    check("posts_locale", sql`${t.locale} in ('fa', 'en')`),
    check("posts_title_length", sql`char_length(${t.title}) between 3 and 160`),
    check("posts_excerpt_length", sql`char_length(${t.excerpt}) between 10 and 300`),
    check("posts_like_count_not_negative", sql`${t.likeCount} >= 0`),
    check("posts_comment_count_not_negative", sql`${t.commentCount} >= 0`),
    check(
      "posts_published_has_date",
      sql`${t.status} <> 'published' or ${t.publishedAt} is not null`,
    ),
    index("posts_published_idx")
      .on(t.locale, t.publishedAt.desc().nullsFirst())
      .where(sql`${t.status} = 'published'`),
    index("posts_tags_idx").using("gin", t.tags),
  ],
);

export const postLikes = pgTable(
  "post_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

// A comment is shown only once staff approve it (M9).
export const commentStatus = pgEnum("comment_status", ["pending", "approved", "rejected"]);

export const postComments = pgTable(
  "post_comments",
  {
    id: id(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    status: commentStatus("status").notNull().default("pending"),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: at("moderated_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("post_comments_body_length", sql`char_length(${t.body}) between 1 and 1000`),
    index("post_comments_post_idx").on(t.postId, t.createdAt.desc().nullsFirst()),
    // the moderation queue: what waits, oldest first
    index("post_comments_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
