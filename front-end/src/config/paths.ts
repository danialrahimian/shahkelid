/**
 * Every route in the application, in one place.
 *
 * Routes are declared as objects with a `path` (what the router registers) and
 * a `getHref` (what a link should point at), so a route that takes a parameter
 * cannot be linked to with the wrong shape. Renaming a URL is then a one-line
 * change here rather than a hunt through every `<Link to="...">`.
 */
export const paths = {
  home: {
    path: "/",
    getHref: () => "/",
  },

  pricing: {
    path: "/pricing",
    getHref: () => "/pricing",
  },

  /** The journal. */
  posts: {
    path: "/posts",
    getHref: () => "/posts",
  },

  post: {
    path: "/posts/:slug",
    getHref: (slug: string) => `/posts/${encodeURIComponent(slug)}`,
  },

  account: {
    path: "/account",
    getHref: () => "/account",
  },

  accountSignIn: {
    path: "/account/sign-in",
    // Where to go once signed in. Only paths on this site are honoured.
    getHref: (redirectTo?: string | null | undefined) =>
      `/account/sign-in${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""}`,
  },

  accountForgotPassword: {
    path: "/account/forgot-password",
    getHref: () => "/account/forgot-password",
  },

  /** Buying a plan: sign in if needed, choose how to pay, pay. */
  buy: {
    path: "/buy/:planId",
    getHref: (planId: string) => `/buy/${planId}`,
  },

  /** Renewing one of the buyer's services: choose the plan, then pay. */
  renew: {
    path: "/renew/:subscriptionId",
    getHref: (subscriptionId: string) => `/renew/${subscriptionId}`,
  },

  invoice: {
    path: "/orders/:orderId/invoice",
    getHref: (orderId: string) => `/orders/${orderId}/invoice`,
  },

  /** An order's page: where Zarinpal brings the buyer back, and where the link appears. */
  order: {
    path: "/orders/:orderId",
    getHref: (orderId: string) => `/orders/${orderId}`,
  },

  /** The customer's tickets. */
  support: {
    path: "/support",
    getHref: () => "/support",
  },
  supportTicket: {
    path: "/support/:ticketId",
    getHref: (ticketId: string) => `/support/${ticketId}`,
  },

  /** The staff area, on /api/v1/staff. */
  staff: {
    path: "/staff",
    getHref: () => "/staff",
  },
  staffReports: {
    path: "/staff/reports",
    getHref: () => "/staff/reports",
  },
  staffCustomers: {
    path: "/staff/customers",
    getHref: () => "/staff/customers",
  },
  staffCustomer: {
    path: "/staff/customers/:customerId",
    getHref: (customerId: string) => `/staff/customers/${customerId}`,
  },
  staffSubscriptions: {
    path: "/staff/subscriptions",
    getHref: () => "/staff/subscriptions",
  },
  staffSubscription: {
    path: "/staff/subscriptions/:subscriptionId",
    getHref: (subscriptionId: string) => `/staff/subscriptions/${subscriptionId}`,
  },
  staffTickets: {
    path: "/staff/tickets",
    getHref: () => "/staff/tickets",
  },
  staffTicket: {
    path: "/staff/tickets/:ticketId",
    getHref: (ticketId: string) => `/staff/tickets/${ticketId}`,
  },
  staffPayments: {
    path: "/staff/payments",
    getHref: () => "/staff/payments",
  },
  staffPosts: {
    path: "/staff/posts",
    getHref: () => "/staff/posts",
  },
  /** "new" for a post not yet written. */
  staffPost: {
    path: "/staff/posts/:postId",
    getHref: (postId: string) => `/staff/posts/${postId}`,
  },
  staffComments: {
    path: "/staff/comments",
    getHref: () => "/staff/comments",
  },
  staffNotifications: {
    path: "/staff/notifications",
    getHref: () => "/staff/notifications",
  },
  staffSettings: {
    path: "/staff/settings",
    getHref: () => "/staff/settings",
  },
  staffPlans: {
    path: "/staff/plans",
    getHref: () => "/staff/plans",
  },
  staffServers: {
    path: "/staff/servers",
    getHref: () => "/staff/servers",
  },
  staffPanels: {
    path: "/staff/panels",
    getHref: () => "/staff/panels",
  },
  staffTeam: {
    path: "/staff/team",
    getHref: () => "/staff/team",
  },
  staffAudit: {
    path: "/staff/audit",
    getHref: () => "/staff/audit",
  },

  notFound: {
    path: "*",
    getHref: () => "/404",
  },
} as const;

/**
 * Addresses the old site used, each sent to where the same thing lives now,
 * so bookmarks and links out in the world do not end on "not found".
 */
export const LEGACY_REDIRECTS: { from: string; to: string }[] = [
  { from: "/products", to: paths.pricing.getHref() },
  { from: "/cart", to: paths.pricing.getHref() },
  { from: "/checkout", to: paths.pricing.getHref() },
  { from: "/verify-payment", to: paths.pricing.getHref() },
  { from: "/profile", to: paths.account.getHref() },
  { from: "/invoices", to: paths.account.getHref() },
  { from: "/auth", to: paths.accountSignIn.getHref() },
  { from: "/reset-password", to: paths.accountForgotPassword.getHref() },
  { from: "/reset-password/:resetToken", to: paths.accountForgotPassword.getHref() },
  { from: "/dashboard/*", to: paths.staff.getHref() },
  { from: "/admin/*", to: paths.staffPlans.getHref() },
  { from: "/mod", to: paths.staffTeam.getHref() },
  { from: "/crm/*", to: paths.staffCustomers.getHref() },
];
