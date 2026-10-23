/**
 * Typed service contracts for the Merchant frontend.
 *
 * Both the mock implementation (./mock) and a future Supabase implementation
 * (./supabase) satisfy these interfaces, so UI code never imports a backend.
 *
 * Security notes:
 *  - Every mutating call here maps to a trusted server operation (Edge
 *    Function / authorized server route) — never a direct table write for
 *    stock, order state, payment state or credentials (DB-02, §7.5).
 *  - Client-side checks are UX only (AUTHZ-03).
 */
import type {
  AccountUser,
  ActiveSession,
  Address,
  AdminCustomerRow,
  AdminDashboard,
  AdminMerchantDetail,
  AdminMerchantRow,
  Announcement,
  AnnouncementAudience,
  AuditLog,
  Cart,
  CartValidation,
  CustomerOrderDetail,
  Dispute,
  DisputeKind,
  PaymentTransactionSummary,
  PlaceOrderInput,
  PlaceOrderResult,
  Policy,
  PolicyType,
  Refund,
  RefundMethod,
  ReturnMethod,
  ReturnReason,
  ReturnRequest,
  ReturnStatus,
  StoreSearchResult,
  StorefrontProductFilters,
  StorefrontStore,
  SystemHealth,
  ThemeAdmin,
  TicketCategory,
  TicketPriority,
  TrackingResult,
  AnalyticsReport,
  Category,
  StoreCustomer,
  StoreCustomerDetail,
  DashboardSummary,
  DateRange,
  InventoryMovement,
  DeviceToken,
  InventoryRow,
  Notification,
  OnboardingProgress,
  Order,
  OrderDetail,
  OrderListFilters,
  OrderStatus,
  Page,
  PaymentConfig,
  PaymentCredentials,
  PaymentMethod,
  Product,
  ProductStatus,
  Session,
  StockState,
  Store,
  StoreCategory,
  StoreExtensions,
  SubdomainCheck,
  SupportTicket,
  SupportTicketDetail,
  Theme,
  TicketStatus,
} from '../types';
import type { ProductInput } from '../validation';

export type ServiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'SUSPENDED'
  | 'UNVERIFIED'
  | 'NETWORK'
  | 'UNKNOWN';

/** Plain-English, user-safe error (NFR-U-01). Never carries raw provider/DB errors. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly fieldErrors?: Record<string, string>;
  constructor(code: ServiceErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ServiceError');
}

export function errorMessage(e: unknown): string {
  if (isServiceError(e)) return e.message;
  return 'Something went wrong. Please try again.';
}

/** A file selected in the browser / Capacitor camera. */
export interface UploadFile {
  name: string;
  size: number;
  type: string;
  /** Local preview URL (object URL / data URL). */
  previewUrl: string;
}

export interface UploadResult {
  storagePath: string;
  url: string;
}

/* ------------------------------------------------------------------ */

