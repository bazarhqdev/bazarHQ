import type {
  AnnouncementAudience,
  AnnouncementStatus,
  DisputeStatus,
  HealthStatus,
  InventoryReason,
  PolicyStatus,
  PolicyType,
  RefundMethod,
  RefundStatus,
  ReturnMethod,
  ReturnReason,
  Role,
  NotificationType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  ReturnStatus,
  StoreCategory,
  StoreStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../types';

/** Canonical order statuses (SRS §13.1). Order matters: it is the forward path. */
export const ORDER_STATUSES: readonly OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'] as const;

/** Canonical payment statuses (SRS §13.1). */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pending',
  'pending_verification',
  'paid',
  'failed',
  'cod_pending',
  'cod_collected',
  'refunded',
] as const;

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['bkash', 'nagad', 'rocket', 'sslcommerz', 'cod'] as const;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending',
  pending_verification: 'Awaiting verification',
  paid: 'Paid',
  failed: 'Failed',
  cod_pending: 'COD pending',
  cod_collected: 'COD collected',
  refunded: 'Refunded',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  sslcommerz: 'SSLCommerz',
  cod: 'Cash on Delivery',
};

export const PAYMENT_METHOD_DESCRIPTION: Record<PaymentMethod, string> = {
  bkash: 'Mobile wallet payments, verified server-side.',
  nagad: 'Mobile wallet payments, verified server-side.',
  rocket: 'Mobile wallet payments, verified server-side.',
  sslcommerz: 'Cards and other channels via the SSLCommerz gateway.',
  cod: 'Customer pays cash on delivery; you record collection.',
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  inactive: 'Hidden',
};

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  suspended: 'Suspended',
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Return requested',
  approved: 'Return approved',
  rejected: 'Return rejected',
  received: 'Return received',
  closed: 'Return closed',
};

export const INVENTORY_REASON_LABEL: Record<InventoryReason, string> = {
  sale: 'Sale',
  return: 'Return',
  manual_adjustment: 'Manual adjustment',
  cancellation_release: 'Cancellation release',
  payment_failure_release: 'Payment failure release',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_for_customer: 'Waiting for customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  order_issue: 'Order issue',
  payment_issue: 'Payment issue',
  delivery_issue: 'Delivery issue',
  return_refund: 'Return / refund',
  account_issue: 'Account issue',
  other: 'Other',
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
};

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  new_order: 'New order',
  order_status: 'Order update',
  payment: 'Payment',
  low_stock: 'Low stock',
  return: 'Return',
  support_ticket: 'Support',
  announcement: 'Announcement',
  refund: 'Refund',
  dispute: 'Dispute',
  account: 'Account',
  system: 'System',
};

export const STORE_CATEGORY_LABEL: Record<StoreCategory, string> = {
  groceries: 'Groceries & Fresh Food',
  fashion: 'Fashion & Apparel',
  electronics: 'Electronics & Gadgets',
  home_living: 'Home & Living',
  health_beauty: 'Health & Beauty',
  books_stationery: 'Books & Stationery',
  other: 'Other',
};

/** FR-M-08 reserved subdomain words (kept in configuration). */
export const RESERVED_SUBDOMAINS: readonly string[] = ['admin', 'api', 'www', 'app', 'mail', 'help', 'support', 'static'] as const;

export const PLATFORM_DOMAIN = 'bazarhq.com';

export const LIMITS = {
  /** FR-M-13 / FR-M-16 */
  imageMaxBytes: 2 * 1024 * 1024,
  imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  /** FR-SUP-01 */
  attachmentMaxBytes: 5 * 1024 * 1024,
  attachmentMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'] as readonly string[],
  /** AUTH-01 */
  passwordMinLength: 8,
  /** AUTH-07 */
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  /** FR-M-45 default */
  defaultReturnWindowDays: 7,
  /** UI sanity bound only; the server is authoritative. */
  maxReturnWindowDays: 90,
  maxProductImages: 8,
  /** numeric(12,2) */
  maxMoney: 9_999_999_999.99,
  /** FR-C-06 storefront warning threshold, reused as the default low-stock threshold. */
  defaultLowStockThreshold: 5,
} as const;

export const BRAND_COLOUR_PRESETS: readonly string[] = ['#059669', '#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#D97706', '#0B1F3A'] as const;

/** Bangladesh districts (subset used for analytics/demo; full list belongs to server config). */
export const DHAKA_DISTRICT = 'Dhaka';

