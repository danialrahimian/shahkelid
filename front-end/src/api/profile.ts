import * as z from "zod";

import { api } from "@/lib/api";
import type { User } from "@/types/api";

/**
 * A person's own account.
 *
 * Distinct from `users.ts`, which is the moderator's view of everyone else.
 * Nothing here can change a role: that is the moderator's endpoint, and only
 * an owner may use it.
 */

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** Mirrors the validator chain on `PUT /profile`. */
export const profileInputSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be between 3 and 20 characters")
    .max(20, "Username must be between 3 and 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers and underscore",
    ),
  email: z.string().email("Enter a valid email address"),
  displayName: z
    .string()
    .max(60, "Display name must be 60 characters or fewer"),
  bio: z.string().max(300, "Bio must be 300 characters or fewer"),
  phone: z.string().max(20, "Phone must be 20 characters or fewer"),
  country: z.string().max(60, "Country must be 60 characters or fewer"),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(6, "Password must be more than 5 characters")
      .max(72, "Password is too long"),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const deleteAccountInputSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm"),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

export const avatarFileSchema = z
  .instanceof(File)
  .refine(
    (file) => file.size <= MAX_AVATAR_BYTES,
    "The image must be under 5MB",
  )
  .refine(
    (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
    "Only PNG, JPEG, WEBP or GIF images are allowed",
  );

export const profileApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getProfile: builder.query<User, void>({
      query: () => "/profile",
      providesTags: ["Profile"],
    }),

    updateProfile: builder.mutation<User, Partial<ProfileInput>>({
      query: (body) => ({ url: "/profile", method: "PUT", body }),
      // The navigation and the session both show the name and the avatar.
      invalidatesTags: ["Profile", "Session", "User"],
    }),

    changePassword: builder.mutation<
      { message: string },
      { currentPassword: string; newPassword: string }
    >({
      query: (body) => ({ url: "/profile/password", method: "PUT", body }),
    }),

    updateAvatar: builder.mutation<User, File>({
      query: (file) => {
        const formData = new FormData();
        formData.append("avatar", file);
        return { url: "/profile/avatar", method: "PUT", body: formData };
      },
      invalidatesTags: ["Profile", "Session", "User"],
    }),

    removeAvatar: builder.mutation<User, void>({
      query: () => ({ url: "/profile/avatar", method: "DELETE" }),
      invalidatesTags: ["Profile", "Session", "User"],
    }),

    deleteAccount: builder.mutation<{ message: string }, DeleteAccountInput>({
      query: (body) => ({ url: "/profile/delete", method: "POST", body }),
      // The account is gone, so everything cached about it is meaningless.
      invalidatesTags: [
        "Profile",
        "Session",
        "Cart",
        "Order",
        "AdminProduct",
        "User",
      ],
    }),
  }),
});

export const {
  useGetProfileQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useUpdateAvatarMutation,
  useRemoveAvatarMutation,
  useDeleteAccountMutation,
} = profileApi;
