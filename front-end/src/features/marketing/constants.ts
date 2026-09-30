import { BellRing, Clock3, RefreshCw, Zap, type LucideIcon } from "lucide-react";

/**
 * What the landing page is built from. The words are in the locale files
 * (marketing.*); this says which pieces there are, in what order, with which
 * icon. Only what is true of the service is claimed: no user counts or
 * server numbers the shop cannot stand behind.
 */

export const FACTS = ["start", "pay", "link", "support"] as const;

export const FEATURES: { key: "instant" | "fair" | "renew" | "remind"; icon: LucideIcon }[] = [
  { key: "instant", icon: Zap },
  { key: "fair", icon: Clock3 },
  { key: "renew", icon: RefreshCw },
  { key: "remind", icon: BellRing },
];

export const FAQS = ["start", "pay", "renew", "devices", "help"] as const;
