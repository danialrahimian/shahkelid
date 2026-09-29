import * as z from "zod";

import { api } from "@/lib/api";
import { imageFileSchema } from "@/utils/image-upload";
import type {
  Comment,
  CommentsPage,
  Post,
  PostSummary,
  PostsPage,
  PostsQuery,
  StaffPost,
  StaffPostsPage,
  StaffPostsQuery,
} from "@/types/api";

/**
 * The article feed, its likes and its comments.
 *
 * Reading needs no session; liking and commenting do. The endpoints mirror
 * that: the list and the article are plain queries, and the two that write are
 * mutations that keep the affected caches in step.
 */

export const commentInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(1000, "A comment must be 1000 characters or fewer"),
});
export type CommentInput = z.infer<typeof commentInputSchema>;

const MAX_TAGS = 8;

/**
 * Tags as typed -- "privacy, dns, public wi-fi" -- split into the list the
 * server stores. Shared by the form's validation and its submit, so the count
 * the form checks is the count that is sent.
 */
export const splitTags = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean),
  ),
];

/** Mirrors the validator chain on `POST /staff/posts`. */
export const postInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "The title needs at least 3 characters")
    .max(160, "Keep the title under 160 characters"),
  excerpt: z
    .string()
    .trim()
    .min(10, "The summary needs at least 10 characters")
    .max(300, "Keep the summary under 300 characters"),
  content: z
    .string()
    .trim()
    .min(50, "The article needs at least 50 characters")
    .max(50_000, "The article must be 50000 characters or fewer"),
  tags: z
    .string()
    .refine(
      (text) => splitTags(text).length <= MAX_TAGS,
      `Use at most ${MAX_TAGS} tags`,
    )
    .refine(
      (text) => splitTags(text).every((tag) => tag.length <= 30),
      "A tag must be 30 characters or fewer",
    ),
  cover: imageFileSchema,
});
export type PostInput = z.infer<typeof postInputSchema>;

/**
 * The form is multipart because it carries a file, so the tag list travels as
 * JSON inside one field, the same way a product's perks do.
 */
const toPostFormData = (input: PostInput) => {
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("excerpt", input.excerpt);
  formData.append("content", input.content);
  formData.append("tags", JSON.stringify(splitTags(input.tags)));
  if (input.cover instanceof File) {
    formData.append("cover", input.cover);
  }
  return formData;
};

