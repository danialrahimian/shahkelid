"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");

const { Post, Comment } = require("./post.model");
const {
  isAuthor,
  toPublicPost,
  toPublicPosts,
  toPublicComment,
  toPublicComments,
  toStaffPost,
  toStaffPostSummary,
  wordCount,
} = require("./post.serializer");
const {
  badRequest,
  forbidden,
  notFound,
} = require("../../libraries/errors/app-error");
const {
  deleteUpload,
  toPublicPath,
} = require("../../libraries/storage/file-store");

const MAX_PAGE_SIZE = 30;

/** Escapes user input before it becomes part of a RegExp. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertValidId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest(`Invalid ${label}`);
  }
};

/**
 * A page of articles, newest first.
 *
 * `viewerId` is optional: signed out, every post simply comes back unliked.
 * The list is readable without a session, which is what lets the feed render
 * before anyone signs in.
 */
const listPosts = async (query = {}, viewerId) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || 9;
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);

  const filter = {};

  if (query.tag) {
    filter.tags = String(query.tag);
  }

  if (query.search) {
    const pattern = escapeRegex(String(query.search));
    filter.$or = [
      { title: { $regex: pattern, $options: "i" } },
      { excerpt: { $regex: pattern, $options: "i" } },
    ];
  }

  const [posts, totalPostsLength] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Post.countDocuments(filter),
  ]);

  return { posts: toPublicPosts(posts, viewerId), totalPostsLength, limit };
};

/** Every tag in use, so the feed can offer them as filters. */
const listTags = async () => {
  const tags = await Post.distinct("tags");
  return tags.filter(Boolean).sort((a, b) => a.localeCompare(b));
};

/**
 * One article, addressed by its slug.
 *
 * A slug rather than an id because it is a public URL that people read and
 * share, and "/posts/why-encryption-matters" says what "/posts/6aa5..." cannot.
 */
const getPostBySlug = async (slug, viewerId) => {
  const post = await Post.findOne({ slug: String(slug).toLowerCase() }).lean();
  if (!post) throw notFound("That article does not exist");

  return toPublicPost(post, viewerId);
};

/**
 * Turns a like on, or off.
 *
 * One endpoint rather than a like and an unlike, because the button is a
 * toggle and two endpoints would let the client and the server disagree about
 * which state it is in. `$addToSet` and `$pull` also make a double click
 * harmless: neither can add a second like or remove one twice.
 */
const toggleLike = async (postId, viewerId) => {
  assertValidId(postId, "post id");

  const post = await Post.findById(postId).select("likes");
  if (!post) throw notFound("That article does not exist");

  const alreadyLiked = post.likes.some(
    (id) => String(id) === String(viewerId),
  );

  const updated = await Post.findByIdAndUpdate(
    postId,
    alreadyLiked
      ? { $pull: { likes: viewerId } }
      : { $addToSet: { likes: viewerId } },
    { returnDocument: "after" },
  ).lean();

  return {
    likeCount: updated.likes.length,
    likedByMe: !alreadyLiked,
  };
};

const listComments = async (postId, query = {}, viewerId) => {
  assertValidId(postId, "post id");

  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || 20, 1),
    MAX_PAGE_SIZE,
  );

  const [comments, totalCommentsLength] = await Promise.all([
    Comment.find({ postId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Comment.countDocuments({ postId }),
  ]);

  return {
    comments: toPublicComments(comments, viewerId),
    totalCommentsLength,
    limit,
  };
};

const addComment = async (postId, user, body) => {
  assertValidId(postId, "post id");

  const post = await Post.findById(postId).select("_id");
  if (!post) throw notFound("That article does not exist");

  const comment = await Comment.create({
    postId,
    author: {
      userId: user._id,
      // Copied rather than joined: a comment should still read correctly if
      // the account is later renamed or deleted.
      name: user.displayName || user.username,
      avatar: user.avatar ?? null,
    },
    body,
  });

  await Post.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });

  return toPublicComment(comment, user._id);
};

/**
 * Removes a comment.
 *
 * The author may delete their own; a moderator or owner may delete any. Anyone
 * else is refused, and the check is here rather than in the route so it cannot
 * be forgotten by a second caller.
 */
const deleteComment = async (commentId, user) => {
  assertValidId(commentId, "comment id");

  const comment = await Comment.findById(commentId);
  if (!comment) throw notFound("That comment does not exist");

  const isAuthor = String(comment.author.userId) === String(user._id);
  const canModerate = user.role === "moderator" || user.role === "owner";

  if (!isAuthor && !canModerate) {
    throw forbidden("You can only delete your own comments");
  }

  await Comment.findByIdAndDelete(commentId);
  // Floored at zero, so a double delete cannot drive the count negative.
  await Post.findByIdAndUpdate(comment.postId, {
    $inc: { commentCount: -1 },
  });
  await Post.updateOne(
    { _id: comment.postId, commentCount: { $lt: 0 } },
    { $set: { commentCount: 0 } },
  );

  return { message: "Comment deleted" };
};

// ------------------------------------------------------------ writing posts

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 30;
const MAX_SLUG_LENGTH = 80;

/** A comfortable reading pace, which is what "min read" promises. */
const WORDS_PER_MINUTE = 200;

const readingMinutesFor = (content) =>
  Math.max(1, Math.round(wordCount(content) / WORDS_PER_MINUTE));

/**
 * The URL segment for a title.
 *
 * Letters are kept in whatever script they are written in rather than being
 * transliterated or dropped. An ASCII-only slug would turn a Persian title
 * into an empty string, and every Persian article into "article-2",
 * "article-3" and so on -- addresses that say nothing about what they lead to.
 */
