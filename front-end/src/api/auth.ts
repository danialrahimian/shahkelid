import * as z from "zod";

import { api } from "@/lib/api";
import type { Session, User } from "@/types/api";

/**
 * Every authentication request the app can make, declared in one place with
 * the schema that validates its input.
 *
 * The schemas are shared with the forms, so the rules the user sees while
 * typing are the same rules sent to the server rather than a second copy that
 * can drift.
 */

export const loginInputSchema = z.object({
  // The server matches on username OR email, so one field accepts either.
  identifier: z
    .string()
    .min(1, "Enter your username or email")
    .transform((value) => value.trim()),
  password: z.string().min(1, "Enter your password"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const registerInputSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be between 3 and 20 characters")
    .max(20, "Username must be between 3 and 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers and underscore",
    ),
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(6, "Password must be more than 5 characters")
    // bcrypt silently truncates past 72 bytes, and so does the API.
    .max(72, "Password is too long"),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const resetLinkInputSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
export type ResetLinkInput = z.infer<typeof resetLinkInputSchema>;

export const resetPasswordInputSchema = z
  .object({
    newPassword: z
      .string()
      .min(6, "Password must be more than 5 characters")
      .max(72, "Password is too long"),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

type AuthResponse = User & { isLoggedIn: true };

export const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSession: builder.query<Session, void>({
      query: () => "/login-status",
      providesTags: ["Session"],
    }),

    login: builder.mutation<AuthResponse, LoginInput>({
      query: ({ identifier, password }) => ({
        url: "/login",
        method: "POST",
        // Both fields carry the same value; the API tries each in turn.
        body: { username: identifier, email: identifier, password },
      }),
      // The cart travels with the session, so it is stale the moment a
      // different person signs in.
      invalidatesTags: ["Session", "Cart", "Order"],
    }),

    register: builder.mutation<AuthResponse, RegisterInput>({
      query: (body) => ({ url: "/sign-up", method: "POST", body }),
      invalidatesTags: ["Session", "Cart", "Order"],
    }),

    logout: builder.mutation<{ message: string }, void>({
      query: () => ({ url: "/logout", method: "POST" }),
      invalidatesTags: ["Session", "Cart", "Order", "AdminProduct", "User"],
    }),

    sendResetLink: builder.mutation<{ message: string }, ResetLinkInput>({
      query: (body) => ({ url: "/reset-password", method: "POST", body }),
    }),

    resetPassword: builder.mutation<
      { message: string },
      { resetToken: string; newPassword: string }
    >({
      query: ({ resetToken, newPassword }) => ({
        url: `/reset-password/${resetToken}`,
        method: "POST",
        body: { newPassword },
      }),
    }),
  }),
});

export const {
  useGetSessionQuery,
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useSendResetLinkMutation,
  useResetPasswordMutation,
} = authApi;
