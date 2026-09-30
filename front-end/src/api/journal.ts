import type {
  CommentStatus,
  CommentView,
  PostInput,
  PostPage,
  PostStatus,
  PostView,
  StaffCommentView,
  StaffPostSummary,
  StaffPostView,
} from "@shah-kelid/contracts";

import { env } from "@/config/env";
import { api } from "@/lib/api";

/**
 * The journal: reading, liking and commenting (/api/v1/posts), and writing
 * and moderating it (/api/v1/staff).
 */

const JOURNAL = "/api/v1/posts";
const STAFF = "/api/v1/staff";

/** A cover's address on the API, for an <img>. */
export const coverSrc = (coverUrl: string | null) => (coverUrl ? `${env.API_URL}${coverUrl}` : null);

export const journalApi = api.injectEndpoints({
  endpoints: (builder) => ({
    journalPosts: builder.query<PostPage, { page: number; tag?: string; search?: string }>({
      query: ({ page, tag, search }) => ({
        url: JOURNAL,
        params: { page, ...(tag ? { tag } : {}), ...(search ? { search } : {}) },
      }),
      providesTags: ["Post"],
    }),
    journalTags: builder.query<string[], void>({
      query: () => `${JOURNAL}/tags`,
      providesTags: ["Post"],
    }),
    journalPost: builder.query<PostView, string>({
      query: (slug) => `${JOURNAL}/${encodeURIComponent(slug)}`,
      providesTags: (_result, _error, slug) => [{ type: "Post", id: slug }],
    }),
    journalLike: builder.mutation<{ likeCount: number; likedByMe: boolean }, { postId: string; slug: string }>({
      query: ({ postId }) => ({ url: `${JOURNAL}/${postId}/like`, method: "POST" }),
      // Written into the cached post, so the heart answers the tap without a refetch.
      async onQueryStarted({ slug }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            journalApi.util.updateQueryData("journalPost", slug, (post) => {
              post.likeCount = data.likeCount;
              post.likedByMe = data.likedByMe;
            }),
          );
        } catch {
          // The caller shows the error.
        }
      },
    }),
    journalComments: builder.query<CommentView[], string>({
      query: (postId) => `${JOURNAL}/${postId}/comments`,
      providesTags: (_result, _error, postId) => [{ type: "Comment", id: postId }],
    }),
    journalAddComment: builder.mutation<CommentView, { postId: string; body: string }>({
      query: ({ postId, body }) => ({ url: `${JOURNAL}/${postId}/comments`, method: "POST", body: { body } }),
      invalidatesTags: (_result, _error, { postId }) => [{ type: "Comment", id: postId }],
    }),
    journalDeleteComment: builder.mutation<void, { postId: string; commentId: string }>({
      query: ({ commentId }) => ({ url: `${JOURNAL}/comments/${commentId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, { postId }) => [{ type: "Comment", id: postId }, "Post"],
    }),

    staffPosts: builder.query<StaffPostSummary[], { status?: PostStatus; search?: string }>({
      query: ({ status, search }) => ({
        url: `${STAFF}/posts`,
        params: { ...(status ? { status } : {}), ...(search ? { search } : {}) },
      }),
      providesTags: ["StaffPost"],
    }),
    staffPost: builder.query<StaffPostView, string>({
      query: (id) => `${STAFF}/posts/${id}`,
      providesTags: (_result, _error, id) => [{ type: "StaffPost", id }],
    }),
    staffSavePost: builder.mutation<StaffPostView, { id?: string; body: PostInput }>({
      query: ({ id, body }) => ({ url: id ? `${STAFF}/posts/${id}` : `${STAFF}/posts`, method: id ? "PUT" : "POST", body }),
      invalidatesTags: ["StaffPost", "Post"],
    }),
    staffSetCover: builder.mutation<StaffPostView, { id: string; form: FormData | null }>({
      query: ({ id, form }) =>
        form
          ? { url: `${STAFF}/posts/${id}/cover`, method: "POST", body: form }
          : { url: `${STAFF}/posts/${id}/cover`, method: "DELETE" },
      invalidatesTags: ["StaffPost", "Post"],
    }),
    staffComments: builder.query<StaffCommentView[], CommentStatus>({
      query: (status) => ({ url: `${STAFF}/comments`, params: { status } }),
      providesTags: ["StaffComment"],
    }),
    staffModerateComment: builder.mutation<void, { id: string; decision: "approve" | "reject" }>({
      query: ({ id, decision }) => ({ url: `${STAFF}/comments/${id}/moderate`, method: "POST", body: { decision } }),
      invalidatesTags: ["StaffComment", "Comment", "Post"],
    }),
    staffDeleteComment: builder.mutation<void, string>({
      query: (id) => ({ url: `${STAFF}/comments/${id}`, method: "DELETE" }),
      invalidatesTags: ["StaffComment", "Comment", "Post"],
    }),
  }),
});

export const {
  useJournalPostsQuery,
  useJournalTagsQuery,
  useJournalPostQuery,
  useJournalLikeMutation,
  useJournalCommentsQuery,
  useJournalAddCommentMutation,
  useJournalDeleteCommentMutation,
  useStaffPostsQuery,
  useStaffPostQuery,
  useStaffSavePostMutation,
  useStaffSetCoverMutation,
  useStaffCommentsQuery,
  useStaffModerateCommentMutation,
  useStaffDeleteCommentMutation,
} = journalApi;
