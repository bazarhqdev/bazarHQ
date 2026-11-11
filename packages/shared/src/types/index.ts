/**
 * BazarHQ shared domain types — Merchant scope (SRS V2.1 §18.1).
 *
 * Field names are camelCase projections of the snake_case columns in the
 * Stage 1 migrations. Adapters (mock or Supabase) map between them.
 * Anything not backed by an SRS §18.1 column lives in an explicit
 * `*Extensions` type so the schema gap stays visible (see docs/SCHEMA_GAPS.md).
 */

export type UUID = string;
export type ISODateString = string;
/** BDT amount stored as numeric(12,2). Currency is constrained to BDT in V2.1. */
export type Money = number;
export type Currency = 'BDT';

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export type Role = 'merchant' | 'customer' | 'super_admin';
export type ProfileStatus = 'active' | 'suspended' | 'deleted';
export type AuthProvider = 'email' | 'google';

/** Supabase Auth facts for the signed-in user (auth.users is managed by Supabase). */
export interface User {
  id: UUID;
  email: string;
  emailVerified: boolean;
  /** A new email awaiting verification (FR-M-41). */
  pendingEmail: string | null;
  authProvider: AuthProvider;
  twoFactorEnabled: boolean;
  createdAt: ISODateString;
}

/** Canonical application profile (profiles table). role/status are server-controlled. */
export interface Profile {
  id: UUID;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  /** Set server-side only (AUTHZ-01/02). The client never writes this. */
  role: Role;
  status: ProfileStatus;
  suspensionReason: string | null;
}

/** Auth user + profile, as returned in a session. */
export type AccountUser = User & Profile;

export type Merchant = AccountUser;
export type Customer = AccountUser;
export interface SuperAdmin extends AccountUser {
  /** TOTP is mandatory for every Super Admin session (AUTH-09). */
  totpEnrolled: boolean;
  lastLoginAt: ISODateString | null;
  lastLoginIp: string | null;
}

export interface AdminSessionState {
  mfaVerified: boolean;
  networkAllowed: boolean;
  /** AUTH-10: expires after 30 minutes of inactivity. */
  idleExpiresAt: ISODateString | null;
  ip: string | null;
}

export interface Session {
  user: AccountUser;
  /** The merchant's store; null for customers, admins and merchants mid-onboarding. */
  store: Store | null;
  admin?: AdminSessionState;
}

export interface ActiveSession {
  id: UUID;
  device: string;
  platform: 'web' | 'android';
  location: string | null;
  lastActiveAt: ISODateString;
  current: boolean;
}

/* ------------------------------------------------------------------ */
/* Store, themes, categories                                           */
/* ------------------------------------------------------------------ */

export type StoreStatus = 'draft' | 'published' | 'suspended';

export interface Store {
  id: UUID;
  ownerId: UUID;
  name: string;
  /** Lowercase store slug; public storefront route is /store/<subdomain>. */
  subdomain: string;
  status: StoreStatus;
  themeId: UUID | null;
  brandColour: string;
  tagline: string | null;
  logoUrl: string | null;
  /** FR-M-45: calendar days from delivery, default 7. */
  returnWindowDays: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  extensions: StoreExtensions;
}

/**
 * UI fields requested for the Merchant frontend that have NO column in
 * SRS V2.1 §18.1. Persisting them needs a Project Owner schema decision.
 */
export interface StoreExtensions {
  category: StoreCategory | null;
  bannerUrl: string | null;
  shipping: ShippingSettings;
  notificationPreferences: NotificationPreferences;
}

export type StoreCategory = 'groceries' | 'fashion' | 'electronics' | 'home_living' | 'health_beauty' | 'books_stationery' | 'other';

export interface ShippingSettings {
  /** FR-C-08 says delivery charge comes from merchant configuration. */
  insideDhakaCharge: Money;
  outsideDhakaCharge: Money;
  estimatedDaysInsideDhaka: number;
  estimatedDaysOutsideDhaka: number;
}

export interface NotificationPreferences {
  newOrderEmail: boolean;
  newOrderSms: boolean;
  lowStockEmail: boolean;
  supportTicketEmail: boolean;
}

export interface Theme {
  id: UUID;
  name: string;
  description: string;
  previewUrl: string | null;
  isActive: boolean;
  /** Presentation hint for the mock preview (not a DB column). */
  accent: string;
}

export interface Category {
  id: UUID;
  storeId: UUID;
  name: string;
  slug: string;
  parentId: UUID | null;
  displayOrder: number;
}

