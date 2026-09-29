import * as z from "zod";

import { api } from "@/lib/api";
import type { User } from "@/types/api";

/**
 * User administration, behind the moderator and owner roles on the server.
 */

export const editUserInputSchema = z.object({
  _id: z.string().min(1),
  username: z
    .string()
    .min(3, "Username must be between 3 and 20 characters")
    .max(20, "Username must be between 3 and 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers and underscore",
    )
    .or(z.literal("")),
  email: z.string().email("Enter a valid email address").or(z.literal("")),
  // Blank means "keep the current password", which is what the API expects.
  password: z
    .string()
    .min(6, "Password must be more than 5 characters")
    .max(72, "Password is too long")
    .or(z.literal("")),
  role: z
    .enum(["user", "admin", "moderator", "owner"])
    .or(z.literal(""))
    .optional(),
});
export type EditUserInput = z.infer<typeof editUserInputSchema>;

export const usersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getUsers: builder.query<User[], void>({
      query: () => "/mod/users",
      providesTags: ["User"],
    }),

    deleteUser: builder.mutation<User[], string>({
      query: (userId) => ({
        url: `/mod/users/delete-user/${userId}`,
        method: "POST",
      }),
      invalidatesTags: ["User"],
    }),

    editUser: builder.mutation<User[], EditUserInput>({
      query: (body) => ({
        url: "/mod/user/edit-user",
        method: "POST",
        // Empty strings mean "unchanged"; sending them would fail validation.
        body: Object.fromEntries(
          Object.entries(body).filter(([, value]) => value !== ""),
        ),
      }),
      // Editing can change a role, which changes what that person may do.
      invalidatesTags: ["User", "Session"],
    }),

    addToUserCart: builder.mutation<
      User[],
      { userId: string; productId: string }
    >({
      query: (body) => ({ url: "/mod/user-cart/add", method: "POST", body }),
      invalidatesTags: ["User", "Cart", "Session"],
    }),

    removeFromUserCart: builder.mutation<
      User[],
      { userId: string; productId: string }
    >({
      query: (body) => ({ url: "/mod/user-cart/remove", method: "POST", body }),
      invalidatesTags: ["User", "Cart", "Session"],
    }),
  }),
});

export const {
  useGetUsersQuery,
  useDeleteUserMutation,
  useEditUserMutation,
  useAddToUserCartMutation,
  useRemoveFromUserCartMutation,
} = usersApi;
