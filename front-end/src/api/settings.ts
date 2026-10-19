import type {
  BackupSettingsInput,
  MailSettingsInput,
  MailTestView,
  NowpaymentsSettingsInput,
  S3CheckView,
  SettingsSection,
  SettingsView,
  TelegramBotView,
  TelegramChatsView,
  TelegramSendView,
  TelegramSettingsInput,
  TronSettingsInput,
  ZarinpalSettingsInput,
} from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/** The store's settings (/api/v1/staff/settings): mail, Telegram, payments, backups. */

const SETTINGS = "/api/v1/staff/settings";

type Inputs = {
  mail: MailSettingsInput;
  telegram: TelegramSettingsInput;
  zarinpal: ZarinpalSettingsInput;
  tron: TronSettingsInput;
  nowpayments: NowpaymentsSettingsInput;
  backups: BackupSettingsInput;
};

export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    staffSettings: builder.query<SettingsView, void>({
      query: () => SETTINGS,
      providesTags: ["StaffSettings"],
    }),
    staffSaveSettings: builder.mutation<SettingsView, { [S in keyof Inputs]: { section: S; body: Inputs[S] } }[keyof Inputs]>({
      query: ({ section, body }) => ({ url: `${SETTINGS}/${section}`, method: "PUT", body }),
      invalidatesTags: ["StaffSettings"],
    }),
    staffResetSettings: builder.mutation<SettingsView, SettingsSection>({
      query: (section) => ({ url: `${SETTINGS}/${section}`, method: "DELETE" }),
      invalidatesTags: ["StaffSettings"],
    }),
    staffTestMail: builder.mutation<MailTestView, { to: string }>({
      query: (body) => ({ url: `${SETTINGS}/mail/test`, method: "POST", body }),
    }),
    staffVerifyMail: builder.mutation<SettingsView, { code: string }>({
      query: (body) => ({ url: `${SETTINGS}/mail/verify`, method: "POST", body }),
      invalidatesTags: ["StaffSettings"],
    }),
    staffTestTelegram: builder.mutation<TelegramBotView, void>({
      query: () => ({ url: `${SETTINGS}/telegram/test`, method: "POST" }),
    }),
    staffTelegramChats: builder.mutation<TelegramChatsView, void>({
      query: () => ({ url: `${SETTINGS}/telegram/chats`, method: "POST" }),
    }),
    staffTelegramSendTest: builder.mutation<TelegramSendView, void>({
      query: () => ({ url: `${SETTINGS}/telegram/send-test`, method: "POST" }),
    }),
    staffCheckS3: builder.mutation<S3CheckView, { endpoint: string; bucket: string }>({
      query: (body) => ({ url: `${SETTINGS}/backups/check-s3`, method: "POST", body }),
    }),
    staffRunBackup: builder.mutation<SettingsView, void>({
      query: () => ({ url: `${SETTINGS}/backups/run`, method: "POST" }),
      invalidatesTags: ["StaffSettings"],
    }),
  }),
});

export const {
  useStaffSettingsQuery,
  useStaffSaveSettingsMutation,
  useStaffResetSettingsMutation,
  useStaffTestMailMutation,
  useStaffVerifyMailMutation,
  useStaffTestTelegramMutation,
  useStaffTelegramChatsMutation,
  useStaffTelegramSendTestMutation,
  useStaffCheckS3Mutation,
  useStaffRunBackupMutation,
} = settingsApi;