/* ------------------------------ Roles ------------------------------- */

/** Three active roles in V2.1. Delivery Agent is deferred to V3.0 (§2.2). */
export const ROLES: readonly Role[] = ['customer', 'merchant', 'super_admin'] as const;

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  merchant: 'Merchant',
  super_admin: 'Super Admin',
};

/** ASM-01: 11-digit Bangladeshi mobile number. */
export const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

export const CURRENCY = { code: 'BDT', symbol: '৳', locale: 'en-IN' } as const;
export const TIMEZONE = 'Asia/Dhaka';

/* ------------------------- Returns and refunds ----------------------- */

export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'closed'] as const;
export const REFUND_STATUSES: readonly RefundStatus[] = ['initiated', 'processing', 'completed', 'failed'] as const;

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  wrong_item: 'Wrong item received',
  damaged: 'Damaged on arrival',
  not_as_described: 'Not as described',
  change_of_mind: 'Changed my mind',
  other: 'Other',
};

export const RETURN_METHOD_LABEL: Record<ReturnMethod, string> = {
  customer_drop_off: 'Customer drop-off',
  merchant_coordinated: 'Merchant-coordinated pickup',
};

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  initiated: 'Refund initiated',
  processing: 'Refund processing',
  completed: 'Refund completed',
  failed: 'Refund failed',
};

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  original_method: 'Original payment method',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  bank_transfer: 'Bank transfer',
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  none: 'No dispute',
  open: 'Escalated',
  info_requested: 'More info requested',
  resolved: 'Resolved',
};

/* --------------------------- Administration -------------------------- */

export const POLICY_TYPE_LABEL: Record<PolicyType, string> = { tos: 'Terms of Service', privacy: 'Privacy Policy' };
export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  pending_approval: 'Awaiting second approval',
  approved: 'Approved — not yet published',
  published: 'Published',
  archived: 'Superseded',
};
export const ANNOUNCEMENT_STATUS_LABEL: Record<AnnouncementStatus, string> = { draft: 'Draft', scheduled: 'Scheduled', sent: 'Sent' };
export const ANNOUNCEMENT_AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: 'All merchants and customers',
  merchants: 'All merchants',
  customers: 'All customers',
};
export const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = { operational: 'Operational', degraded: 'Degraded', outage: 'Outage' };

export const ADMIN_LIMITS = {
  /** AUTH-10 / FR-SA-03 */
  idleTimeoutMinutes: 30,
  /** FR-SUP-10 */
  ticketEscalationHours: 72,
  /** FR-SUP-04 */
  ticketReopenDays: 7,
  /** FR-SA-15 */
  breakingThemeNoticeDays: 7,
  /** FR-C-29 */
  trackingArchiveDays: 90,
  /** FR-C-33 */
  maxSavedAddresses: 3,
  /** API-32 rate limit per minute (mock) */
  trackingAttemptsPerMinute: 10,
} as const;

export const BD_DISTRICTS: readonly string[] = [
  'Bagerhat',
  'Bandarban',
  'Barguna',
  'Barishal',
  'Bhola',
  'Bogura',
  'Brahmanbaria',
  'Chandpur',
  'Chapai Nawabganj',
  'Chattogram',
  'Chuadanga',
  "Cox's Bazar",
  'Cumilla',
  'Dhaka',
  'Dinajpur',
  'Faridpur',
  'Feni',
  'Gaibandha',
  'Gazipur',
  'Gopalganj',
  'Habiganj',
  'Jamalpur',
  'Jashore',
  'Jhalokati',
  'Jhenaidah',
  'Joypurhat',
  'Khagrachhari',
  'Khulna',
  'Kishoreganj',
  'Kurigram',
  'Kushtia',
  'Lakshmipur',
  'Lalmonirhat',
  'Madaripur',
  'Magura',
  'Manikganj',
  'Meherpur',
  'Moulvibazar',
  'Munshiganj',
  'Mymensingh',
  'Naogaon',
  'Narail',
  'Narayanganj',
  'Narsingdi',
  'Natore',
  'Netrokona',
  'Nilphamari',
  'Noakhali',
  'Pabna',
  'Panchagarh',
  'Patuakhali',
  'Pirojpur',
  'Rajbari',
  'Rajshahi',
  'Rangamati',
  'Rangpur',
  'Satkhira',
  'Shariatpur',
  'Sherpur',
  'Sirajganj',
  'Sunamganj',
  'Sylhet',
  'Tangail',
  'Thakurgaon',
];