const slugFromTitle = (title) =>
  String(title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "") || "article";

/** The first free slug for a title: the title itself, then -2, -3 and so on. */
const availableSlug = async (base) => {
  if (!(await Post.exists({ slug: base }))) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await Post.exists({ slug: candidate }))) return candidate;
  }

  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
};

/**
 * Tags arrive as a JSON array because the form is multipart, the same way a
 * product's perks do.
 *
 * They are lower-cased and hyphenated because they are filters in a URL:
 * "Privacy" and "privacy" would otherwise be two tags that each show half the
 * articles.
 */
const parseTags = (raw) => {
  if (raw === undefined || raw === null || raw === "") return [];

  let list = raw;
  if (!Array.isArray(list)) {
    try {
      list = JSON.parse(raw);
    } catch {
      throw badRequest("tags must be a JSON array of strings");
    }
  }
  if (!Array.isArray(list)) {
    throw badRequest("tags must be a JSON array of strings");
  }

  const tags = [
    ...new Set(
      list
        .map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ];

  if (tags.length > MAX_TAGS) {
    throw badRequest(`a post can have at most ${MAX_TAGS} tags`);
  }
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    throw badRequest(`a tag must be ${MAX_TAG_LENGTH} characters or fewer`);
  }

  return tags;
};

/** Whether an error is the unique index on the slug refusing a duplicate. */
const isDuplicateSlug = (error) =>
  error?.code === 11000 && Boolean(error.keyPattern?.slug);

/**
 * Every post, for the dashboard, with whether the viewer may edit each one.
 *
 * All of them rather than only the viewer's own, because staff need to see
 * what is already published before writing the next one. `mine=true`
 * narrows it to their own.
 */
const listStaffPosts = async (query = {}, viewer) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || 12, 1),
    MAX_PAGE_SIZE,
  );

  const filter = {};

  if (query.mine === "true") {
    filter["author.userId"] = viewer._id;
  }

  if (query.search) {
    const pattern = escapeRegex(String(query.search));
    filter.$or = [
      { title: { $regex: pattern, $options: "i" } },
      { excerpt: { $regex: pattern, $options: "i" } },
      { slug: { $regex: pattern, $options: "i" } },
    ];
  }

  const [posts, totalPostsLength] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Post.countDocuments(filter),
  ]);

  return {
    posts: posts.map((post) => toStaffPostSummary(post, viewer._id)),
    totalPostsLength,
    limit,
    page,
  };
};

/** One post in full, by id, for the details view and the edit form. */
const getStaffPost = async (postId, viewer) => {
  assertValidId(postId, "post id");

  const post = await Post.findById(postId).lean();
  if (!post) throw notFound("That article does not exist");

  return toStaffPost(post, viewer._id);
};

/**
 * Publishes a post under the signed-in member of staff's name.
 *
 * The slug and the reading time are worked out here rather than taken from
 * the form. A slug is an address other people will link to, so it should not
 * be something a typo can break, and a reading time a person types in is a
 * guess.
 */
const createPost = async (author, { body, file }) => {
  if (!file) throw badRequest("a cover image is required");

  const tags = parseTags(body.tags);
  const base = slugFromTitle(body.title);

  const document = {
    title: body.title,
    excerpt: body.excerpt,
    content: body.content,
    coverImage: toPublicPath(file.filename),
    tags,
    readingMinutes: readingMinutesFor(body.content),
    author: {
      userId: author._id,
      // Copied rather than joined, like a comment's author: the byline should
      // read the same if the account is later renamed.
      name: author.displayName || author.username,
      avatar: author.avatar ?? null,
    },
  };

  let post;
  try {
    post = await Post.create({ ...document, slug: await availableSlug(base) });
  } catch (error) {
    // Two posts with the same title published at the same moment can both
    // find the same slug free. The unique index lets only one through; the
    // other gets a random suffix rather than a 500.
    if (!isDuplicateSlug(error)) throw error;
    post = await Post.create({
      ...document,
      slug: `${base}-${crypto.randomBytes(3).toString("hex")}`,
    });
  }

  return toStaffPost(post, author._id);
};

/**
 * Edits a post. Only the member of staff who wrote it may.
 *
 * The slug is deliberately left alone. It is the post's public address, and
 * it has already been shared: renaming it on every edited title would break
 * every link to the article that is out in the world.
 */
const updatePost = async (editor, postId, { body, file }) => {
  assertValidId(postId, "post id");

  const post = await Post.findById(postId);
  if (!post) throw notFound("That article does not exist");

  if (!isAuthor(post, editor._id)) {
    throw forbidden("You can only edit your own posts");
  }

  // Parsed before anything changes, so a bad tag list leaves the post as it
  // was rather than half-saved.
  const tags = parseTags(body.tags);
  const previousCover = post.coverImage;

  post.title = body.title;
  post.excerpt = body.excerpt;
  post.content = body.content;
  post.tags = tags;
  post.readingMinutes = readingMinutesFor(body.content);
  if (file) post.coverImage = toPublicPath(file.filename);

  await post.save();

  // The old cover goes once nothing points at it any more. Checked rather
  // than assumed, because a post can share its cover with another.
  if (file && previousCover && previousCover !== post.coverImage) {
    const stillUsed = await Post.exists({ coverImage: previousCover });
    if (!stillUsed) await deleteUpload(previousCover);
  }

  return toStaffPost(post, editor._id);
};

module.exports = {
  listStaffPosts,
  getStaffPost,
  createPost,
  updatePost,
  slugFromTitle,
  readingMinutesFor,
  listPosts,
  listTags,
  getPostBySlug,
  toggleLike,
  listComments,
  addComment,
  deleteComment,
};
