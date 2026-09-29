import { z } from "zod";

/**
 * Panels, locations, servers and plans: what staff define before anything
 * can be sold. Shared by the staff forms and the API that checks them.
 */

const name = z.string().trim().min(1, "REQUIRED").max(80, "TOO_LONG");

/** http(s) only, and without a trailing slash, so paths can be appended. */
const baseUrl = z
  .string()
  .trim()
  .min(1, "REQUIRED")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL_INVALID")
  .transform((value) => value.replace(/\/+$/, ""));

const wholeNumber = (min: number, max: number) =>
  z
    .number({ invalid_type_error: "REQUIRED" })
    .int("NUMBER_OUT_OF_RANGE")
    .min(min, "NUMBER_OUT_OF_RANGE")
    .max(max, "NUMBER_OUT_OF_RANGE");

const id = z.string().uuid("REQUIRED");

// ------------------------------------------------------------------- panels

/** Drivers with an implementation. The database knows more, for later. */
export const PANEL_DRIVERS = ["pasarguard"] as const;
export type PanelDriverName = (typeof PANEL_DRIVERS)[number];

/**
 * How we sign in to a panel. An API key is preferred (it can be limited and
 * revoked); a panel account works too, for panels where the account we were
 * given cannot make keys.
 */
export const panelCredentialsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("password"),
    username: z.string().trim().min(1, "REQUIRED").max(200, "TOO_LONG"),
    password: z.string().min(1, "REQUIRED").max(500, "TOO_LONG"),
  }),
  z.object({
    kind: z.literal("api_key"),
    apiKey: z.string().trim().min(1, "REQUIRED").max(500, "TOO_LONG"),
  }),
]);
export type PanelCredentials = z.infer<typeof panelCredentialsSchema>;

export const panelInput = z.object({
  name,
  driver: z.enum(PANEL_DRIVERS),
  baseUrl,
  /** Our own address for customers' links, e.g. https://sub.example.com. Empty: the API's address. */
  subscriptionBaseUrl: z
    .union([z.literal(""), baseUrl])
    .nullish()
    .transform((value) => value || null),
  credentials: panelCredentialsSchema,
  isActive: z.boolean().default(true),
});
export type PanelInput = z.input<typeof panelInput>;

/** Editing: the credentials are only replaced when new ones are given. */
export const panelUpdateInput = panelInput.extend({
  credentials: panelCredentialsSchema.optional(),
});
export type PanelUpdateInput = z.input<typeof panelUpdateInput>;

export type PanelView = {
  id: string;
  name: string;
  driver: PanelDriverName;
  baseUrl: string;
  subscriptionBaseUrl: string | null;
  /** Never the secret itself: only how we sign in, and as whom. */
  credentials: { kind: "password"; username: string } | { kind: "api_key" };
  version: string | null;
  isActive: boolean;
  lastOkAt: string | null;
  lastError: string | null;
};

export type PanelGroup = { id: number; name: string };

// ---------------------------------------------------------------- locations

export const locationInput = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}(-[A-Z0-9]+)?$/, "LOCATION_CODE_INVALID")),
  nameFa: name,
  nameEn: name,
  sortOrder: wholeNumber(-1000, 1000).default(0),
  isActive: z.boolean().default(true),
});
export type LocationInput = z.input<typeof locationInput>;

export type LocationView = {
  id: string;
  code: string;
  nameFa: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
};

// ------------------------------------------------------------------ servers

export const SERVER_STATUSES = ["online", "degraded", "offline", "maintenance"] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export const serverInput = z.object({
  panelId: id,
  locationId: id,
  name,
  host: z.string().trim().min(1, "REQUIRED").max(253, "TOO_LONG"),
  /** The panel group that gives access to this server. */
  panelGroupId: wholeNumber(1, 2_147_483_647),
  capacityUsers: wholeNumber(1, 100_000),
  priority: wholeNumber(-100, 100).default(0),
  acceptingNew: z.boolean().default(true),
  status: z.enum(SERVER_STATUSES).default("online"),
});
export type ServerInput = z.input<typeof serverInput>;

export type ServerView = {
  id: string;
  panelId: string;
  panelName: string;
  locationId: string;
  locationName: string;
  name: string;
  host: string;
  panelGroupId: number | null;
  capacityUsers: number;
  priority: number;
  acceptingNew: boolean;
  status: ServerStatus;
  /** Subscriptions placed on it that still hold a place. */
  liveSubscriptions: number;
  archivedAt: string | null;
};

// -------------------------------------------------------------------- plans

export const TRAFFIC_RESETS = ["no_reset", "daily", "weekly", "monthly"] as const;
export type TrafficReset = (typeof TRAFFIC_RESETS)[number];

export const planInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "SLUG_INVALID")
    .max(60, "TOO_LONG"),
  name,
  description: z.string().trim().max(2000, "TOO_LONG").default(""),
  /** In gigabytes (binary); null is unlimited. */
  dataLimitGb: z
    .number({ invalid_type_error: "REQUIRED" })
    .positive("NUMBER_OUT_OF_RANGE")
    .max(1_000_000, "NUMBER_OUT_OF_RANGE")
    .nullable(),
  durationDays: wholeNumber(1, 3650),
  /** How many devices may use it at once; null is no limit. */
  deviceLimit: wholeNumber(1, 100).nullable(),
  trafficReset: z.enum(TRAFFIC_RESETS).default("no_reset"),
  priceToman: wholeNumber(0, 1_000_000_000),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: wholeNumber(-1000, 1000).default(0),
  /** The panels it is sold on, and the extra panel groups it grants on each. */
  panels: z
    .array(z.object({ panelId: id, groupIds: z.array(wholeNumber(1, 2_147_483_647)).max(50) }))
    .min(1, "GROUPS_REQUIRED"),
});
export type PlanInput = z.input<typeof planInput>;

export type PlanView = {
  id: string;
  slug: string;
  name: string;
  description: string;
  dataLimitBytes: number | null;
  durationDays: number;
  deviceLimit: number | null;
  trafficReset: TrafficReset;
  priceToman: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  archivedAt: string | null;
  panels: { panelId: string; panelName: string; groupIds: number[] }[];
};
