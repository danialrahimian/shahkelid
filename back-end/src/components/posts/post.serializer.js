"use strict";

/**
 * Shapes a post for the wire.
 *
 * The list of people who liked something is nobody's business but the server's,
 * so it never leaves: what goes out is the count, and whether the person
 * asking is among them. That is everything the interface needs and nothing it
 * does not.
 */
const toPublicPost = (post, viewerId) => {
  if (!post) return null;
  const plain = typeof post.toObject === "function" ? post.toObject() : post;

  const likes = plain.likes ?? [];
  const viewer = viewerId ? String(viewerId) : null;

  return {
    _id: plain._id,
    slug: plain.slug,
    title: plain.title,
    excerpt: plain.excerpt,
    content: plain.content,
    coverImage: plain.coverImage,
    tags: plain.tags ?? [],
    readingMinutes: plain.readingMinutes ?? 1,
    author: {
      name: plain.author?.name ?? "Unknown",
      avatar: plain.author?.avatar ?? null,
    },
    likeCount: likes.length,
    likedByMe: viewer
      ? likes.some((id) => String(id) === viewer)
      : false,
    commentCount: plain.commentCount ?? 0,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

/** The card in the grid needs everything but the article body. */
const toPublicPostSummary = (post, viewerId) => {
  const full = toPublicPost(post, viewerId);
  if (!full) return null;

  const { content: _content, ...summary } = full;
  void _content;
  return summary;
};

/** Words in the article, counted the way a reader would. */
const wordCount = (text) =>
  String(text ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;

/**
 * Whether this viewer wrote the post.
 *
 * Decided on the stored author id and nothing else. The author's name is a
 * copy taken at the time of writing, and two staff members can share one.
 */
const isAuthor = (post, viewerId) =>
  Boolean(
    viewerId &&
      post?.author?.userId &&
      String(post.author.userId) === String(viewerId),
  );

/**
 * The staff view of a post: everything the public sees, plus whether the
 * viewer may edit it and how long it is.
 *
 * `canEdit` travels with the post so the dashboard never has to know the
 * ownership rule. It only reflects the rule; the server enforces it again on
 * every write.
 */
const toStaffPost = (post, viewerId) => {
  if (!post) return null;
  const plain = typeof post.toObject === "function" ? post.toObject() : post;

  return {
    ...toPublicPost(plain, viewerId),
    canEdit: isAuthor(plain, viewerId),
    wordCount: wordCount(plain.content),
  };
};

/** The staff list, which like the public one leaves the body out. */
const toStaffPostSummary = (post, viewerId) => {
  const full = toStaffPost(post, viewerId);
  if (!full) return null;

  const { content: _content, ...summary } = full;
  void _content;
  return summary;
};

const toPublicComment = (comment, viewerId) => {
  if (!comment) return null;
  const plain =
    typeof comment.toObject === "function" ? comment.toObject() : comment;

  const authorId = plain.author?.userId;

  return {
    _id: plain._id,
    postId: plain.postId,
    body: plain.body,
    author: {
      name: plain.author?.name ?? "Unknown",
      avatar: plain.author?.avatar ?? null,
    },
    // Lets the client show a delete button without having to know the rules.
    mine: Boolean(
      viewerId && authorId && String(authorId) === String(viewerId),
    ),
    createdAt: plain.createdAt,
  };
};

const toPublicPosts = (posts, viewerId) =>
  posts.map((post) => toPublicPostSummary(post, viewerId));

const toPublicComments = (comments, viewerId) =>
  comments.map((comment) => toPublicComment(comment, viewerId));

module.exports = {
  isAuthor,
  toStaffPost,
  toStaffPostSummary,
  wordCount,
  toPublicPost,
  toPublicPostSummary,
  toPublicPosts,
  toPublicComment,
  toPublicComments,
};