export interface AuthService {
  getSession(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<Session>;
  /** FR-M-05 / FR-C-30: the server assigns the role for the signup flow used; OAuth accounts skip email verification. */
  signInWithGoogle(accountType?: 'merchant' | 'customer'): Promise<Session>;
  /** The server assigns the role (AUTHZ-01); accountType only says which signup flow was used. */
  register(input: { fullName: string; email: string; password: string; accountType?: 'merchant' | 'customer' }): Promise<{ email: string }>;
  resendVerification(email: string): Promise<void>;
  /** Re-reads the auth user; resolves with the session once the email is verified. */
  refreshVerification(): Promise<Session>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  updateProfile(input: { fullName: string; phone: string | null; avatar?: UploadFile | null }): Promise<AccountUser>;
  requestEmailChange(newEmail: string): Promise<void>;
  /** AUTH-06: terminates all other sessions. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  listSessions(): Promise<ActiveSession[]>;
  terminateSession(sessionId: string): Promise<void>;
  /** AUTH-11 / FR-M-42 */
  beginTotpEnrollment(): Promise<{ secret: string; otpauthUrl: string }>;
  confirmTotpEnrollment(code: string): Promise<{ recoveryCodes: string[] }>;
  disableTotp(code: string): Promise<void>;
  /** FR-M-44 */
  getDeletionPrecheck(): Promise<{ pendingOrders: number }>;
  deleteAccount(confirmation: string): Promise<void>;
}

export interface StoreService {
  getMyStore(): Promise<Store | null>;
  checkSubdomain(subdomain: string): Promise<SubdomainCheck>;
  /** FR-M-09/10: creates a Draft store; rejects a second store. */
  createStore(input: { name: string; subdomain: string; category: StoreCategory; tagline: string }): Promise<Store>;
  updateStore(patch: Partial<Pick<Store, 'name' | 'tagline' | 'brandColour' | 'themeId' | 'returnWindowDays'>>): Promise<Store>;
  updateExtensions(patch: Partial<StoreExtensions>): Promise<Store>;
  uploadLogo(file: UploadFile): Promise<Store>;
  removeLogo(): Promise<Store>;
  uploadBanner(file: UploadFile): Promise<Store>;
  listThemes(): Promise<Theme[]>;
  getOnboarding(): Promise<OnboardingProgress>;
  publish(): Promise<Store>;
  unpublish(): Promise<Store>;
}

export interface ProductListFilters {
  search?: string;
  status?: ProductStatus | 'all';
  categoryId?: string | 'all';
  stock?: StockState | 'all';
  productType?: 'simple' | 'variant' | 'all';
}

export interface DuplicateProductOptions {
  /** Defaults to "<name> (Copy)". */
  name?: string;
  /** Copy the product images (default true). */
  includeImages?: boolean;
  /** Copy the original/asking price (default true). The base price is always copied. */
  includePricing?: boolean;
  /** Copy the SKU with a -COPY suffix (default true); otherwise leave it empty. */
  copySku?: boolean;
}

export interface ProductService {
  list(filters?: ProductListFilters): Promise<Product[]>;
  get(id: string): Promise<Product>;
  create(input: ProductInput): Promise<Product>;
  /** Stock of existing simple products/variants is NOT changed here — use InventoryService. */
  update(id: string, input: ProductInput): Promise<Product>;
  setStatus(id: string, status: ProductStatus): Promise<Product>;
  /** API-14 soft delete. */
  remove(id: string): Promise<void>;
  /** FR-M-19: new draft pre-filled from the original. */
  /**
   * FR-M-19: creates a draft copy with stock 0 (stock is only added through the
   * inventory ledger). Options let the merchant rename it and choose what to copy.
   */
  duplicate(id: string, options?: DuplicateProductOptions): Promise<Product>;
  uploadImage(file: UploadFile, productId?: string): Promise<UploadResult>;
  listCategories(): Promise<Category[]>;
  createCategory(name: string): Promise<Category>;
}

export interface InventoryFilters {
  search?: string;
  categoryId?: string | 'all';
  state?: StockState | 'all';
}

export interface InventoryService {
  list(filters?: InventoryFilters): Promise<InventoryRow[]>;
  /** Trusted inventory operation; writes one inventory_movements row. */
  adjust(input: { productId: string; variantId: string | null; delta: number; note: string; idempotencyKey: string }): Promise<InventoryRow>;
  movements(filters?: { productId?: string; variantId?: string | null; limit?: number }): Promise<InventoryMovement[]>;
}

export interface OrderService {
  list(filters?: OrderListFilters): Promise<Page<Order>>;
  countsByStatus(): Promise<Record<OrderStatus | 'all', number>>;
  get(id: string): Promise<OrderDetail>;
  /** API-09: canonical transition, validated server-side. */
  updateStatus(id: string, to: Exclude<OrderStatus, 'cancelled' | 'pending'>, input: { note?: string; idempotencyKey: string }): Promise<OrderDetail>;
  /** API-10: reason required; idempotent stock release. */
  cancel(id: string, input: { reason: string; idempotencyKey: string }): Promise<OrderDetail>;
  /** DM-05: record actual COD collection. */
  recordCodCollection(id: string, input: { amount: number; note?: string; idempotencyKey: string }): Promise<OrderDetail>;
  /** API-43: manual verification when provider verification is unavailable. Audited. */
  reviewPayment(id: string, input: { decision: 'paid' | 'failed'; reason: string; idempotencyKey: string }): Promise<OrderDetail>;
  /** DM-07: delivery history report as CSV. */
  deliveryHistoryCsv(range: DateRange): Promise<{ filename: string; csv: string }>;
}

export interface ReturnDetail {
  returnRequest: ReturnRequest;
  order: Order;
  refund: Refund | null;
}

/** Merchant return review and refund processing (§14, API-16/17/42). */
export interface MerchantReturnService {
  list(filters?: { status?: ReturnStatus | 'all'; search?: string }): Promise<ReturnRequest[]>;
  get(id: string): Promise<ReturnDetail>;
  decide(id: string, input: { decision: 'approved' | 'rejected'; reason: string }): Promise<ReturnDetail>;
  setReturnMethod(id: string, method: ReturnMethod): Promise<ReturnDetail>;
  /** FR-RET-08: confirm physical receipt and inspection; restocks the returned items. */
  confirmReceipt(id: string, input: { restock: boolean; note: string; idempotencyKey: string }): Promise<ReturnDetail>;
  /** FR-REF-01: only after approval and confirmed receipt. */
  createRefund(id: string, input: { amount: number; method: RefundMethod; idempotencyKey: string }): Promise<ReturnDetail>;
  markRefundProcessing(refundId: string, note: string): Promise<ReturnDetail>;
  /** FR-REF-02/03: completion requires provider confirmation or manual settlement evidence. */
  recordRefundSettlement(refundId: string, input: { reference: string; note: string; idempotencyKey: string }): Promise<ReturnDetail>;
  markRefundFailed(refundId: string, note: string): Promise<ReturnDetail>;
}

/* ------------------------------------------------------------------ */
/* Customer / storefront                                               */
/* ------------------------------------------------------------------ */

export interface StorefrontProductView {
  product: Product;
  categoryName: string | null;
  related: Product[];
}

/** Public, store-scoped reads (API-04/05/06/25/32/41). Never a cross-store catalogue. */
export interface StorefrontService {
  searchStores(q: string): Promise<StoreSearchResult[]>;
  featuredStores(): Promise<StoreSearchResult[]>;
  /** FR-C-02: unknown, unpublished and suspended stores all return the same "unavailable" error. */
  resolveStore(subdomain: string): Promise<StorefrontStore>;
  listCategories(storeId: string): Promise<(Category & { productCount: number })[]>;
  listProducts(storeId: string, filters?: StorefrontProductFilters): Promise<Product[]>;
  /** Accepts the product slug (/products/[slug]) or its id. */
  getProduct(storeId: string, productSlugOrId: string): Promise<StorefrontProductView>;
  /** FR-C-09/12: current prices and stock for the cart; caps quantities. */
  validateCart(storeId: string, items: Cart['items'], district?: string): Promise<CartValidation>;
  getPublishedPolicy(type: PolicyType): Promise<Policy | null>;
  /** FR-C-23/27: Order ID + order phone; the same "not found" for any mismatch. Rate limited. */
  trackOrder(orderNumber: string, phone: string): Promise<TrackingResult>;
}

/** Order placement and payment (API-07/20/21/33). */
export interface CheckoutService {
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  /** FR-C-16: customer-submitted wallet transaction IDs are untrusted; payment becomes pending_verification. */
  submitWalletReference(
    orderId: string,
    input: { phone: string; reference: string; idempotencyKey: string },
  ): Promise<{ paymentStatus: Order['paymentStatus']; payment: PaymentTransactionSummary }>;
  /** FR-C-17: returns a gateway URL. Only the signed webhook can mark the payment paid. */
  startSslcommerz(orderId: string, input: { phone: string }): Promise<{ redirectUrl: string; sessionToken: string }>;
  /** Sandbox-only: simulates the gateway page posting its signed webhook. */
  completeSslcommerzSandbox(
    sessionToken: string,
    outcome: 'success' | 'failed' | 'cancelled',
  ): Promise<{ orderNumber: string; subdomain: string; phone: string; paymentStatus: Order['paymentStatus'] }>;
}

export interface CustomerOrderRow extends Order {
  storeName: string;
  storeSubdomain: string;
}

/** Logged-in customer account (FR-C-30..36, §14, §15). */
export interface CustomerAccountService {
  listOrders(): Promise<CustomerOrderRow[]>;
  getOrder(id: string): Promise<CustomerOrderDetail>;
  listAddresses(): Promise<Address[]>;
  saveAddress(input: Omit<Address, 'id' | 'customerId' | 'createdAt' | 'updatedAt'>, id?: string): Promise<Address[]>;
  deleteAddress(id: string): Promise<Address[]>;
  setDefaultAddress(id: string): Promise<Address[]>;
  listReturns(): Promise<ReturnRequest[]>;
  getReturn(id: string): Promise<{ returnRequest: ReturnRequest; refund: Refund | null }>;
  createReturn(
    orderId: string,
    input: { reason: ReturnReason; conditionDescription: string; evidence?: UploadFile | null; idempotencyKey: string },
  ): Promise<ReturnRequest>;
  escalateReturn(id: string, note: string): Promise<ReturnRequest>;
  listTickets(): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicketDetail>;
  createTicket(input: {
    category: TicketCategory;
    subject: string;
    description: string;
    priority: TicketPriority;
    orderId: string | null;
    attachment?: UploadFile | null;
  }): Promise<SupportTicketDetail>;
  replyTicket(id: string, input: { body: string; attachment?: UploadFile | null }): Promise<SupportTicketDetail>;
  setTicketPriority(id: string, priority: TicketPriority): Promise<SupportTicketDetail>;
  reopenTicket(id: string): Promise<SupportTicketDetail>;
  escalateTicket(id: string): Promise<SupportTicketDetail>;
  deleteAccount(confirmation: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Super Admin                                                          */
/* ------------------------------------------------------------------ */

/** AUTH-08/09/10: allowlisted network, password, mandatory TOTP, 30-minute idle expiry. */
export interface AdminAuthService {
  checkNetwork(): Promise<{ allowed: boolean; ip: string }>;
  signIn(email: string, password: string): Promise<{ mfaRequired: true }>;
  verifyTotp(code: string): Promise<Session>;
  /** Records activity and returns the refreshed session (idle timer). */
  touch(): Promise<Session>;
  signOut(): Promise<void>;
}

export interface AdminStoreRow extends Store {
  ownerName: string;
  ownerEmail: string;
  themeName: string | null;
  productCount: number;
  orderCount: number;
}

export interface AdminOrderRow extends Order {
  storeName: string;
}

export interface AdminService {
  dashboard(range: DateRange): Promise<AdminDashboard>;
  health(): Promise<SystemHealth>;
  listMerchants(filters?: { search?: string; status?: 'all' | 'active' | 'suspended' | 'onboarding' }): Promise<AdminMerchantRow[]>;
  getMerchant(id: string): Promise<AdminMerchantDetail>;
  /** FR-SA-11: ends sessions, unpublishes the store, emails the merchant. */
  suspendMerchant(id: string, reason: string): Promise<AdminMerchantDetail>;
  /** FR-SA-12: store stays unpublished until the merchant republishes. */
  reinstateMerchant(id: string): Promise<AdminMerchantDetail>;
  /** FR-SA-13: phrase must be "DELETE <merchant_email>". */
  deleteMerchant(id: string, phrase: string): Promise<void>;
  listCustomers(filters?: { search?: string }): Promise<AdminCustomerRow[]>;
  getCustomer(id: string): Promise<AdminCustomerRow & { orders: AdminOrderRow[] }>;
  listStores(filters?: { search?: string; status?: Store['status'] | 'all' }): Promise<AdminStoreRow[]>;
  /** Read-only order oversight; Super Admin cannot change ordinary order status (§13.1). */
  listOrders(filters?: OrderListFilters & { storeId?: string }): Promise<Page<AdminOrderRow>>;
  getOrder(id: string): Promise<OrderDetail & { storeName: string }>;
  reviewPayment(orderId: string, input: { decision: 'paid' | 'failed'; reason: string; idempotencyKey: string }): Promise<OrderDetail & { storeName: string }>;
  listThemes(): Promise<ThemeAdmin[]>;
  saveTheme(input: { name: string; description: string; accent: string; isActive: boolean; breaking?: boolean }, id?: string): Promise<ThemeAdmin>;
  /** FR-SA-14: blocked while any store uses the theme; lists affected stores. */
  deleteTheme(id: string): Promise<void>;
  listAnnouncements(): Promise<Announcement[]>;
  recipientCount(audience: AnnouncementAudience): Promise<number>;
  saveAnnouncement(
    input: { title: string; body: string; audience: AnnouncementAudience; scheduledAt: string | null },
    action: 'draft' | 'schedule' | 'send',
    id?: string,
  ): Promise<Announcement>;
  cancelAnnouncement(id: string): Promise<Announcement>;
  deleteAnnouncement(id: string): Promise<void>;
  listPolicies(): Promise<Policy[]>;
  submitPolicy(input: { type: PolicyType; version: string; effectiveDate: string; content: string }): Promise<Policy>;
  approvePolicy(id: string): Promise<Policy>;
  publishPolicy(id: string): Promise<Policy>;
  listTickets(filters?: {
    queue?: 'all' | 'store' | 'platform';
    status?: TicketStatus | 'all';
    escalatedOnly?: boolean;
    search?: string;
  }): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicketDetail>;
  replyTicket(id: string, input: { body: string }): Promise<SupportTicketDetail>;
  updateTicketStatus(id: string, to: TicketStatus, input?: { resolutionNote?: string }): Promise<SupportTicketDetail>;
  listDisputes(filters?: { status?: 'open' | 'all' }): Promise<Dispute[]>;
  getReturnDispute(id: string): Promise<ReturnDetail>;
  /** FR-SA-21: request info, override the merchant decision, or close with a note. All audited. */
  resolveDispute(kind: DisputeKind, id: string, input: { action: 'request_info' | 'override' | 'close'; note: string }): Promise<void>;
  listRefunds(filters?: { status?: Refund['status'] | 'all'; stalledOnly?: boolean }): Promise<Refund[]>;
  /** FR-REF-07: audited intervention; completion needs settlement evidence. */
  interveneRefund(id: string, input: { action: 'mark_processing' | 'mark_failed' | 'settle'; reference?: string; note: string }): Promise<Refund>;
  listAuditLogs(filters?: { search?: string; resourceType?: string; from?: string; to?: string }): Promise<AuditLog[]>;
}

export interface CustomerService {
  list(filters?: { search?: string; accountType?: 'registered' | 'guest' | 'all' }): Promise<StoreCustomer[]>;
  get(id: string): Promise<StoreCustomerDetail>;
}

export interface PaymentConfigService {
  list(): Promise<PaymentConfig[]>;
  setEnabled(method: PaymentMethod, enabled: boolean): Promise<PaymentConfig>;
  /**
   * Sends credentials to the trusted credential Edge Function, which validates,
   * encrypts and stores them. Only a masked projection comes back (FR-M-33/34).
   */
  saveCredentials(credentials: PaymentCredentials): Promise<PaymentConfig>;
}

export interface AnalyticsService {
  dashboard(range: DateRange): Promise<DashboardSummary>;
  report(range: DateRange): Promise<AnalyticsReport>;
  /** FR-M-38 CSV export for the selected range. */
  exportCsv(range: DateRange): Promise<{ filename: string; csv: string }>;
}

export interface SupportService {
  list(filters?: { status?: TicketStatus | 'all'; search?: string }): Promise<SupportTicket[]>;
  get(id: string): Promise<SupportTicketDetail>;
  reply(id: string, input: { body: string; attachment?: UploadFile | null }): Promise<SupportTicketDetail>;
  updateStatus(id: string, to: TicketStatus, input?: { resolutionNote?: string }): Promise<SupportTicketDetail>;
}

export interface NotificationService {
  list(filters?: { unreadOnly?: boolean }): Promise<Notification[]>;
  unreadCount(): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  /** Realtime-style subscription; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** MOB-08: store this device's FCM token server-side (device_tokens). The raw token is never returned. */
  registerDevice(input: { token: string; platform: 'android' }): Promise<DeviceToken>;
  /** AUTH-13: remove the token on sign-out. */
  unregisterDevice(token: string): Promise<void>;
}

export interface MerchantServices {
  returns: MerchantReturnService;
  auth: AuthService;
  store: StoreService;
  products: ProductService;
  inventory: InventoryService;
  orders: OrderService;
  customers: CustomerService;
  payments: PaymentConfigService;
  analytics: AnalyticsService;
  support: SupportService;
  notifications: NotificationService;
}

/** Everything the web and mobile apps can call, across the three roles. */
export interface PlatformServices extends MerchantServices {
  storefront: StorefrontService;
  checkout: CheckoutService;
  account: CustomerAccountService;
  adminAuth: AdminAuthService;
  admin: AdminService;
}
