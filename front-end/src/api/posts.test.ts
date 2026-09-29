import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authApi } from "@/api/auth";
import { postsApi } from "@/api/posts";
import { env } from "@/config/env";
import { normalizeError } from "@/lib/api-client";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * The article feed, against a real backend seeded with the sample posts.
 *
 * These cover the two things the interface gets wrong most easily: whether a
 * like is reported back as mine, and whether the optimistic patch that fills
 * the heart agrees with what the server actually stored.
 */

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();

describe.skipIf(!backendUp)("Posts API against the live backend", () => {
  let restoreFetch: () => void;
  let store: TestStore;

  beforeAll(() => {
    restoreFetch = installCookieJar();
  });

  afterAll(() => {
    restoreFetch();
  });

  beforeEach(() => {
    resetSession();
    store = createTestStore();
  });

  const registerAndSignIn = async () => {
    const credentials = uniqueCredentials();
    const result = await store.dispatch(
      authApi.endpoints.register.initiate(credentials),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Sign-up failed: ${normalizeError(result.error).message}`,
      );
    }

    return credentials;
  };

  /** The first article in the feed, whatever it happens to be. */
  const firstPost = async () => {
    const feed = await store.dispatch(
      postsApi.endpoints.getPosts.initiate({ limit: 1 }),
    );
    const post = feed.data?.posts[0];
    if (!post) throw new Error("No posts seeded. Run `npm run seed:posts`.");
    return post;
  };

  describe("Reading", () => {
    it("When the feed is read, then a page of cards comes back", async () => {
      const result = await store.dispatch(
        postsApi.endpoints.getPosts.initiate({ limit: 4 }),
      );

      expect(result.error).toBeUndefined();
      expect(result.data?.posts.length).toBeGreaterThan(0);
      expect(typeof result.data?.totalPostsLength).toBe("number");
    });

    it("When a card is listed, then it has everything the grid draws", async () => {
      const post = await firstPost();

      expect(post).toMatchObject({
        slug: expect.any(String),
        title: expect.any(String),
        excerpt: expect.any(String),
        coverImage: expect.stringMatching(/^\/uploads\//),
        likeCount: expect.any(Number),
        likedByMe: false,
        commentCount: expect.any(Number),
      });
      // The body is deliberately absent from a card.
      expect("content" in post).toBe(false);
    });

    it("When the tag list is read, then it holds the tags in use", async () => {
      const result = await store.dispatch(
        postsApi.endpoints.getPostTags.initiate(),
      );

      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data?.length).toBeGreaterThan(0);
    });

    it("When an article is opened by slug, then the whole body comes back", async () => {
      const card = await firstPost();

      const result = await store.dispatch(
        postsApi.endpoints.getPost.initiate(card.slug),
      );

      expect(result.error).toBeUndefined();
      expect(result.data?.content.length).toBeGreaterThan(100);
    });

    it("When the slug is unknown, then it reports 404", async () => {
      const result = await store.dispatch(
        postsApi.endpoints.getPost.initiate("no-such-article-anywhere"),
      );

      expect(normalizeError(result.error).status).toBe(404);
    });
  });

  describe("Liking", () => {
    it("When nobody is signed in, then liking is refused", async () => {
      const post = await firstPost();

      const result = await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );

      expect(
        normalizeError("error" in result ? result.error : undefined).status,
      ).toBe(401);
    });

    it("When a reader likes an article, then the count rises and it reads back as mine", async () => {
      await registerAndSignIn();
      const post = await firstPost();
      const before = post.likeCount;

      const liked = await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );

      expect("data" in liked && liked.data).toEqual({
        likeCount: before + 1,
        likedByMe: true,
      });

      // What the server stored has to match what the heart is showing.
      const reread = await store.dispatch(
        postsApi.endpoints.getPost.initiate(post.slug, { forceRefetch: true }),
      );
      expect(reread.data?.likedByMe).toBe(true);
      expect(reread.data?.likeCount).toBe(before + 1);

      // Leave the seeded article as it was found.
      await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );
    });

    it("When the same reader presses twice, then the like is taken back", async () => {
      await registerAndSignIn();
      const post = await firstPost();
      const before = post.likeCount;

      await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );
      const second = await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );

      expect("data" in second && second.data).toEqual({
        likeCount: before,
        likedByMe: false,
      });
    });

    it("When somebody else liked it, then it does not read back as mine", async () => {
      await registerAndSignIn();
      const post = await firstPost();
      await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );

      resetSession();
      const stranger = createTestStore();
      await stranger.dispatch(
        authApi.endpoints.register.initiate(uniqueCredentials()),
      );

      const seen = await stranger.dispatch(
        postsApi.endpoints.getPost.initiate(post.slug),
      );
      expect(seen.data?.likedByMe).toBe(false);
      expect(seen.data?.likeCount).toBeGreaterThan(0);

      // Undo, so repeated runs do not accumulate likes on the sample data.
      await store.dispatch(
        postsApi.endpoints.toggleLike.initiate({
          postId: post._id,
          slug: post.slug,
        }),
      );
    });
  });

  describe("Commenting", () => {
    it("When nobody is signed in, then commenting is refused", async () => {
      const post = await firstPost();

      const result = await store.dispatch(
        postsApi.endpoints.addComment.initiate({
          postId: post._id,
          slug: post.slug,
          body: "Hello",
        }),
      );

      expect(
        normalizeError("error" in result ? result.error : undefined).status,
      ).toBe(401);
    });

    it("When a reader comments, then it appears in the thread as theirs", async () => {
      const credentials = await registerAndSignIn();
      const post = await firstPost();

      const created = await store.dispatch(
        postsApi.endpoints.addComment.initiate({
          postId: post._id,
          slug: post.slug,
          body: "A useful read, thank you.",
        }),
      );

      expect("error" in created && created.error).toBeFalsy();
      const comment = "data" in created ? created.data : undefined;
      expect(comment).toMatchObject({
        body: "A useful read, thank you.",
        mine: true,
        author: { name: credentials.username },
      });

      const thread = await store.dispatch(
        postsApi.endpoints.getComments.initiate(
          { postId: post._id },
          { forceRefetch: true },
        ),
      );
      expect(thread.data?.comments[0]?.body).toBe("A useful read, thank you.");

      // Tidy up so the sample articles do not fill with test chatter.
      if (comment) {
        await store.dispatch(
          postsApi.endpoints.deleteComment.initiate({
            commentId: comment._id,
            postId: post._id,
            slug: post.slug,
          }),
        );
      }
    });

    it("When the comment is empty, then it is refused", async () => {
      await registerAndSignIn();
      const post = await firstPost();

      const result = await store.dispatch(
        postsApi.endpoints.addComment.initiate({
          postId: post._id,
          slug: post.slug,
          body: "   ",
        }),
      );

      expect(
        normalizeError("error" in result ? result.error : undefined).status,
      ).toBe(400);
    });

    it("When the author deletes their comment, then the thread loses it", async () => {
      await registerAndSignIn();
      const post = await firstPost();
      const created = await store.dispatch(
        postsApi.endpoints.addComment.initiate({
          postId: post._id,
          slug: post.slug,
          body: "Never mind.",
        }),
      );
      const comment = "data" in created ? created.data : undefined;
      expect(comment).toBeDefined();

      const deleted = await store.dispatch(
        postsApi.endpoints.deleteComment.initiate({
          commentId: comment!._id,
          postId: post._id,
          slug: post.slug,
        }),
      );

      expect("error" in deleted && deleted.error).toBeFalsy();

      const thread = await store.dispatch(
        postsApi.endpoints.getComments.initiate(
          { postId: post._id },
          { forceRefetch: true },
        ),
      );
      expect(
        thread.data?.comments.some((entry) => entry._id === comment!._id),
      ).toBe(false);
    });

    it("When somebody else wrote it, then deleting is refused", async () => {
      await registerAndSignIn();
      const post = await firstPost();
      const created = await store.dispatch(
        postsApi.endpoints.addComment.initiate({
          postId: post._id,
          slug: post.slug,
          body: "Mine alone.",
        }),
      );
      const comment = "data" in created ? created.data : undefined;

      resetSession();
      const stranger = createTestStore();
      await stranger.dispatch(
        authApi.endpoints.register.initiate(uniqueCredentials()),
      );

      const attempt = await stranger.dispatch(
        postsApi.endpoints.deleteComment.initiate({
          commentId: comment!._id,
          postId: post._id,
          slug: post.slug,
        }),
      );

      expect(
        normalizeError("error" in attempt ? attempt.error : undefined).status,
      ).toBe(403);

      // The author cleans up after themselves.
      await store.dispatch(
        postsApi.endpoints.deleteComment.initiate({
          commentId: comment!._id,
          postId: post._id,
          slug: post.slug,
        }),
      );
    });
  });
});