export const postsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPosts: builder.query<PostsPage, PostsQuery | void>({
      query: (params) => {
        const query = new URLSearchParams();
        const { page, limit, tag, search } = params ?? {};

        if (page) query.set("page", String(page));
        if (limit) query.set("limit", String(limit));
        if (tag) query.set("tag", tag);
        if (search) query.set("search", search);

        const queryString = query.toString();
        return queryString ? `/posts?${queryString}` : "/posts";
      },
      providesTags: (result) =>
        result
          ? [
              ...result.posts.map(({ _id }) => ({
                type: "Post" as const,
                id: _id,
              })),
              { type: "Post" as const, id: "LIST" },
            ]
          : [{ type: "Post" as const, id: "LIST" }],
    }),

    getPostTags: builder.query<string[], void>({
      query: () => "/posts/tags",
      providesTags: [{ type: "Post", id: "TAGS" }],
    }),

    getPost: builder.query<Post, string>({
      query: (slug) => `/posts/${slug}`,
      providesTags: (_result, _error, slug) => [{ type: "Post", id: slug }],
    }),

    /**
     * Turns a like on or off.
     *
     * Applied optimistically: the heart fills the instant it is pressed and
     * rolls back if the server disagrees. Waiting a round trip for something
     * this small makes the whole page feel sluggish.
     */
    toggleLike: builder.mutation<
      { likeCount: number; likedByMe: boolean },
      { postId: string; slug: string }
    >({
      query: ({ postId }) => ({
        url: `/posts/${postId}/like`,
        method: "POST",
      }),
      onQueryStarted: async (
        { postId, slug },
        { dispatch, queryFulfilled, getState },
      ) => {
        const applyTo = <T extends { likeCount: number; likedByMe: boolean }>(
          draft: T,
        ) => {
          draft.likedByMe = !draft.likedByMe;
          draft.likeCount += draft.likedByMe ? 1 : -1;
        };

        // Every cached page of the feed that might hold this card.
        const state = getState() as {
          api: {
            queries: Record<
              string,
              { endpointName?: string; originalArgs?: PostsQuery } | undefined
            >;
          };
        };

        const feedArgs = Object.values(state.api.queries)
          .filter((entry) => entry?.endpointName === "getPosts")
          .map((entry) => entry?.originalArgs);

        /** Applies a change to the article page and to every feed page. */
        const everywhere = (
          change: (target: {
            likeCount: number;
            likedByMe: boolean;
          }) => void,
        ) => [
          dispatch(postsApi.util.updateQueryData("getPost", slug, change)),
          ...feedArgs.map((args) =>
            dispatch(
              postsApi.util.updateQueryData("getPosts", args, (draft) => {
                const card = draft.posts.find((post) => post._id === postId);
                if (card) change(card);
              }),
            ),
          ),
        ];

        const patches = everywhere(applyTo);

        try {
          const { data } = await queryFulfilled;

          // Settle on what the server actually stored. The guess above assumed
          // nobody else was liking the same article at the same moment, and a
          // count that drifts is worse than one that arrives a beat late.
          everywhere((target) => {
            target.likeCount = data.likeCount;
            target.likedByMe = data.likedByMe;
          });
        } catch {
          patches.forEach((patch) => patch.undo());
        }
      },
    }),

    getComments: builder.query<
      CommentsPage,
      { postId: string; page?: number; limit?: number }
    >({
      query: ({ postId, page, limit }) => {
        const query = new URLSearchParams();
        if (page) query.set("page", String(page));
        if (limit) query.set("limit", String(limit));

        const queryString = query.toString();
        return queryString
          ? `/posts/${postId}/comments?${queryString}`
          : `/posts/${postId}/comments`;
      },
      providesTags: (_result, _error, { postId }) => [
        { type: "Comment", id: postId },
      ],
    }),

    addComment: builder.mutation<
      Comment,
      { postId: string; slug: string; body: string }
    >({
      query: ({ postId, body }) => ({
        url: `/posts/${postId}/comments`,
        method: "POST",
        body: { body },
      }),
      // The card and the article both show a comment count.
      invalidatesTags: (_result, _error, { postId, slug }) => [
        { type: "Comment", id: postId },
        { type: "Post", id: postId },
        { type: "Post", id: slug },
        { type: "Post", id: "LIST" },
      ],
    }),

    deleteComment: builder.mutation<
      { message: string },
      { commentId: string; postId: string; slug: string }
    >({
      query: ({ commentId }) => ({
        url: `/comments/${commentId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, _error, { postId, slug }) => [
        { type: "Comment", id: postId },
        { type: "Post", id: postId },
        { type: "Post", id: slug },
        { type: "Post", id: "LIST" },
      ],
    }),

    // ------------------------------------------------------------- staff

    /**
     * Every post, for the dashboard, each marked with whether the viewer may
     * edit it. Staff only on the server.
     */
    getStaffPosts: builder.query<StaffPostsPage, StaffPostsQuery | void>({
      query: (params) => {
        const query = new URLSearchParams();
        const { page, limit, search, mine } = params ?? {};

        if (page) query.set("page", String(page));
        if (limit) query.set("limit", String(limit));
        if (search) query.set("search", search);
        if (mine) query.set("mine", "true");

        const queryString = query.toString();
        return queryString ? `/staff/posts?${queryString}` : "/staff/posts";
      },
      providesTags: (result) =>
        result
          ? [
              ...result.posts.map(({ _id }) => ({
                type: "StaffPost" as const,
                id: _id,
              })),
              { type: "StaffPost" as const, id: "LIST" },
            ]
          : [{ type: "StaffPost" as const, id: "LIST" }],
    }),

    getStaffPost: builder.query<StaffPost, string>({
      query: (postId) => `/staff/posts/${postId}`,
      providesTags: (_result, _error, postId) => [
        { type: "StaffPost", id: postId },
      ],
    }),

    /**
     * Publishing lands in two places: the dashboard's list and the public
     * journal. Both are invalidated, along with the tag filter, which a new
     * tag has just extended.
     */
    createPost: builder.mutation<StaffPost, PostInput>({
      query: (input) => ({
        url: "/staff/posts",
        method: "POST",
        body: toPostFormData(input),
      }),
      invalidatesTags: [
        { type: "StaffPost", id: "LIST" },
        { type: "Post", id: "LIST" },
        { type: "Post", id: "TAGS" },
      ],
    }),

    updatePost: builder.mutation<
      StaffPost,
      { postId: string; input: PostInput }
    >({
      query: ({ postId, input }) => ({
        url: `/staff/posts/${postId}`,
        method: "PUT",
        body: toPostFormData(input),
      }),
      // The public article is cached by slug, which comes back in the result.
      invalidatesTags: (result, _error, { postId }) => [
        { type: "StaffPost", id: postId },
        { type: "StaffPost", id: "LIST" },
        { type: "Post", id: postId },
        { type: "Post", id: "LIST" },
        { type: "Post", id: "TAGS" },
        ...(result ? [{ type: "Post" as const, id: result.slug }] : []),
      ],
    }),
  }),
});

export type { PostSummary };

export const {
  useGetPostsQuery,
  useGetPostTagsQuery,
  useGetPostQuery,
  useToggleLikeMutation,
  useGetCommentsQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useGetStaffPostsQuery,
  useGetStaffPostQuery,
  useCreatePostMutation,
  useUpdatePostMutation,
} = postsApi;
