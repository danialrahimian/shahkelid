import {
  BACKUP_INTERVALS,
  mailFromSchema,
  TELEGRAM_TOKEN_PATTERN,
  toLatinDigits,
  TRON_ADDRESS_PATTERN,
  type BackupStatusView,
  type SettingsSection,
  type SettingsSource,
  type SettingsView,
} from "@shah-kelid/contracts";
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z, type ZodType } from "zod";

import {
  useStaffCheckS3Mutation,
  useStaffResetSettingsMutation,
  useStaffRunBackupMutation,
  useStaffSaveSettingsMutation,
  useStaffSettingsQuery,
  useStaffTelegramChatsMutation,
  useStaffTelegramSendTestMutation,
  useStaffTestMailMutation,
  useStaffTestTelegramMutation,
  useStaffVerifyMailMutation,
} from "@/api/settings";
import { Form } from "@/components/ui/form/form";
import { errorText } from "@/lib/error-text";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { showSaveError } from "../form-errors";
import { CheckField, FormActions, SelectField, TextField } from "./fields";
import { Button, ConfirmButton, PageHeader, Placeholder } from "./staff-ui";

/**
 * /staff/settings: what the installer no longer asks. Mail, Telegram, the
 * payment accounts and backups, each saved here and tried for real from
 * here: a code by mail that comes back, a Telegram message, the bucket
 * answering, a backup now.
 *
 * Secrets are never shown again once saved; their field reads "saved", and
 * left empty it keeps what is saved.
 */

type Tone = "ok" | "warn" | "off";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  off: "bg-muted text-muted-foreground",
};

const Pill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[tone])}>
    {children}
  </span>
);

/** One section of the page: its state up front, then what can be done. */
const Card = ({
  id,
  title,
  description,
  tone,
  state,
  source,
  children,
}: {
  id: string;
  title: string;
  description: string;
  tone: Tone;
  state: string;
  source: SettingsSource;
  children: React.ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-5 rounded-lg border bg-card p-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            {title}
          </h2>
          <Pill tone={tone}>{state}</Pill>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        {source === "env" ? <p className="text-xs leading-5 text-muted-foreground">{t("staff.settings.fromEnv")}</p> : null}
      </header>
      {children}
    </section>
  );
};

/** What a test found, in the provider's own words when it failed. */
const Outcome = ({ ok, children, detail }: { ok: boolean; children: React.ReactNode; detail?: string | null }) => (
  <div
    role="status"
    className={cn(
      "space-y-1 rounded-md border px-3 py-2 text-sm",
      ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5",
    )}
  >
    <p className="font-medium">{children}</p>
    {detail ? (
      <p dir="ltr" className="font-mono text-xs break-words text-muted-foreground">
        {detail}
      </p>
    ) : null}
  </div>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-semibold">{children}</h3>
);

const useSave = () => {
  const { t } = useTranslation();
  const [save, state] = useStaffSaveSettingsMutation();
  const run = async <T extends Record<string, unknown>>(
    request: Parameters<typeof save>[0],
    methods: UseFormReturn<T>,
    rename: Record<string, string> = {},
  ) => {
    try {
      await save(request).unwrap();
      toast.success(t("staff.common.saved"));
      return true;
    } catch (error) {
      showSaveError(error, methods as UseFormReturn<Record<string, unknown>>, rename as Record<string, never>);
      return false;
    }
  };
  return [run, state] as const;
};

const ResetButton = ({ section, source }: { section: SettingsSection; source: SettingsSource }) => {
  const { t } = useTranslation();
  const [reset, { isLoading }] = useStaffResetSettingsMutation();
  if (source !== "panel") return null;
  return (
    <ConfirmButton
      label={t("staff.settings.turnOff")}
      question={t("staff.settings.turnOffQuestion")}
      disabled={isLoading}
      onConfirm={() =>
        void reset(section)
          .unwrap()
          .then(() => toast.success(t("staff.settings.turnedOff")))
          .catch((error: unknown) => toast.error(errorText(error)))
      }
    />
  );
};

const isPort = (value: string) => {
  const port = Number(toLatinDigits(value).trim());
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
};

const chatList = (value: string) =>
  toLatinDigits(value)
    .split(/[\s,،]+/)
    .map((id) => id.trim())
    .filter(Boolean);
