import type { Executor } from "../../platform/db/client";
import { ticketCategories } from "./schema";

/**
 * The categories a new installation starts with, so the first customer can
 * open a ticket before anyone has visited the settings. Added only to an
 * empty table: once staff have their own list (categories are switched off,
 * never deleted), a release never adds these back.
 */
const DEFAULT_CATEGORIES = [
  { nameFa: "مشکل اتصال", nameEn: "Connection problem", sortOrder: 10 },
  { nameFa: "پرداخت و تمدید", nameEn: "Payment and renewal", sortOrder: 20 },
  { nameFa: "سؤال پیش از خرید", nameEn: "Before buying", sortOrder: 30 },
  { nameFa: "سایر", nameEn: "Other", sortOrder: 90 },
];

export const seedTicketCategories = async (executor: Executor) => {
  const [existing] = await executor.select({ id: ticketCategories.id }).from(ticketCategories).limit(1);
  if (!existing) await executor.insert(ticketCategories).values(DEFAULT_CATEGORIES);
};
