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

  /**
   * The catalogue used to live here. Kept so links already out in the world,
   * and anyone's bookmark, land on the pricing page rather than a 404.
   */
  productsLegacy: {
    path: "/products",
    getHref: () => "/products",
  },

  posts: {
    path: "/posts",
    getHref: () => "/posts",
  },

  post: {
    path: "/posts/:slug",
    getHref: (slug: string) => `/posts/${slug}`,
  },

  cart: {
    path: "/cart",
    getHref: () => "/cart",
  },

  checkout: {
    path: "/checkout",
    getHref: () => "/checkout",
  },

  verifyPayment: {
    path: "/verify-payment",
    getHref: () => "/verify-payment",
  },

  profile: {
    path: "/profile",
    getHref: () => "/profile",
  },

  invoices: {
    path: "/invoices",
    getHref: () => "/invoices",
  },

  /** The new account screens, on /api/v1. */
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

  auth: {
    path: "/auth",
    // Where to return to once the visitor has signed in.
    getHref: (redirectTo?: string | null | undefined) =>
      `/auth${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""}`,
  },

  resetPassword: {
    path: "/reset-password",
    getHref: () => "/reset-password",
  },

  resetPasswordToken: {
    path: "/reset-password/:resetToken",
    getHref: (resetToken: string) => `/reset-password/${resetToken}`,
  },

  /**
   * The staff area: every internal screen behind one sidebar.
   *
   * Sales, customers, products and users used to be four separate top-level
   * pages, each a link in the public navigation. They are one workspace for
   * the people who use them, so they now share one address prefix, one layout
   * and one guard.
   */
  dashboard: {
    path: "/dashboard",
    getHref: () => "/dashboard",
  },

  dashboardCustomers: {
    path: "/dashboard/customers",
    getHref: () => "/dashboard/customers",
  },

  dashboardCustomer: {
    path: "/dashboard/customers/:userId",
    getHref: (userId: string) => `/dashboard/customers/${userId}`,
  },

  dashboardProducts: {
    path: "/dashboard/products",
    getHref: () => "/dashboard/products",
  },

  dashboardProduct: {
    path: "/dashboard/products/:productId",
    getHref: (productId: string) => `/dashboard/products/${productId}`,
  },

  dashboardPosts: {
    path: "/dashboard/posts",
    getHref: () => "/dashboard/posts",
  },

  dashboardPost: {
    path: "/dashboard/posts/:postId",
    getHref: (postId: string) => `/dashboard/posts/${postId}`,
  },

  dashboardUsers: {
    path: "/dashboard/users",
    getHref: () => "/dashboard/users",
  },

  /**
   * Where the panels used to live. Kept so bookmarks and links already out in
   * the world land on the same screen in its new home rather than a 404.
   */
  adminLegacy: {
    path: "/admin",
    getHref: () => "/admin",
  },

  adminProductLegacy: {
    path: "/admin/:productId",
    getHref: (productId: string) => `/admin/${productId}`,
  },

  moderatorLegacy: {
    path: "/mod",
    getHref: () => "/mod",
  },

  crmLegacy: {
    path: "/crm",
    getHref: () => "/crm",
  },

  crmCustomerLegacy: {
    path: "/crm/:userId",
    getHref: (userId: string) => `/crm/${userId}`,
  },

  notFound: {
    path: "*",
    getHref: () => "/404",
  },
} as const;
