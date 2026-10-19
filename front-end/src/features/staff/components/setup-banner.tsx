import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { useStaffSettingsQuery } from "@/api/settings";
import { paths } from "@/config/paths";

/**
 * What still needs doing before the shop works, at the top of every staff
 * page, for those who may change the settings: a fresh install has no mail
 * (so no customer can sign in), and a backup that failed must not go
 * unnoticed. Gone once it is fixed; not shown on the settings page itself.
 */
export const SetupBanner = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data } = useStaffSettingsQuery();
  if (!data || pathname.startsWith(paths.staffSettings.getHref())) return null;

  const notes: { text: string; anchor: string }[] = [];
  if (!data.mail.host || !data.mail.user) notes.push({ text: t("staff.settings.banner.mail"), anchor: "mail" });
  const status = data.backups.status;
  if (status?.lastRunAt && !status.ok) notes.push({ text: t("staff.settings.banner.backup"), anchor: "backups" });
  if (notes.length === 0) return null;

  return (
    <div role="status" className="mb-6 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      {notes.map((note) => (
        <p key={note.anchor} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>{note.text}</span>
          <Link to={`${paths.staffSettings.getHref()}#${note.anchor}`} className="font-medium underline underline-offset-4">
            {t("staff.settings.banner.fix")}
          </Link>
        </p>
      ))}
    </div>
  );
};
