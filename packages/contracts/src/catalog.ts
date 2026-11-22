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

// ------------------------------------------------------ subscription domains

/** A domain name (not an address, not a pattern): what is typed, a link pasted too. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const subscriptionDomainInput = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, ""))
    .pipe(z.string().min(1, "REQUIRED").regex(HOSTNAME, "DOMAIN_INVALID")),
});
export type SubscriptionDomainInput = z.input<typeof subscriptionDomainInput>;

export type SubscriptionDomainView = {
  domain: string;
  /** Customers' links are made on it. */
  isPrimary: boolean;
  createdAt: string;
};

export type SubscriptionDomainsView = {
  domains: SubscriptionDomainView[];
  /** Where links are made now: the primary domain, else the site's own address. */
  linkBase: string;
};

/** Whether a subscription domain reaches this server, and has its certificate. */
export type SubscriptionDomainCheck = { ok: boolean; error: string | null };

/** A group on a panel (PasarGuard: a set of inbounds), as our groups pick them. */
/**
 * A group on a panel. Its inbounds are known only where the panel account
 * may read them (a reseller account sees ids and names only).
 */
export type PanelGroup = { id: number; name: string; inboundTags?: string[] };

// ------------------------------------------------------------------- groups

/**
 * Our groups: what plans are sold with, and what a customer's link carries.
 *
 * A group takes groups from any of the connected panels (its sources), and
 * from each either all its hosts (configs) or the ones picked. Each host can
 * be shown under a name of our own, and the hosts, like the groups, are in
 * an order of our own (dragged into place).
 */
export const groupInput = z.object({ name });
export type GroupInput = z.input<typeof groupInput>;

export const groupSourcesInput = z.object({
  sources: z
    .array(
      z.object({
        panelId: id,
        panelGroupId: wholeNumber(1, 2_147_483_647),
        /** Every host of the panel group, now and later; false: only the hosts picked. */
        allHosts: z.boolean().default(true),
      }),
    )
    .max(100, "TOO_LONG"),
});
export type GroupSourcesInput = z.input<typeof groupSourcesInput>;

/** A host's name in our groups: PasarGuard's variables ({DATA_LEFT}, {DAYS_LEFT}…) work in it. */
export const hostNameSchema = z.string().trim().max(200, "TOO_LONG");

export const groupHostInput = z
  .object({
    selected: z.boolean().optional(),
    /** null or "": the panel's own remark. */
    name: hostNameSchema.nullable().optional(),
  })
  .refine((value) => value.selected !== undefined || value.name !== undefined, "REQUIRED");
export type GroupHostInput = z.input<typeof groupHostInput>;

/** A host is known by an id of ours, made from its config (see GroupHostView.hostId). */
export const hostIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "INVALID");
const hostRef = z.object({ panelId: id, hostId: hostIdSchema });
export const hostOrderInput = z.object({ hosts: z.array(hostRef).min(1, "REQUIRED").max(5000, "TOO_LONG") });
export type HostOrderInput = z.input<typeof hostOrderInput>;

export const groupOrderInput = z.object({ ids: z.array(id).min(1, "REQUIRED").max(1000, "TOO_LONG") });
export type GroupOrderInput = z.input<typeof groupOrderInput>;

export type GroupSourceView = {
  panelId: string;
  panelName: string;
  panelGroupId: number;
  /** As the panel last named it. */
  panelGroupName: string;
  allHosts: boolean;
};

export type GroupView = {
  id: string;
  name: string;
  sortOrder: number;
  sources: GroupSourceView[];
  /** The plans sold with it. */
  plans: { id: string; name: string }[];
  /** Live subscriptions that carry it. */
  subscriptions: number;
};

/** A host (one config) of a group's sources, with what our group says about it. */
export type GroupHostView = {
  panelId: string;
  panelName: string;
  /**
   * Ours, made from the config the panel gives (protocol, port, transport,
   * path and name): panels a reseller account uses do not show their hosts,
   * so the hosts are read from a subscription the shop keeps on each panel
   * group (a panel user named skprobe_g<id>).
   */
  hostId: string;
  /** The config's name as the panel gives it to that subscription. */
  remark: string;
  protocol: string | null;
  address: string | null;
  port: number | null;
  /** Its transport (ws, grpc, tcp…). */
  network: string | null;
  /** The panel groups (of this group's sources) it is in. */
  panelGroupIds: number[];
  /** Given to customers: picked, or in a source that takes all its hosts. */
  selected: boolean;
  /** In a source that takes all its hosts: it cannot be left out on its own. */
  forced: boolean;
  /** Our name for it; null: the panel's remark. */
  name: string | null;
};

export type GroupHostsView = {
  /** In our order: as dragged, then the rest in the panels' own order. */
  hosts: GroupHostView[];
  /** Panels that could not be read just now: their hosts are missing from the list. */
  unreachable: { panelId: string; panelName: string; error: string }[];
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
  /** Our groups it is sold with: the customer gets their configs, on their panels. */
  groupIds: z.array(id).min(1, "GROUPS_REQUIRED").max(50, "TOO_LONG"),
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
  groups: { id: string; name: string }[];
};
