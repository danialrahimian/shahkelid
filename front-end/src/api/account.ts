import type {
  PasswordSignInInput,
  RequestCodeInput,
  ResetPasswordInput,
  SecondFactorInput,
  SessionView,
  SetPasswordInput,
  VerifyCodeInput,
} from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/**
 * The account endpoints of the new API (/api/v1/auth).
 *
 * Input schemas come from @shah-kelid/contracts, the same ones the server
 * validates with, so a form cannot accept what the server will refuse.
 *
 * Every endpoint name starts with "account": the shared client leaves their
 * 401s to the sign-in screen instead of redirecting (see api-client.ts).
 *
 * Signing in answers with where the session now stands, and that answer is
 * written straight into the session cache: the screen moves on without a
 * second request, and every other screen sees the change at once.
 */

const AUTH = "/api/v1/auth";

export type TwoFactorSetup = { secret: string; otpauthUri: string };
export type TwoFactorEnabled = { recoveryCodes: string[]; session: SessionView };

export const accountApi = api.injectEndpoints({
  endpoints: (builder) => ({
    accountSession: builder.query<SessionView, void>({
      query: () => `${AUTH}/session`,
      providesTags: ["AccountSession"],
    }),

    accountRequestCode: builder.mutation<void, RequestCodeInput>({
      query: (body) => ({ url: `${AUTH}/code`, method: "POST", body }),
    }),

    accountVerifyCode: builder.mutation<SessionView, VerifyCodeInput>({
      query: (body) => ({ url: `${AUTH}/code/verify`, method: "POST", body }),
      onQueryStarted: (_input, { dispatch, queryFulfilled }) =>
        storeSession(dispatch, queryFulfilled),
    }),

    accountPasswordSignIn: builder.mutation<SessionView, PasswordSignInInput>({
      query: (body) => ({ url: `${AUTH}/password`, method: "POST", body }),
      onQueryStarted: (_input, { dispatch, queryFulfilled }) =>
        storeSession(dispatch, queryFulfilled),
    }),

    accountForgotPassword: builder.mutation<void, RequestCodeInput>({
      query: (body) => ({ url: `${AUTH}/password/forgot`, method: "POST", body }),
    }),

    accountResetPassword: builder.mutation<void, ResetPasswordInput>({
      query: (body) => ({ url: `${AUTH}/password/reset`, method: "POST", body }),
    }),

    accountSetPassword: builder.mutation<void, SetPasswordInput>({
      query: (body) => ({ url: `${AUTH}/password`, method: "PUT", body }),
      invalidatesTags: ["AccountSession"],
    }),

    accountSignOut: builder.mutation<void, void>({
      query: () => ({ url: `${AUTH}/sign-out`, method: "POST" }),
      onQueryStarted: (_input, { dispatch, queryFulfilled }) =>
        storeSession(
          dispatch,
          queryFulfilled.then(() => ({ data: { status: "signed_out" } as SessionView })),
        ),
    }),

    accountTwoFactorSetup: builder.mutation<TwoFactorSetup, void>({
      query: () => ({ url: `${AUTH}/two-factor/setup`, method: "POST" }),
    }),

    /**
     * Deliberately does not update the session cache. Its answer carries the
     * recovery codes, which must be shown before anything moves on; the
     * screen stores the session once they have been saved.
     */
    accountTwoFactorEnable: builder.mutation<TwoFactorEnabled, SecondFactorInput>({
      query: (body) => ({ url: `${AUTH}/two-factor/enable`, method: "POST", body }),
    }),

    accountTwoFactorVerify: builder.mutation<SessionView, SecondFactorInput>({
      query: (body) => ({ url: `${AUTH}/two-factor/verify`, method: "POST", body }),
      onQueryStarted: (_input, { dispatch, queryFulfilled }) =>
        storeSession(dispatch, queryFulfilled),
    }),
  }),
});

/** Writes a session answer into the cache; a failed request changes nothing. */
async function storeSession(
  dispatch: (action: unknown) => unknown,
  answer: Promise<{ data: SessionView }>,
) {
  try {
    const { data } = await answer;
    dispatch(setAccountSession(data));
  } catch {
    // The mutation's own caller shows the error.
  }
}

export const setAccountSession = (session: SessionView) =>
  accountApi.util.upsertQueryData("accountSession", undefined, session);

export const {
  useAccountSessionQuery,
  useAccountRequestCodeMutation,
  useAccountVerifyCodeMutation,
  useAccountPasswordSignInMutation,
  useAccountForgotPasswordMutation,
  useAccountResetPasswordMutation,
  useAccountSetPasswordMutation,
  useAccountSignOutMutation,
  useAccountTwoFactorSetupMutation,
  useAccountTwoFactorEnableMutation,
  useAccountTwoFactorVerifyMutation,
} = accountApi;