export type OnboardingStepKey = 'subdomain' | 'logo' | 'payment_method' | 'first_product';

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  done: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  percent: number;
  /** FR-M-11 + FR-M-35 */
  publishable: boolean;
}

export interface SubdomainCheck {
  subdomain: string;
  available: boolean;
  reason: 'ok' | 'taken' | 'reserved' | 'invalid' | 'own';
  message: string;
  suggestions: string[];
}

/* ------------------------------------------------------------------ */
/* Products and inventory                                              */
/* ------------------------------------------------------------------ */

export type ProductType = 'simple' | 'variant';
export type ProductStatus = 'draft' | 'active' | 'inactive';
export type VariantStatus = 'active' | 'inactive';

export interface ProductImage {
  id: UUID;
  productId: UUID;
  /** stores/{store_uuid}/products/{product_uuid}/{file} */
  storagePath: string;
  /** Short-lived signed URL for display (buckets are private). */
  url: string | null;
  isPrimary: boolean;
  displayOrder: number;
}

export interface ProductVariant {
  id: UUID;
  productId: UUID;
  variantLabel: string;
  priceAdjustment: Money;
  stockQuantity: number;
  status: VariantStatus;
}

export interface Product {
  id: UUID;
  storeId: UUID;
  name: string;
  description: string;
  categoryId: UUID | null;
  basePrice: Money;
  productType: ProductType;
  /** NULL for variant products (DB-08). */
  stockQuantity: number | null;
  lowStockThreshold: number;
  status: ProductStatus;
  images: ProductImage[];
  variants: ProductVariant[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  extensions: ProductExtensions;
}

/** Not in SRS §18.1 — see docs/SCHEMA_GAPS.md. */
export interface ProductExtensions {
  sku: string | null;
  /**
   * Original / asking price shown struck through next to the base (selling)
   * price. Display only — checkout always charges the base price. Not an SRS
   * column (see SCHEMA_GAPS); null when not set.
   */
  compareAtPrice: Money | null;
}

export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface InventoryRow {
  productId: UUID;
  variantId: UUID | null;
  productName: string;
  variantLabel: string | null;
  categoryId: UUID | null;
  categoryName: string | null;
  productStatus: ProductStatus;
  stockQuantity: number;
  lowStockThreshold: number;
  state: StockState;
  imageUrl: string | null;
}

export type InventoryReason = 'sale' | 'return' | 'manual_adjustment' | 'cancellation_release' | 'payment_failure_release';

export interface InventoryMovement {
  id: UUID;
  storeId: UUID;
  productId: UUID;
  variantId: UUID | null;
  productName: string;
  variantLabel: string | null;
  quantityDelta: number;
  reason: InventoryReason;
  actorId: UUID | null;
  actorName: string | null;
  referenceType: 'order' | 'return' | 'manual' | null;
  referenceId: string | null;
  note: string | null;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Orders, payments, delivery                                          */
/* ------------------------------------------------------------------ */

export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';

export type PaymentStatus = 'pending' | 'pending_verification' | 'paid' | 'failed' | 'cod_pending' | 'cod_collected' | 'refunded';

export type PaymentMethod = 'bkash' | 'nagad' | 'rocket' | 'sslcommerz' | 'cod';

export interface DeliveryAddress {
  recipientName: string;
  phone: string;
  address: string;
  district: string;
  postalCode: string | null;
}

export interface OrderItem {
  id: UUID;
  orderId: UUID;
  productId: UUID;
  variantId: UUID | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: Money;
  subtotal: Money;
}

export interface Order {
  id: UUID;
  /** ORD-YYYYMMDD-BHQXXXXXX (FR-C-19) */
  orderNumber: string;
  storeId: UUID;
  /** NULL for guest checkout. */
  customerId: UUID | null;
  customerName: string;
  orderPhone: string;
  orderEmail: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** Internal academic/test marker. Test orders stay auditable but are excluded from business analytics. */
  isTest: boolean;
  testReason: string | null;
  testMarkedAt: ISODateString | null;
  subtotal: Money;
  deliveryCharge: Money;
  totalAmount: Money;
  currency: Currency;
  deliveryAddress: DeliveryAddress;
  cancellationReason: string | null;
  items: OrderItem[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type DeliveryEventType = OrderStatus | 'cod_collected';

export interface DeliveryEvent {
  id: UUID;
  orderId: UUID;
  actorId: UUID | null;
  actorName: string | null;
  eventType: DeliveryEventType;
  notes: string | null;
  proofImagePath: string | null;
  codAmount: Money | null;
  createdAt: ISODateString;
}

export type PaymentAttemptStatus = 'pending' | 'pending_verification' | 'paid' | 'failed';

/** Safe column projection of payment_transactions (Option B). */
export interface PaymentTransactionSummary {
  id: UUID;
  orderId: UUID;
  method: PaymentMethod;
  provider: string;
  status: PaymentAttemptStatus;
  amount: Money;
  currency: Currency;
  /** Masked by the server: last 4 characters only. */
  providerReferenceMasked: string | null;
  createdAt: ISODateString;
  verifiedAt: ISODateString | null;
}

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'closed';

export interface ReturnSummary {
  id: UUID;
  returnNumber: string;
  status: ReturnStatus;
  reason: string;
  createdAt: ISODateString;
}

/** payment_transactions safe column projection (Option B). */
export type PaymentTransaction = PaymentTransactionSummary;
/** A payment attempt is one payment_transactions row. */
export type PaymentAttempt = PaymentTransactionSummary;
/** Alias kept for the Merchant brief. */
export type Payment = PaymentTransactionSummary;

export interface OrderDetail {
  order: Order;
  events: DeliveryEvent[];
  payments: PaymentTransactionSummary[];
  returnRequest: ReturnSummary | null;
}

export interface OrderListFilters {
  status?: OrderStatus | 'all';
  paymentStatus?: PaymentStatus | 'all';
  paymentMethod?: PaymentMethod | 'all';
  search?: string;
  from?: ISODateString;
  to?: ISODateString;
  /** Include academic/test orders in the merchant list. Defaults to false. */
  includeTest?: boolean;
}

/* ------------------------------------------------------------------ */
/* Payment configuration                                               */
/* ------------------------------------------------------------------ */

export type CredentialValidation = 'valid' | 'invalid' | 'unverified' | 'not_required';

/**
 * Safe server projection of payment_configs. credentials_encrypted is never
 * returned; only a masked hint (last 4 characters, FR-M-33).
 */
export interface PaymentConfig {
  id: UUID;
  storeId: UUID;
  method: PaymentMethod;
  isEnabled: boolean;
  hasCredentials: boolean;
  credentialHint: string | null;
  environment: 'sandbox' | 'live';
  validation: CredentialValidation;
  updatedAt: ISODateString | null;
}

export interface BkashCredentials {
  merchantNumber: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
}
export interface NagadCredentials {
  merchantId: string;
  merchantNumber: string;
  publicKey: string;
  privateKey: string;
}
export interface RocketCredentials {
  merchantNumber: string;
  billerId: string;
  apiKey: string;
}
export interface SslcommerzCredentials {
  storeId: string;
  storePassword: string;
}
export type PaymentCredentials =
  | { method: 'bkash'; values: BkashCredentials }
  | { method: 'nagad'; values: NagadCredentials }
  | { method: 'rocket'; values: RocketCredentials }
  | { method: 'sslcommerz'; values: SslcommerzCredentials };

/* ------------------------------------------------------------------ */
/* Customers (derived from own-store orders)                          */
/* ------------------------------------------------------------------ */

export type CustomerAccountType = 'registered' | 'guest';
export type CustomerActivity = 'active' | 'inactive' | 'new';

export interface StoreCustomer {
  /** customer_id for registered customers, `guest:<phone>` for guests. */
  id: string;
  name: string;
  phone: string;
  email: string | null;
  accountType: CustomerAccountType;
  activity: CustomerActivity;
  ordersCount: number;
  /** Excludes cancelled orders (FR-M-39). */
  totalSpent: Money;
  firstOrderAt: ISODateString;
  lastOrderAt: ISODateString;
  district: string | null;
}

export interface StoreCustomerDetail {
  customer: StoreCustomer;
  orders: Order[];
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export type DateRangePreset = '7d' | '30d' | '90d' | 'custom';

export interface DateRange {
  preset: DateRangePreset;
  from: ISODateString;
  to: ISODateString;
}

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  revenue: Money;
  orders: number;
  cancelled: number;
  visitors: number;
}

export interface MetricWithChange {
  value: number;
  /** Percent change vs the previous equal-length period; null when not comparable. */
  changePct: number | null;
}

export interface TopProduct {
  productId: UUID;
  name: string;
  unitsSold: number;
  revenue: Money;
}

export interface LowStockItem {
  productId: UUID;
  variantId: UUID | null;
  name: string;
  stockQuantity: number;
  threshold: number;
  state: StockState;
}

export interface DashboardSummary {
  range: DateRange;
  totalSales: MetricWithChange;
  totalOrders: MetricWithChange;
  totalProducts: MetricWithChange;
  totalCustomers: MetricWithChange;
  series: SeriesPoint[];
  lowStock: LowStockItem[];
  recentOrders: Order[];
  recentNotifications: Notification[];
  hasOrders: boolean;
}

export interface AnalyticsReport {
  range: DateRange;
  revenue: MetricWithChange;
  orders: MetricWithChange;
  averageOrderValue: MetricWithChange;
  visitors: MetricWithChange;
  conversionRate: MetricWithChange;
  revenueToday: Money;
  revenueThisWeek: Money;
  revenueThisMonth: Money;
  cancelled: { orders: number; value: Money };
  series: SeriesPoint[];
  ordersByStatus: Record<OrderStatus, number>;
  paymentMethodBreakdown: { method: PaymentMethod; orders: number; revenue: Money }[];
  topProducts: TopProduct[];
  customerGrowth: { date: string; newCustomers: number; returningCustomers: number }[];
  popularPages: { path: string; views: number }[];
  hasOrders: boolean;
}

/* ------------------------------------------------------------------ */
/* Support and notifications                                           */
/* ------------------------------------------------------------------ */

export type TicketCategory = 'order_issue' | 'payment_issue' | 'delivery_issue' | 'return_refund' | 'account_issue' | 'other';
export type TicketPriority = 'normal' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved' | 'closed';

export interface TicketMessage {
  id: UUID;
  ticketId: UUID;
  senderId: UUID;
  senderName: string;
  senderRole: Role;
  body: string;
  attachmentName: string | null;
  attachmentStoragePath: string | null;
  createdAt: ISODateString;
}

export interface TicketAuditEntry {
  id: UUID;
  ticketId: UUID;
  actorName: string | null;
  eventType: 'created' | 'status_changed' | 'reply' | 'assigned' | 'escalated' | 'closed' | 'reopened' | 'priority_changed' | 'dispute_action';
  previousValue: string | null;
  newValue: string | null;
  createdAt: ISODateString;
}

export interface SupportTicket {
  id: UUID;
  /** 'store' tickets route to the store's merchant; 'platform' tickets to the Super Admin queue (FR-SUP-03). */
  queue: 'store' | 'platform';
  storeName: string | null;
  /** TKT-YYYYMMDD-BHQXXXXXX */
  ticketNumber: string;
  customerId: UUID;
  customerName: string;
  storeId: UUID | null;
  orderId: UUID | null;
  orderNumber: string | null;
  category: TicketCategory;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: UUID | null;
  resolutionNote: string | null;
  firstMerchantResponseAt: ISODateString | null;
  escalationAt: ISODateString | null;
  closedAt: ISODateString | null;
  dispute: { status: DisputeStatus; decision: DisputeDecision; adminNote: string | null };
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface SupportTicketDetail {
  ticket: SupportTicket;
  messages: TicketMessage[];
  audit: TicketAuditEntry[];
}

export type NotificationType =
  | 'new_order'
  | 'order_status'
  | 'payment'
  | 'low_stock'
  | 'return'
  | 'support_ticket'
  | 'announcement'
  | 'refund'
  | 'dispute'
  | 'account'
  | 'system';

/** Allowlisted reference types (DB-13). */
export type NotificationReferenceType = 'order' | 'product' | 'support_ticket' | 'return' | 'refund' | 'announcement' | 'store' | 'policy';

export interface Notification {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  referenceType: NotificationReferenceType | null;
  referenceId: string | null;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Generic                                                             */
/* ------------------------------------------------------------------ */

export interface Page<T> {
  items: T[];
  total: number;
}

/* ------------------------------------------------------------------ */
/* Customer addresses (customer_addresses)                              */
/* ------------------------------------------------------------------ */

export interface Address {
  id: UUID;
  customerId: UUID;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  district: string;
  postalCode: string | null;
  isDefault: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Returns and refunds (§14)                                            */
/* ------------------------------------------------------------------ */

export type ReturnReason = 'wrong_item' | 'damaged' | 'not_as_described' | 'change_of_mind' | 'other';
export type ReturnMethod = 'customer_drop_off' | 'merchant_coordinated';
export type DisputeStatus = 'none' | 'open' | 'info_requested' | 'resolved';
export type DisputeDecision = 'upheld' | 'overridden' | null;

export interface ReturnRequest {
  id: UUID;
  /** RET-YYYYMMDD-BHQXXXXXX (FR-RET-04) */
  returnNumber: string;
  orderId: UUID;
  orderNumber: string;
  storeId: UUID;
  storeName: string;
  customerId: UUID;
  customerName: string;
  reason: ReturnReason;
  conditionDescription: string;
  evidenceStoragePath: string | null;
  evidenceUrl: string | null;
  status: ReturnStatus;
  merchantResponse: string | null;
  returnMethod: ReturnMethod | null;
  refundAmountRequested: Money;
  createdAt: ISODateString;
  decidedAt: ISODateString | null;
  receivedAt: ISODateString | null;
  closedAt: ISODateString | null;
  /** FR-RET-09: customer escalation of a rejected return to Super Admin. */
  dispute: { status: DisputeStatus; escalatedAt: ISODateString | null; decision: DisputeDecision; adminNote: string | null };
}

export type RefundStatus = 'initiated' | 'processing' | 'completed' | 'failed';
export type RefundMethod = 'original_method' | 'bkash' | 'nagad' | 'rocket' | 'bank_transfer';

export interface RefundEvent {
  status: RefundStatus;
  actorName: string | null;
  note: string | null;
  createdAt: ISODateString;
}

export interface Refund {
  id: UUID;
  returnId: UUID;
  returnNumber: string;
  orderId: UUID;
  orderNumber: string;
  storeId: UUID;
  storeName: string;
  customerName: string;
  amount: Money;
  method: RefundMethod;
  status: RefundStatus;
  gatewayReference: string | null;
  /** Manual settlement evidence reference (FR-REF-02/03/07). */
  confirmationReference: string | null;
  initiatorId: UUID | null;
  initiatorName: string | null;
  processedAt: ISODateString | null;
  createdAt: ISODateString;
  /** Immutable history (FR-REF-06). */
  events: RefundEvent[];
}

/* ------------------------------------------------------------------ */
/* Platform administration (§12)                                        */
/* ------------------------------------------------------------------ */

export type AnnouncementAudience = 'all' | 'merchants' | 'customers';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'sent';

export interface Announcement {
  id: UUID;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  scheduledAt: ISODateString | null;
  sentAt: ISODateString | null;
  sentBy: UUID | null;
  sentByName: string | null;
  recipientCount: number | null;
  createdAt: ISODateString;
}

export type PolicyType = 'tos' | 'privacy';
export type PolicyStatus = 'pending_approval' | 'approved' | 'published' | 'archived';

export interface Policy {
  id: UUID;
  type: PolicyType;
  version: string;
  content: string;
  effectiveDate: string;
  submittedBy: UUID;
  submittedByName: string;
  approvedBy: UUID | null;
  approvedByName: string | null;
  approvedAt: ISODateString | null;
  publishedAt: ISODateString | null;
  status: PolicyStatus;
  createdAt: ISODateString;
}

export interface AuditLog {
  id: UUID;
  actorId: UUID | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
  createdAt: ISODateString;
}

export interface DeviceToken {
  id: UUID;
  userId: UUID;
  /** Masked; raw FCM tokens are never shown back to clients. */
  tokenHint: string;
  platform: 'android';
  createdAt: ISODateString;
  lastSeenAt: ISODateString;
}

export type HealthStatus = 'operational' | 'degraded' | 'outage';

export interface HealthComponent {
  key: 'web' | 'database' | 'storage' | 'auth' | 'edge_functions' | 'email' | 'sms' | 'push';
  name: string;
  status: HealthStatus;
  responseMs: number;
  errorRatePct: number;
  lastCheckedAt: ISODateString;
  note: string | null;
}

export interface SystemHealth {
  overall: HealthStatus;
  components: HealthComponent[];
  recentLogs: { id: string; level: 'info' | 'warn' | 'error'; component: string; message: string; createdAt: ISODateString }[];
}

export interface AdminMerchantRow {
  merchant: AccountUser;
  store: Store | null;
  productCount: number;
  orderCount: number;
  revenue: Money;
}

export interface AdminMerchantDetail extends AdminMerchantRow {
  recentOrders: Order[];
  openTickets: number;
  activeSessions: number;
}

export interface AdminCustomerRow {
  customer: AccountUser;
  orderCount: number;
  totalSpent: Money;
  lastOrderAt: ISODateString | null;
  addresses: number;
}

export interface AdminDashboard {
  merchants: MetricWithChange;
  activeStores: MetricWithChange;
  orders: MetricWithChange;
  revenue: MetricWithChange;
  customers: MetricWithChange;
  ordersByStatus: Record<OrderStatus, number>;
  series: SeriesPoint[];
  topMerchants: { storeId: UUID; storeName: string; revenue: Money; orders: number }[];
  paymentMethodBreakdown: { method: PaymentMethod; orders: number; revenue: Money }[];
  recentActivity: AuditLog[];
  openDisputes: number;
  stalledRefunds: number;
  health: HealthStatus;
}

export interface ThemeAdmin extends Theme {
  usedBy: { storeId: UUID; storeName: string }[];
  breakingChangeEffectiveAt: ISODateString | null;
  createdAt: ISODateString;
}

export type DisputeKind = 'ticket' | 'return';

export interface Dispute {
  kind: DisputeKind;
  id: UUID;
  reference: string;
  title: string;
  storeName: string | null;
  customerName: string;
  status: DisputeStatus;
  escalatedAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Storefront, cart, checkout, tracking (§11)                           */
/* ------------------------------------------------------------------ */

/** Public projection of a published store (no owner or credential data). */
export interface StorefrontStore {
  id: UUID;
  name: string;
  subdomain: string;
  tagline: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  brandColour: string;
  themeId: UUID | null;
  themeName: string | null;
  themeAccent: string | null;
  category: StoreCategory | null;
  returnWindowDays: number;
  shipping: ShippingSettings;
  enabledPaymentMethods: PaymentMethod[];
  /** Merchant contact for tracking pages (FR-C-25: phone/email only). */
  contact: { phone: string | null; email: string | null };
}

export interface StoreSearchResult {
  id: UUID;
  name: string;
  subdomain: string;
  tagline: string | null;
  logoUrl: string | null;
  brandColour: string;
  category: StoreCategory | null;
  productCount: number;
}

export type StorefrontSort = 'popular' | 'newest' | 'price_asc' | 'price_desc';

export interface StorefrontProductFilters {
  search?: string;
  categoryId?: string | 'all';
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  sort?: StorefrontSort;
}

export interface CartItem {
  productId: UUID;
  /** URL slug for links back to the product page. */
  slug?: string;
  variantId: UUID | null;
  name: string;
  variantLabel: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  /** Price when the item was added; compared with the current price (FR-C-12). */
  unitPrice: Money;
  quantity: number;
}

export interface Cart {
  storeId: UUID;
  subdomain: string;
  storeName: string;
  items: CartItem[];
  updatedAt: ISODateString;
}

export interface CartLineCheck {
  productId: UUID;
  variantId: UUID | null;
  available: boolean;
  availableStock: number;
  currentUnitPrice: Money;
  priceChanged: boolean;
  quantityCapped: boolean;
  quantity: number;
}

export interface CartValidation {
  lines: CartLineCheck[];
  subtotal: Money;
  deliveryCharge: Money;
  total: Money;
  hasChanges: boolean;
}

export interface CheckoutDelivery {
  recipientName: string;
  phone: string;
  email: string | null;
  address: string;
  district: string;
  postalCode: string | null;
}

export interface PlaceOrderInput {
  storeId: UUID;
  items: { productId: UUID; variantId: UUID | null; quantity: number; expectedUnitPrice: Money }[];
  delivery: CheckoutDelivery;
  paymentMethod: PaymentMethod;
  saveAddress: boolean;
  idempotencyKey: string;
}

export type CheckoutNextAction = 'none' | 'submit_wallet_reference' | 'redirect_sslcommerz';

export interface PlaceOrderResult {
  order: Order;
  payment: PaymentTransactionSummary | null;
  nextAction: CheckoutNextAction;
}

export interface TrackingResult {
  orderNumber: string;
  storeName: string;
  storeSubdomain: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: Pick<OrderItem, 'productName' | 'variantLabel' | 'quantity' | 'unitPrice' | 'subtotal'>[];
  subtotal: Money;
  deliveryCharge: Money;
  totalAmount: Money;
  deliveryAddress: DeliveryAddress;
  cancellationReason: string | null;
  events: Pick<DeliveryEvent, 'eventType' | 'createdAt'>[];
  merchantContact: { phone: string | null; email: string | null };
  createdAt: ISODateString;
  /** FR-C-29: delivered > 90 days ago; live tracking no longer available. */
  archived: boolean;
}

export interface CustomerOrderDetail extends OrderDetail {
  storeName: string;
  storeSubdomain: string;
  returnEligibility: { eligible: boolean; reason: string | null; windowEndsAt: ISODateString | null };
}
