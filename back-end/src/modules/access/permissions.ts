/**
 * Every permission, defined in code next to the routes that check it.
 *
 * Roles are data (they can be created and edited), but what a permission
 * MEANS is code: a permission that no route checks does nothing, and one that
 * a route checks but nobody defined is a typo that would lock everyone out.
 * Keeping the list here, typed, makes both mistakes compile errors.
 *
 * Grouped by the milestone that starts checking them; a permission listed
 * before its screens exist simply grants nothing yet.
 */
export const PERMISSIONS = {
  // access (M2)
  "users:read": "View staff accounts and their roles",
  "users:manage_roles": "Give and take away roles",
  "audit:read": "Read the audit log",
  // catalogue and infrastructure (M3)
  "plans:manage": "Create and edit plans",
  "servers:manage": "Manage VPN panels, servers and locations",
  // sales (M4-M5)
  "orders:read": "View orders and payments",
  "payments:review": "Approve or reject card-transfer receipts and crypto transfers",
  "subscriptions:manage": "Retry, suspend and adjust customer subscriptions",
  // customers and support (M8-M9)
  "customers:read": "View customer profiles",
  "customers:manage": "Add notes and tags to customers",
  "tickets:reply": "Answer support tickets",
  // content and reports (M9)
  "content:manage": "Write and edit posts and pages",
  "analytics:read": "View sales reports",
  "settings:manage": "Change site settings",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (value: string): value is Permission => value in PERMISSIONS;

/**
 * The roles every installation starts with. They cannot be edited or
 * deleted: they are synced from here on every start, so an upgrade that adds
 * a permission to "support" reaches every deployment. Custom roles are for
 * anything else.
 */
export const SYSTEM_ROLES: Record<
  string,
  { name: string; description: string; permissions: readonly Permission[] }
> = {
  owner: {
    name: "مالک",
    description: "Everything, including other people's roles.",
    permissions: ALL_PERMISSIONS,
  },
  admin: {
    name: "مدیر",
    description: "Runs the store day to day. Cannot change roles.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "users:manage_roles"),
  },
  support: {
    name: "پشتیبان",
    description: "Answers customers and looks after their subscriptions.",
    permissions: [
      "customers:read",
      "customers:manage",
      "tickets:reply",
      "orders:read",
      "subscriptions:manage",
    ],
  },
  accountant: {
    name: "حسابدار",
    description: "Reviews payments and reads the numbers.",
    permissions: ["orders:read", "payments:review", "analytics:read", "customers:read"],
  },
  editor: {
    name: "ویراستار",
    description: "Writes the journal and the site's pages.",
    permissions: ["content:manage"],
  },
};
