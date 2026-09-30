import type { NotificationTemplateView } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useStaffPreviewTemplateMutation,
  useStaffResetTemplateMutation,
  useStaffSaveTemplateMutation,
  useStaffTemplatesQuery,
} from "@/api/staff";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button, ConfirmButton, FormDialog, PageHeader, Placeholder } from "./staff-ui";

const fieldClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Editing one email: subject and text, the variables it may use (clicking
 * one puts it where the cursor is), a preview with sample values, and the
 * switch to stop sending it.
 */
const TemplateEditor = ({ template, onClose }: { template: NotificationTemplateView; onClose: () => void }) => {
  const { t } = useTranslation();
  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body);
  const [isActive, setIsActive] = React.useState(template.isActive);
  const [problem, setProblem] = React.useState<string>();
  const [preview, setPreview] = React.useState<{ subject: string; body: string }>();
  const [save, saving] = useStaffSaveTemplateMutation();
  const [render, rendering] = useStaffPreviewTemplateMutation();
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const ids = { subject: React.useId(), body: React.useId(), active: React.useId() };

  const insert = (variable: string) => {
    const field = bodyRef.current;
    const token = `{{${variable}}}`;
    if (!field) return setBody((text) => text + token);
    const { selectionStart, selectionEnd } = field;
    setBody((text) => text.slice(0, selectionStart) + token + text.slice(selectionEnd));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(selectionStart + token.length, selectionStart + token.length);
    });
  };

  const fail = (error: unknown) => {
    setProblem(errorText(error));
    if (!normalizeError(error).errors.some((entry) => entry.path)) toast.error(errorText(error));
  };

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t(`staff.notifications.keys.${template.key}`)}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={ids.subject} className="text-sm font-medium">
            {t("staff.notifications.subject")}
          </label>
          <input id={ids.subject} value={subject} onChange={(event) => setSubject(event.target.value)} className={cn(fieldClass, "h-10")} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.body} className="text-sm font-medium">
            {t("staff.notifications.body")}
          </label>
          <textarea
            id={ids.body}
            ref={bodyRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={9}
            className={cn(fieldClass, "leading-7")}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{t("staff.notifications.variables")}</p>
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insert(variable)}
                dir="ltr"
                className="rounded-full border px-2.5 py-0.5 font-mono text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
        </div>
        <label htmlFor={ids.active} className="flex items-center gap-2.5 text-sm">
          <input id={ids.active} type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="size-4 accent-primary" />
          {t("staff.notifications.active")}
        </label>

        {problem ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        ) : null}

        {preview ? (
          <section className="space-y-2 rounded-md border bg-muted/40 p-3" aria-label={t("staff.notifications.previewTitle")}>
            <p className="text-xs text-muted-foreground">{t("staff.notifications.previewTitle")}</p>
            <p className="font-medium">{preview.subject}</p>
            <p className="text-sm leading-7 whitespace-pre-line">{preview.body}</p>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button
            tone="primary"
            busy={saving.isLoading}
            onClick={() =>
              save({ key: template.key, body: { subject, body, isActive } })
                .unwrap()
                .then(() => {
                  toast.success(t("staff.notifications.saved"));
                  onClose();
                })
                .catch(fail)
            }
          >
            {t("staff.common.save")}
          </Button>
          <Button
            busy={rendering.isLoading}
            onClick={() =>
              render({ key: template.key, body: { subject, body, isActive } })
                .unwrap()
                .then((result) => {
                  setProblem(undefined);
                  setPreview(result);
                })
                .catch(fail)
            }
          >
            {t("staff.notifications.preview")}
          </Button>
          <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
};

const TemplateCard = ({ template, onEdit }: { template: NotificationTemplateView; onEdit: () => void }) => {
  const { t } = useTranslation();
  const [reset, { isLoading }] = useStaffResetTemplateMutation();
  return (
    <article className={cn("space-y-3 rounded-lg border bg-card p-4", !template.isActive && "opacity-70")}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t(`staff.notifications.keys.${template.key}`)}</h2>
        <span className="flex gap-1.5 text-xs">
          {!template.isActive ? <span className="rounded-full bg-muted px-2 py-0.5">{t("staff.notifications.off")}</span> : null}
          <span className={cn("rounded-full px-2 py-0.5", template.custom ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-muted")}>
            {template.custom ? t("staff.notifications.custom") : t("staff.notifications.builtIn")}
          </span>
        </span>
      </header>
      <p className="text-sm font-medium">{template.subject}</p>
      <p className="line-clamp-3 text-sm leading-6 whitespace-pre-line text-muted-foreground">{template.body}</p>
      {template.updatedAt ? <p className="text-xs text-muted-foreground">{formatDateTime(template.updatedAt)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onEdit}>{t("staff.notifications.edit")}</Button>
        {template.custom ? (
          <ConfirmButton
            label={t("staff.notifications.reset")}
            question={t("staff.notifications.resetConfirm")}
            disabled={isLoading}
            onConfirm={() => void reset(template.key).unwrap().catch((error: unknown) => toast.error(errorText(error)))}
          />
        ) : null}
      </div>
    </article>
  );
};

export const NotificationsPage = () => {
  const { t } = useTranslation();
  const templates = useStaffTemplatesQuery();
  const [editing, setEditing] = React.useState<NotificationTemplateView>();

  return (
    <>
      <PageHeader
        title={t("staff.notifications.title")}
        description={t("staff.notifications.description", { example: "{{plan_name}}" })}
      />
      {templates.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !templates.data ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.data.map((template) => (
            <TemplateCard key={template.key} template={template} onEdit={() => setEditing(template)} />
          ))}
        </div>
      )}
      {editing ? <TemplateEditor key={editing.key} template={editing} onClose={() => setEditing(undefined)} /> : null}
    </>
  );
};
