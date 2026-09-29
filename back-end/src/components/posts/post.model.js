"use strict";

const mongoose = require("mongoose");

/**
 * Articles, and the comments people leave on them.
 *
 * Two collections rather than one document with everything embedded. Comments
 * grow without bound and are read on their own page, so keeping them separate
 * means listing ten articles does not drag every comment ever written along
 * with it.
 *
 * Likes are the opposite case: the array is the count, and it is also how the
 * app answers "have I liked this?" in the same read. Storing the ids avoids
 * both a second query and a counter that can drift away from reality.
 */

const postSchema = new mongoose.Schema(
  {
    /** The URL segment. Unique, because it addresses the post. */
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    /** One or two lines, shown on the card before the article is opened. */
    excerpt: { type: String, required: true, trim: true, maxlength: 300 },
    /** The article itself, in plain paragraphs separated by blank lines. */
    content: { type: String, required: true },
    coverImage: { type: String, required: true },
    tags: { type: [String], default: [], index: true },
    readingMinutes: { type: Number, default: 1, min: 1 },

    author: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String, required: true, trim: true },
      avatar: { type: String, default: null },
    },

    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    /**
     * Kept in step with the comments collection by `$inc`. Denormalised on
     * purpose: the grid shows a count for every card, and counting rows per
     * card would be one query per post on every page load.
     */
    commentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// The catalogue is browsed newest first, and filtered by tag.
postSchema.index({ createdAt: -1 });

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    author: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: { type: String, required: true, trim: true },
      avatar: { type: String, default: null },
    },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

commentSchema.index({ postId: 1, createdAt: -1 });

const Post = mongoose.model("Post", postSchema);
const Comment = mongoose.model("Comment", commentSchema);

module.exports = { Post, Comment };