const chatIdsField = z.string().refine((value) => chatList(value).every((id) => /^-?\d{1,20}$/.test(id)), "CHAT_ID_INVALID");

// --------------------------------------------------------------------- mail

const mailForm = z.object({
  host: z.string().trim().regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/, "HOST_INVALID"),
  port: z.string().refine(isPort, "PORT_INVALID"),
  user: z.string().trim().min(1, "REQUIRED"),
  password: z.string(),
  from: mailFromSchema,
});
type MailForm = z.infer<typeof mailForm>;

export const MailCard = ({ view }: { view: SettingsView["mail"] }) => {
  const { t } = useTranslation();
  const [save, saving] = useSave();
  const [test, testing] = useStaffTestMailMutation();
  const [verify, verifying] = useStaffVerifyMailMutation();
  const [result, setResult] = React.useState<{ sent: boolean; to: string; detail: string | null }>();
  const [to, setTo] = React.useState("");
  const [code, setCode] = React.useState("");
  const ids = { to: React.useId(), code: React.useId() };
  const configured = Boolean(view.host && view.user);

  const tone: Tone = view.verifiedAt ? "ok" : configured ? "warn" : "off";
  const state = view.verifiedAt
    ? t("staff.settings.mail.verified", { when: formatDateTime(view.verifiedAt) })
    : configured
      ? t("staff.settings.mail.untested")
      : t("staff.settings.mail.off");

  return (
    <Card id="mail" title={t("staff.settings.mail.title")} description={t("staff.settings.mail.description")} tone={tone} state={state} source={view.source}>
      <Form<MailForm>
        schema={mailForm as ZodType<MailForm>}
        options={{
          defaultValues: {
            host: view.host,
            port: String(view.port || 587),
            user: view.user,
            password: "",
            from: view.from || t("staff.settings.mail.fromExample"),
          },
        }}
        onSubmit={async (values, methods) => {
          if (await save({ section: "mail", body: values }, methods)) {
            methods.resetField("password");
            setResult(undefined);
          }
        }}
      >
        {() => (
          <>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <TextField<MailForm> name="host" label={t("staff.settings.mail.host")} placeholder="smtp-relay.brevo.com" dir="ltr" autoCapitalize="none" />
              <TextField<MailForm> name="port" label={t("staff.settings.mail.port")} inputMode="numeric" dir="ltr" hint={t("staff.settings.mail.portHint")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField<MailForm> name="user" label={t("staff.settings.mail.user")} dir="ltr" autoCapitalize="none" autoComplete="off" />
              <TextField<MailForm>
                name="password"
                label={t("staff.settings.mail.password")}
                type="password"
                dir="ltr"
                autoComplete="new-password"
                hint={view.hasPassword ? t("staff.settings.secretSaved") : undefined}
              />
            </div>
            <TextField<MailForm> name="from" label={t("staff.settings.mail.from")} hint={t("staff.settings.mail.fromHint")} />
            <FormActions>
              <Button type="submit" tone="primary" busy={saving.isLoading}>
                {t("staff.common.save")}
              </Button>
              <ResetButton section="mail" source={view.source} />
            </FormActions>
          </>
        )}
      </Form>

      {configured ? (
        <div className="space-y-3 border-t pt-4">
          <SubHeading>{t("staff.settings.mail.testTitle")}</SubHeading>
          <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.mail.testDescription")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1.5">
              <label htmlFor={ids.to} className="text-sm font-medium">
                {t("staff.settings.mail.testTo")}
              </label>
              <input
                id={ids.to}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder={t("staff.settings.mail.testToPlaceholder")}
                dir="ltr"
                inputMode="email"
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
            <Button
              busy={testing.isLoading}
              onClick={() =>
                test({ to: to.trim() })
                  .unwrap()
                  .then(setResult)
                  .catch((error: unknown) => toast.error(errorText(error)))
              }
            >
              {t("staff.settings.mail.sendTest")}
            </Button>
          </div>
          {result ? (
            result.sent ? (
              <div className="space-y-3">
                <Outcome ok>{t("staff.settings.mail.sent", { to: result.to })}</Outcome>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40 space-y-1.5">
                    <label htmlFor={ids.code} className="text-sm font-medium">
                      {t("staff.settings.mail.code")}
                    </label>
                    <input
                      id={ids.code}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      dir="ltr"
                      className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-center font-mono tracking-widest shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                  </div>
                  <Button
                    tone="primary"
                    busy={verifying.isLoading}
                    onClick={() =>
                      verify({ code })
                        .unwrap()
                        .then(() => {
                          toast.success(t("staff.settings.mail.confirmed"));
                          setResult(undefined);
                          setCode("");
                        })
                        .catch((error: unknown) => toast.error(errorText(error)))
                    }
                  >
                    {t("staff.settings.mail.confirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <Outcome ok={false} detail={result.detail}>
                {t("staff.settings.mail.failed")}
              </Outcome>
            )
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

// ----------------------------------------------------------------- telegram

const telegramForm = z.object({
  botToken: z.union([z.literal(""), z.string().trim().regex(TELEGRAM_TOKEN_PATTERN, "TELEGRAM_TOKEN_INVALID")]),
  chatIds: chatIdsField,
});
type TelegramForm = z.infer<typeof telegramForm>;

export const TelegramCard = ({ view }: { view: SettingsView["telegram"] }) => {
  const { t } = useTranslation();
  const [save, saving] = useSave();
  const [check, checking] = useStaffTestTelegramMutation();
  const [findChats, finding] = useStaffTelegramChatsMutation();
  const [sendTest, sending] = useStaffTelegramSendTestMutation();
  const [outcome, setOutcome] = React.useState<{ ok: boolean; text: string; detail: string | null }>();
  const [chats, setChats] = React.useState<{ id: string; title: string }[]>();

  const tone: Tone = view.hasToken && view.chatIds.length > 0 ? "ok" : view.hasToken ? "warn" : "off";
  const state =
    tone === "ok"
      ? t("staff.settings.telegram.on", { amount: view.chatIds.length })
      : tone === "warn"
        ? t("staff.settings.telegram.noChats")
        : t("staff.settings.telegram.off");
  const failed = (error: unknown) => toast.error(errorText(error));

  return (
    <Card
      id="telegram"
      title={t("staff.settings.telegram.title")}
      description={t("staff.settings.telegram.description")}
      tone={tone}
      state={state}
      source={view.source}
    >
      <Form<TelegramForm>
        schema={telegramForm as ZodType<TelegramForm>}
        options={{ defaultValues: { botToken: "", chatIds: view.chatIds.join(", ") } }}
        onSubmit={async (values, methods) => {
          const ok = await save(
            { section: "telegram", body: { botToken: values.botToken, chatIds: chatList(values.chatIds) } },
            methods,
            { "chatIds.0": "chatIds", "chatIds.1": "chatIds", "chatIds.2": "chatIds" },
          );
          if (ok) methods.resetField("botToken");
        }}
      >
        {(methods) => (
          <>
            <TextField<TelegramForm>
              name="botToken"
              label={t("staff.settings.telegram.token")}
              type="password"
              dir="ltr"
              autoComplete="off"
              placeholder="123456789:AAE…"
              hint={view.hasToken ? t("staff.settings.secretSaved") : t("staff.settings.telegram.tokenHint")}
            />
            <TextField<TelegramForm>
              name="chatIds"
              label={t("staff.settings.telegram.chats")}
              dir="ltr"
              placeholder="123456789, -1001234567890"
              hint={t("staff.settings.telegram.chatsHint")}
            />
            {chats ? (
              chats.length === 0 ? (
                <Outcome ok={false}>{t("staff.settings.telegram.noneFound")}</Outcome>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {chats.map((chat) => {
                    const current = chatList(methods.watch("chatIds"));
                    const added = current.includes(chat.id);
                    return (
                      <li key={chat.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>
                          {chat.title}{" "}
                          <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
                            {chat.id}
                          </bdi>
                        </span>
                        <Button
                          disabled={added}
                          onClick={() => methods.setValue("chatIds", [...current, chat.id].join(", "), { shouldDirty: true })}
                        >
                          {added ? t("staff.settings.telegram.added") : t("staff.settings.telegram.add")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
            <FormActions>
              <Button type="submit" tone="primary" busy={saving.isLoading}>
                {t("staff.common.save")}
              </Button>
              <ResetButton section="telegram" source={view.source} />
            </FormActions>
          </>
        )}
      </Form>

      {view.hasToken ? (
        <div className="space-y-3 border-t pt-4">
          <SubHeading>{t("staff.settings.telegram.testTitle")}</SubHeading>
          <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.telegram.testDescription")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              busy={checking.isLoading}
              onClick={() =>
                check()
                  .unwrap()
                  .then((bot) =>
                    setOutcome({
                      ok: bot.ok,
                      text: bot.ok ? t("staff.settings.telegram.botOk", { name: bot.username ?? "" }) : t("staff.settings.telegram.botFailed"),
                      detail: bot.detail,
                    }),
                  )
                  .catch(failed)
              }
            >
              {t("staff.settings.telegram.check")}
            </Button>
            <Button
              busy={finding.isLoading}
              onClick={() =>
                findChats()
                  .unwrap()
                  .then((found) => {
                    if (!found.ok) setOutcome({ ok: false, text: t("staff.settings.telegram.botFailed"), detail: found.detail });
                    setChats(found.chats);
                  })
                  .catch(failed)
              }
            >
              {t("staff.settings.telegram.find")}
            </Button>
            <Button
              busy={sending.isLoading}
              disabled={view.chatIds.length === 0}
              onClick={() =>
                sendTest()
                  .unwrap()
                  .then((sent) =>
                    setOutcome({
                      ok: sent.failed.length === 0,
                      text:
                        sent.failed.length === 0
                          ? t("staff.settings.telegram.sent", { amount: sent.sent })
                          : t("staff.settings.telegram.sendFailed", { chats: sent.failed.join("، ") }),
                      detail: sent.detail,
                    }),
                  )
                  .catch(failed)
              }
            >
              {t("staff.settings.telegram.sendTest")}
            </Button>
          </div>
          {outcome ? (
            <Outcome ok={outcome.ok} detail={outcome.detail}>
              {outcome.text}
            </Outcome>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

// ----------------------------------------------------------------- payments

const zarinpalForm = z.object({
  merchantId: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "MERCHANT_ID_INVALID"),
  sandbox: z.boolean(),
});
type ZarinpalForm = z.infer<typeof zarinpalForm>;

const tronForm = z.object({
  address: z.string().trim().regex(TRON_ADDRESS_PATTERN, "TRON_ADDRESS_INVALID"),
  tronGridApiKey: z.string(),
});
type TronForm = z.infer<typeof tronForm>;

const nowpaymentsForm = z.object({ apiKey: z.string(), ipnSecret: z.string(), sandbox: z.boolean() });
type NowpaymentsForm = z.infer<typeof nowpaymentsForm>;

export const PaymentsCard = ({ view }: { view: SettingsView }) => {
  const { t } = useTranslation();
  const [save, saving] = useSave();
  const methods = [
    view.zarinpal.merchantId ? t("staff.settings.payments.zarinpal") : null,
    view.tron.address ? t("staff.settings.payments.tron") : null,
    view.nowpayments.hasApiKey ? "NOWPayments" : null,
  ].filter(Boolean);
  const tone: Tone = methods.length > 0 ? "ok" : "off";

  return (
    <Card
      id="payments"
      title={t("staff.settings.payments.title")}
      description={t("staff.settings.payments.description")}
      tone={tone}
      state={methods.length > 0 ? methods.join("، ") : t("staff.settings.payments.off")}
      source={view.zarinpal.source === "panel" || view.tron.source === "panel" || view.nowpayments.source === "panel" ? "panel" : view.zarinpal.source}
    >
      <div className="space-y-4">
        <SubHeading>{t("staff.settings.payments.zarinpal")}</SubHeading>
        <Form<ZarinpalForm>
          schema={zarinpalForm as ZodType<ZarinpalForm>}
          options={{ defaultValues: { merchantId: view.zarinpal.merchantId, sandbox: view.zarinpal.sandbox } }}
          onSubmit={(values, form) => void save({ section: "zarinpal", body: values }, form)}
        >
          {() => (
            <>
              <TextField<ZarinpalForm>
                name="merchantId"
                label={t("staff.settings.payments.merchantId")}
                dir="ltr"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                hint={t("staff.settings.payments.merchantHint")}
              />
              <CheckField<ZarinpalForm> name="sandbox" label={t("staff.settings.payments.sandbox")} />
              <FormActions>
                <Button type="submit" tone="primary" busy={saving.isLoading}>
                  {t("staff.common.save")}
                </Button>
                <ResetButton section="zarinpal" source={view.zarinpal.source} />
              </FormActions>
            </>
          )}
        </Form>
      </div>

      <div className="space-y-4 border-t pt-4">
        <SubHeading>{t("staff.settings.payments.tron")}</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.payments.tronDescription")}</p>
        <Form<TronForm>
          schema={tronForm as ZodType<TronForm>}
          options={{ defaultValues: { address: view.tron.address, tronGridApiKey: "" } }}
          onSubmit={async (values, form) => {
            if (await save({ section: "tron", body: values }, form)) form.resetField("tronGridApiKey");
          }}
        >
          {() => (
            <>
              <TextField<TronForm> name="address" label={t("staff.settings.payments.address")} dir="ltr" placeholder="T…" />
              <TextField<TronForm>
                name="tronGridApiKey"
                label={t("staff.settings.payments.tronGridKey")}
                type="password"
                dir="ltr"
                autoComplete="off"
                hint={view.tron.hasApiKey ? t("staff.settings.secretSaved") : t("staff.settings.payments.tronGridHint")}
              />
              <FormActions>
                <Button type="submit" tone="primary" busy={saving.isLoading}>
                  {t("staff.common.save")}
                </Button>
                <ResetButton section="tron" source={view.tron.source} />
              </FormActions>
            </>
          )}
        </Form>
      </div>

      <div className="space-y-4 border-t pt-4">
        <SubHeading>NOWPayments</SubHeading>
        <Form<NowpaymentsForm>
          schema={nowpaymentsForm as ZodType<NowpaymentsForm>}
          options={{ defaultValues: { apiKey: "", ipnSecret: "", sandbox: view.nowpayments.sandbox } }}
          onSubmit={async (values, form) => {
            if (await save({ section: "nowpayments", body: values }, form)) {
              form.resetField("apiKey");
              form.resetField("ipnSecret");
            }
          }}
        >
          {() => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<NowpaymentsForm>
                  name="apiKey"
                  label={t("staff.settings.payments.apiKey")}
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  hint={view.nowpayments.hasApiKey ? t("staff.settings.secretSaved") : undefined}
                />
                <TextField<NowpaymentsForm>
                  name="ipnSecret"
                  label={t("staff.settings.payments.ipnSecret")}
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  hint={view.nowpayments.hasIpnSecret ? t("staff.settings.secretSaved") : undefined}
                />
              </div>
              <CheckField<NowpaymentsForm> name="sandbox" label={t("staff.settings.payments.sandbox")} />
              <FormActions>
                <Button type="submit" tone="primary" busy={saving.isLoading}>
                  {t("staff.common.save")}
                </Button>
                <ResetButton section="nowpayments" source={view.nowpayments.source} />
              </FormActions>
            </>
          )}
        </Form>
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------ backups

const backupForm = z
  .object({
    intervalHours: z.string(),
    s3Enabled: z.boolean(),
    endpoint: z.string().trim(),
    bucket: z.string().trim(),
    accessKeyId: z.string().trim(),
    secretAccessKey: z.string(),
    region: z.string().trim(),
    telegramEnabled: z.boolean(),
    telegramChatIds: chatIdsField,
  })
  .superRefine((value, context) => {
    if (!value.s3Enabled) return;
    if (!/^https?:\/\/\S+$/.test(value.endpoint)) context.addIssue({ code: "custom", path: ["endpoint"], message: "URL_INVALID" });
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[A-Za-z0-9._/-]+)?$/.test(value.bucket))
      context.addIssue({ code: "custom", path: ["bucket"], message: "BUCKET_INVALID" });
    if (!value.accessKeyId) context.addIssue({ code: "custom", path: ["accessKeyId"], message: "REQUIRED" });
  });
type BackupForm = z.infer<typeof backupForm>;

const Destination = ({ label, status }: { label: string; status: { ok: boolean; note: string | null } | null }) => {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span>{label}</span>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        {status?.note ? <span className="text-muted-foreground">{status.note}</span> : null}
        <Pill tone={!status ? "off" : status.ok ? "ok" : "warn"}>
          {!status ? t("staff.settings.backups.notUsed") : status.ok ? t("staff.settings.backups.ok") : t("staff.settings.backups.failed")}
        </Pill>
      </span>
    </li>
  );
};

const BackupStatus = ({ status }: { status: BackupStatusView | null }) => {
  const { t } = useTranslation();
  if (!status) return <Outcome ok={false}>{t("staff.settings.backups.noService")}</Outcome>;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {status.lastSuccessAt
          ? t("staff.settings.backups.lastSuccess", { when: formatDateTime(status.lastSuccessAt) })
          : t("staff.settings.backups.never")}
        {status.requested ? ` — ${t("staff.settings.backups.requested")}` : ""}
      </p>
      {status.message ? <p className="text-xs text-muted-foreground">{status.message}</p> : null}
      <ul className="divide-y rounded-md border text-sm">
        <Destination
          label={
            status.local.snapshots !== null
              ? t("staff.settings.backups.local", { amount: status.local.snapshots })
              : t("staff.settings.backups.localPlain")
          }
          status={status.lastRunAt ? status.local : null}
        />
        <Destination label="S3" status={status.s3} />
        <Destination label={t("staff.settings.backups.telegram")} status={status.telegram} />
      </ul>
    </div>
  );
};

export const BackupsCard = ({ view, telegramReady }: { view: SettingsView["backups"]; telegramReady: boolean }) => {
  const { t } = useTranslation();
  const [save, saving] = useSave();
  const [check, checking] = useStaffCheckS3Mutation();
  const [run, running] = useStaffRunBackupMutation();
  const [reach, setReach] = React.useState<{ reachable: boolean; detail: string }>();
  const status = view.status;
  const tone: Tone = !status || !status.lastRunAt ? "off" : status.ok ? "ok" : "warn";
  const state = !status
    ? t("staff.settings.backups.noServiceShort")
    : !status.lastRunAt
      ? t("staff.settings.backups.waiting")
      : status.ok
        ? t("staff.settings.backups.healthy")
        : t("staff.settings.backups.problem");

  return (
    <Card
      id="backups"
      title={t("staff.settings.backups.title")}
      description={t("staff.settings.backups.description")}
      tone={tone}
      state={state}
      source={view.source}
    >
      <BackupStatus status={status} />
      {status ? (
        <Button
          busy={running.isLoading}
          disabled={status.requested}
          onClick={() =>
            run()
              .unwrap()
              .then(() => toast.success(t("staff.settings.backups.started")))
              .catch((error: unknown) => toast.error(errorText(error)))
          }
        >
          {t("staff.settings.backups.runNow")}
        </Button>
      ) : null}

      <Form<BackupForm>
        schema={backupForm as unknown as ZodType<BackupForm>}
        options={{
          defaultValues: {
            intervalHours: String(view.intervalHours),
            s3Enabled: Boolean(view.s3),
            endpoint: view.s3?.endpoint ?? "",
            bucket: view.s3?.bucket ?? "",
            accessKeyId: view.s3?.accessKeyId ?? "",
            secretAccessKey: "",
            region: view.s3?.region ?? "auto",
            telegramEnabled: view.telegram.enabled,
            telegramChatIds: view.telegram.chatIds.join(", "),
          },
        }}
        onSubmit={async (values, methods) => {
          const ok = await save(
            {
              section: "backups",
              body: {
                intervalHours: Number(values.intervalHours),
                s3: values.s3Enabled
                  ? {
                      endpoint: values.endpoint,
                      bucket: values.bucket,
                      accessKeyId: values.accessKeyId,
                      secretAccessKey: values.secretAccessKey,
                      region: values.region || "auto",
                    }
                  : null,
                telegram: { enabled: values.telegramEnabled, chatIds: chatList(values.telegramChatIds) },
              },
            },
            methods,
            {
              "s3.endpoint": "endpoint",
              "s3.bucket": "bucket",
              "s3.accessKeyId": "accessKeyId",
              "s3.secretAccessKey": "secretAccessKey",
              "s3.region": "region",
              "telegram.chatIds.0": "telegramChatIds",
            },
          );
          if (ok) methods.resetField("secretAccessKey");
        }}
      >
        {(methods) => {
          const s3Enabled = methods.watch("s3Enabled");
          const telegramEnabled = methods.watch("telegramEnabled");
          return (
            <div className="space-y-4 border-t pt-4">
              <SelectField<BackupForm>
                name="intervalHours"
                label={t("staff.settings.backups.interval")}
                options={BACKUP_INTERVALS.map((hours) => ({ value: String(hours), label: t("staff.settings.backups.every", { amount: hours }) }))}
              />
              <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.backups.localAlways")}</p>

              <CheckField<BackupForm> name="s3Enabled" label={t("staff.settings.backups.s3Enable")} />
              {s3Enabled ? (
                <div className="space-y-4 rounded-md border p-4">
                  <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.backups.s3Description")}</p>
                  <TextField<BackupForm> name="endpoint" label="Endpoint" dir="ltr" placeholder="https://s3.us-west-004.backblazeb2.com" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField<BackupForm> name="bucket" label="Bucket" dir="ltr" />
                    <TextField<BackupForm> name="region" label="Region" dir="ltr" hint={t("staff.settings.backups.regionHint")} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField<BackupForm> name="accessKeyId" label="Key ID" dir="ltr" autoComplete="off" />
                    <TextField<BackupForm>
                      name="secretAccessKey"
                      label="Secret key"
                      type="password"
                      dir="ltr"
                      autoComplete="off"
                      hint={view.s3?.hasSecret ? t("staff.settings.secretSaved") : undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Button
                      busy={checking.isLoading}
                      onClick={() =>
                        check({ endpoint: methods.getValues("endpoint"), bucket: methods.getValues("bucket") })
                          .unwrap()
                          .then(setReach)
                          .catch((error: unknown) => toast.error(errorText(error)))
                      }
                    >
                      {t("staff.settings.backups.checkS3")}
                    </Button>
                    {reach ? (
                      <Outcome ok={reach.reachable} detail={reach.detail}>
                        {reach.reachable ? t("staff.settings.backups.reachable") : t("staff.settings.backups.unreachable")}
                      </Outcome>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <CheckField<BackupForm> name="telegramEnabled" label={t("staff.settings.backups.telegramEnable")} />
              {telegramEnabled ? (
                <div className="space-y-4 rounded-md border p-4">
                  <p className="text-sm leading-6 text-muted-foreground">{t("staff.settings.backups.telegramDescription")}</p>
                  {!telegramReady ? <Outcome ok={false}>{t("staff.settings.backups.telegramNeedsBot")}</Outcome> : null}
                  <TextField<BackupForm>
                    name="telegramChatIds"
                    label={t("staff.settings.telegram.chats")}
                    dir="ltr"
                    hint={t("staff.settings.backups.telegramChatsHint")}
                  />
                </div>
              ) : null}

              <FormActions>
                <Button type="submit" tone="primary" busy={saving.isLoading}>
                  {t("staff.common.save")}
                </Button>
              </FormActions>
            </div>
          );
        }}
      </Form>
    </Card>
  );
};

// --------------------------------------------------------------------- page

export const SettingsPage = () => {
  const { t } = useTranslation();
  const settings = useStaffSettingsQuery();

  return (
    <>
      <PageHeader title={t("staff.settings.title")} description={t("staff.settings.description")} />
      {settings.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !settings.data ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : (
        <div className="grid max-w-4xl gap-6">
          {/* Keyed by where the values come from: turned off, a form starts again from what is in force. */}
          <MailCard key={settings.data.mail.source} view={settings.data.mail} />
          <TelegramCard key={settings.data.telegram.source} view={settings.data.telegram} />
          <PaymentsCard
            key={[settings.data.zarinpal.source, settings.data.tron.source, settings.data.nowpayments.source].join()}
            view={settings.data}
          />
          <BackupsCard
            view={settings.data.backups}
            telegramReady={settings.data.telegram.hasToken && settings.data.telegram.chatIds.length > 0}
          />
        </div>
      )}
    </>
  );
};
