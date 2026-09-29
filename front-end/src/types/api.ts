/**
 * The shapes the API actually returns.
 *
 * These mirror the serializers on the server, so a field the backend does not
 * send cannot be read here without TypeScript objecting.
 */

export type Role = "user" | "admin" | "moderator" | "owner";

export type CartItem = {
  _id: string;
  productId: string;
  quantity: number;
};

export type User = {
  _id: string;
  username: string;
  email: string;
  role: Role;
  cart: { items: CartItem[] };
  createdAt?: string;

  // Profile. All optional, because an account created before profiles existed
  // is still a valid account and nobody is obliged to fill anything in.
  /** Public path to the uploaded avatar, or null when there is none. */
  avatar?: string | null;
  displayName?: string;
  bio?: string;
  phone?: string;
  country?: string;
};

/** What `GET /login-status` answers. */
export type Session =
  | ({ isLoggedIn: true } & User)
  | { isLoggedIn: false };

export type Product = {
  _id: string;
  name: string;
  period: string;
  price: number;
  perks: string[];
  image: string;
  userId?: string;
  createdAt?: string;
};

export type ProductsPage = {
  products: Product[];
  totalProductsLength: number;
  limit: number;
};

export type ProductsQuery = {
  page?: number;
  limit?: number;
  search?: string;
  period?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
};

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "shipped"
  | "cancelled";

export type OrderItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
};

export type Order = {
  _id: string;
  user: { userId: string; username: string; email: string };
  items: OrderItem[];
  totalPrice: number;
  status: OrderStatus;
  authority?: string;
  refId?: string;
  paidAt?: string;
  createdAt?: string;
};

/** `GET /checkout` previews an order without saving one, so it has no id. */
export type OrderPreview = Omit<Order, "_id">;

/** What `POST /payment` answers: where to send the customer. */
export type PaymentTicket = {
  status: number;
  authority: string;
  url: string;
  orderId: string;
};

/** `POST /verify-payment` answers with the order, or a note that it was already settled. */
export type VerifiedPayment = Order | { message: string; refId?: string };

/** One line of the signed-in admin's own product list. */
export type AdminProductRef = {
  _id?: string;
  productId: string;
  count: number;
};

export type CreatedProduct = {
  product: Product;
  adminProducts: AdminProductRef[];
};

/** The author line on a post or a comment. Copied, not joined, on the server. */
export type PostAuthor = {
  name: string;
  avatar: string | null;
};

/** A card in the feed. Carries no article body: the grid does not need one. */
export type PostSummary = {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string;
  tags: string[];
  readingMinutes: number;
  author: PostAuthor;
  likeCount: number;
  /** Whether the person asking has liked it. False when signed out. */
  likedByMe: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt?: string;
};

/** The whole article, as served by /posts/:slug. */
export type Post = PostSummary & { content: string };

export type PostsPage = {
  posts: PostSummary[];
  totalPostsLength: number;
  limit: number;
};

export type PostsQuery = {
  page?: number;
  limit?: number;
  tag?: string;
  search?: string;
};

/**
 * A post as the dashboard sees it: the public card, plus whether the person
 * looking may edit it and how long it is.
 */
export type StaffPostSummary = PostSummary & {
  /** True only for the member of staff who wrote it. */
  canEdit: boolean;
  wordCount: number;
  updatedAt: string;
};

/** One post in full, for the details dialog and the edit form. */
export type StaffPost = StaffPostSummary & { content: string };

export type StaffPostsPage = {
  posts: StaffPostSummary[];
  totalPostsLength: number;
  limit: number;
  page: number;
};

export type StaffPostsQuery = {
  page?: number;
  limit?: number;
  search?: string;
  /** Only the signed-in member of staff's own posts. */
  mine?: boolean;
};

export type Comment = {
  _id: string;
  postId: string;
  body: string;
  author: PostAuthor;
  /** Whether the person asking wrote it, which is what shows the delete button. */
  mine: boolean;
  createdAt: string;
};

export type CommentsPage = {
  comments: Comment[];
  totalCommentsLength: number;
  limit: number;
};

// --------------------------------------------------------------- analytics

/** A figure paired with the same measure over the preceding equal span. */
export type Metric = {
  value: number;
  previous: number;
  /** Percentage change, or null when there is no baseline to compare against. */
  change: number | null;
};

export type AnalyticsSummary = {
  range: { from: string; to: string; days: number };
  revenue: Metric;
  orders: Metric;
  averageOrderValue: Metric;
  customers: Metric;
  units: number;
  newCustomers: number;
  pendingOrders: number;
  mrr: number;
  arr: number;
  /** How much of the paid history the run rate actually covers. */
  mrrCoverage: {
    countedOrders: number;
    totalOrders: number;
    percent: number;
  };
};

export type RevenuePoint = {
  /** The bucket's first day, as YYYY-MM-DD. */
  bucket: string;
  revenue: number;
  orders: number;
};

export type RevenueSeries = {
  interval: "day" | "week" | "month";
  range: { from: string; to: string };
  points: RevenuePoint[];
};

export type PlanBreakdownRow = {
  name: string;
  revenue: number;
  units: number;
  share: number;
};

export type TermBreakdownRow = Omit<PlanBreakdownRow, "name"> & {
  period: string;
};

export type PlanBreakdown = {
  range: { from: string; to: string };
  total: number;
  plans: PlanBreakdownRow[];
  terms: TermBreakdownRow[];
};

export type SalesFunnel = {
  range: { from: string; to: string };
  /** Carts with something in them, as of now, not over the range. */
  openCarts: number;
  ordersStarted: number;
  ordersPaid: number;
  ordersFailed: number;
  checkoutCompletion: number;
};

export type TopCustomer = {
  userId: string;
  username: string;
  email: string;
  revenue: number;
  orders: number;
  lastOrderAt: string | null;
};

// --------------------------------------------------------------------- crm

export type LifecycleStage =
  | "lead"
  | "active"
  | "at-risk"
  | "churned"
  | "vip"
  | "blocked";

export type CustomerNote = {
  _id: string;
  body: string;
  author: { userId: string; name: string };
  createdAt: string;
};

export type Customer = {
  userId: string;
  username: string;
  email: string;
  role: Role;
  avatar: string | null;
  displayName: string;
  country: string;
  phone: string;
  joinedAt: string;

  lifetimeValue: number;
  paidOrders: number;
  failedOrders: number;
  pendingOrders: number;
  averageOrderValue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  cartItems: number;

  /** What the rule says, always present so the reason is visible. */
  computedStage: LifecycleStage;
  /** What a person set, when they have. */
  stageOverride: LifecycleStage | null;
  /** What to show: the override if there is one. */
  stage: LifecycleStage;

  tags: string[];
  owner: { userId: string; name: string } | null;
  noteCount: number;
};

export type CustomerDetail = Customer & {
  notes: CustomerNote[];
  orders: {
    _id: string;
    status: OrderStatus;
    totalPrice: number;
    items: OrderItem[];
    createdAt: string;
    paidAt: string | null;
    refId: string | null;
  }[];
};

export type CustomersPage = {
  customers: Customer[];
  totalCustomersLength: number;
  limit: number;
  page: number;
  /** The whole segment's worth, not just this page's. */
  segmentValue: number;
};

export type CustomersQuery = {
  page?: number;
  limit?: number;
  search?: string;
  stage?: LifecycleStage;
  tag?: string;
  sort?: "value" | "orders" | "recent" | "joined" | "name";
};

export type CrmSegments = {
  totalCustomers: number;
  rules: { atRiskAfterDays: number; churnedAfterDays: number };
  segments: { stage: LifecycleStage; customers: number; value: number }[];
};
