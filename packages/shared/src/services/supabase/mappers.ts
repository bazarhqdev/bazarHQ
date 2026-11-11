/**
 * Row → domain mappers. Column names follow the migrations exactly
 * (snake_case); domain types are the camelCase projections in ../../types.
 */
import type {
  Address,
  Announcement,
  AuditLog,
  Category,
  DeliveryAddress,
  DeliveryEvent,
  Notification,
  Order,
  OrderItem,
  PaymentConfig,
  PaymentTransactionSummary,
  Policy,
  Product,
  Refund,
  RefundEvent,
  ReturnRequest,
  Store,
  StorefrontStore,
  SupportTicket,
  Theme,
} from '../../types';

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped JSON from PostgREST; every field is narrowed here */
type Row = Record<string, any>;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const STORE_COLUMNS =
  'id, owner_id, name, subdomain, status, theme_id, brand_colour, tagline, logo_url, return_window_days, created_at, updated_at, category, banner_url, shipping_settings, notification_preferences';

export function mapStore(r: Row, urls: { logo?: string | null; banner?: string | null } = {}): Store {
  const ship = (r.shipping_settings ?? {}) as Row;
  const prefs = (r.notification_preferences ?? {}) as Row;
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    subdomain: r.subdomain,
    status: r.status,
    themeId: r.theme_id ?? null,
    brandColour: r.brand_colour,
    tagline: r.tagline ?? null,
    logoUrl: urls.logo ?? null,
    returnWindowDays: num(r.return_window_days),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    extensions: {
      category: r.category ?? null,
      bannerUrl: urls.banner ?? null,
      shipping: {
        insideDhakaCharge: num(ship.inside_dhaka_charge ?? 60),
        outsideDhakaCharge: num(ship.outside_dhaka_charge ?? 120),
        estimatedDaysInsideDhaka: num(ship.estimated_days_inside_dhaka ?? 2),
        estimatedDaysOutsideDhaka: num(ship.estimated_days_outside_dhaka ?? 4),
      },
      notificationPreferences: {
        newOrderEmail: prefs.new_order_email !== false,
        newOrderSms: prefs.new_order_sms === true,
        lowStockEmail: prefs.low_stock_email !== false,
        supportTicketEmail: prefs.support_ticket_email !== false,
      },
    },
  };
}

export function mapStorefrontStore(r: Row, urls: { logo?: string | null; banner?: string | null }, contact: StorefrontStore['contact']): StorefrontStore {
  const ship = (r.shipping ?? r.shipping_settings ?? {}) as Row;
  return {
    id: r.id,
    name: r.name,
    subdomain: r.subdomain,
    tagline: r.tagline ?? null,
    logoUrl: urls.logo ?? null,
    bannerUrl: urls.banner ?? null,
    brandColour: r.brand_colour,
    themeId: r.theme_id ?? null,
    themeName: r.theme_name ?? null,
    themeAccent: r.theme_accent ?? null,
    category: r.category ?? null,
    returnWindowDays: num(r.return_window_days),
    shipping: {
      insideDhakaCharge: num(ship.inside_dhaka_charge ?? 60),
      outsideDhakaCharge: num(ship.outside_dhaka_charge ?? 120),
      estimatedDaysInsideDhaka: num(ship.estimated_days_inside_dhaka ?? 2),
      estimatedDaysOutsideDhaka: num(ship.estimated_days_outside_dhaka ?? 4),
    },
    enabledPaymentMethods: (r.enabled_payment_methods ?? []) as StorefrontStore['enabledPaymentMethods'],
    contact,
  };
}

export const PRODUCT_COLUMNS =
  'id, store_id, name, description, category_id, base_price, product_type, stock_quantity, low_stock_threshold, status, sku, compare_at_price, created_at, updated_at, deleted_at, ' +
  'product_images(id, product_id, storage_path, is_primary, display_order), ' +
  'product_variants(id, product_id, variant_label, price_adjustment, stock_quantity, status, created_at)';

export function productImagePaths(rows: Row[]): string[] {
  return rows.flatMap((p) => ((p.product_images ?? []) as Row[]).map((i) => i.storage_path as string));
}

export function mapProduct(r: Row, urls: Map<string, string>): Product {
  const images = ((r.product_images ?? []) as Row[])
    .sort((a, b) => num(a.display_order) - num(b.display_order))
    .map((i) => ({
      id: i.id,
      productId: i.product_id,
      storagePath: i.storage_path,
      url: urls.get(i.storage_path) ?? null,
      isPrimary: !!i.is_primary,
      displayOrder: num(i.display_order),
    }));
  const variants = ((r.product_variants ?? []) as Row[])
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map((v) => ({
      id: v.id,
      productId: v.product_id,
      variantLabel: v.variant_label,
      priceAdjustment: num(v.price_adjustment),
      stockQuantity: num(v.stock_quantity),
      status: v.status,
    }));
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    description: r.description,
    categoryId: r.category_id ?? null,
    basePrice: num(r.base_price),
    productType: r.product_type,
    stockQuantity: r.product_type === 'simple' ? num(r.stock_quantity) : null,
    lowStockThreshold: num(r.low_stock_threshold),
    status: r.status,
    images,
    variants,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    extensions: { sku: r.sku ?? null, compareAtPrice: numOrNull(r.compare_at_price) },
  };
}

export const ORDER_COLUMNS =
  'id, order_number, store_id, customer_id, order_phone, order_email, status, payment_method, payment_status, subtotal, delivery_charge, total_amount, currency, ' +
  'delivery_address, cancellation_reason, is_test, test_reason, test_marked_at, created_at, updated_at, delivered_at, ' +
  'order_items(id, order_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, subtotal, created_at)';

export function mapDeliveryAddress(a: Row | null | undefined, phone: string): DeliveryAddress {
  const x = a ?? {};
  return {
    recipientName: x.recipient_name ?? '',
    phone: x.phone ?? phone,
    address: x.address ?? '',
    district: x.district ?? '',
    postalCode: x.postal_code ?? null,
  };
}

export function mapOrderItem(i: Row): OrderItem {
  return {
    id: i.id,
    orderId: i.order_id,
    productId: i.product_id,
    variantId: i.variant_id ?? null,
    productName: i.product_name,
    variantLabel: i.variant_label ?? null,
    quantity: num(i.quantity),
    unitPrice: num(i.unit_price),
    subtotal: num(i.subtotal),
  };
}

export function mapOrder(r: Row, items?: Row[]): Order {
  const address = mapDeliveryAddress(r.delivery_address, r.order_phone);
  return {
    id: r.id,
    orderNumber: r.order_number,
    storeId: r.store_id,
    customerId: r.customer_id ?? null,
    customerName: address.recipientName || 'Customer',
    orderPhone: r.order_phone,
    orderEmail: r.order_email ?? null,
    status: r.status,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    isTest: r.is_test === true,
    testReason: r.test_reason ?? null,
    testMarkedAt: r.test_marked_at ?? null,
    subtotal: num(r.subtotal),
    deliveryCharge: num(r.delivery_charge),
    totalAmount: num(r.total_amount),
    currency: 'BDT',
    deliveryAddress: address,
    cancellationReason: r.cancellation_reason ?? null,
    items: ((items ?? r.order_items ?? []) as Row[])
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      .map(mapOrderItem),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapDeliveryEvent(r: Row, actorName: string | null = null): DeliveryEvent {
  return {
    id: r.id,
    orderId: r.order_id,
    actorId: r.actor_id ?? null,
    actorName,
    eventType: r.event_type,
    notes: r.notes ?? null,
    proofImagePath: r.proof_image_path ?? null,
    codAmount: numOrNull(r.cod_amount),
    createdAt: r.created_at,
  };
}

export const PAYMENT_COLUMNS = 'id, order_id, method, provider, status, amount, currency, provider_transaction_reference, created_at, verified_at';

export function mapPayment(r: Row): PaymentTransactionSummary {
  const ref = str(r.provider_transaction_reference);
  return {
    id: r.id,
    orderId: r.order_id,
    method: r.method,
    provider: r.provider,
    status: r.status,
    amount: num(r.amount),
    currency: 'BDT',
    providerReferenceMasked: r.provider_reference_masked ?? (ref ? `••••${ref.slice(-4)}` : null),
    createdAt: r.created_at,
    verifiedAt: r.verified_at ?? null,
  };
}

export function mapPaymentConfig(r: Row): PaymentConfig {
  return {
    id: r.id ?? `${r.store_id ?? 'store'}:${r.method}`,
    storeId: r.store_id ?? '',
    method: r.method,
    isEnabled: !!r.is_enabled,
    hasCredentials: !!r.has_credentials,
    credentialHint: r.credential_hint ? `••••${String(r.credential_hint).slice(-4)}` : null,
    environment: r.environment === 'live' ? 'live' : 'sandbox',
    validation: r.validation ?? (r.method === 'cod' ? 'not_required' : 'unverified'),
    updatedAt: r.updated_at ?? null,
  };
}

export const RETURN_COLUMNS =
  'id, return_number, order_id, customer_id, reason, condition_description, evidence_storage_path, status, merchant_response, return_method, refund_amount_requested, ' +
  'created_at, decided_at, received_at, closed_at, dispute_status, dispute_decision, dispute_admin_note, escalated_at, ' +
  'order:orders!inner(id, order_number, store_id, total_amount, delivery_address, order_phone, store:stores(id, name))';

export function mapReturn(r: Row, evidenceUrl: string | null = null): ReturnRequest {
  const order = (r.order ?? {}) as Row;
  return {
    id: r.id,
    returnNumber: r.return_number,
    orderId: r.order_id,
    orderNumber: order.order_number ?? '',
    storeId: order.store_id ?? order.store?.id ?? '',
    storeName: order.store?.name ?? '',
    customerId: r.customer_id,
    customerName: mapDeliveryAddress(order.delivery_address, order.order_phone ?? '').recipientName || 'Customer',
    reason: r.reason,
    conditionDescription: r.condition_description,
    evidenceStoragePath: r.evidence_storage_path ?? null,
    evidenceUrl,
    status: r.status,
    merchantResponse: r.merchant_response ?? null,
    returnMethod: r.return_method ?? null,
    refundAmountRequested: r.refund_amount_requested !== null && r.refund_amount_requested !== undefined ? num(r.refund_amount_requested) : num(order.total_amount),
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? null,
    receivedAt: r.received_at ?? null,
    closedAt: r.closed_at ?? null,
    dispute: {
      status: r.dispute_status ?? 'none',
      escalatedAt: r.escalated_at ?? null,
      decision: r.dispute_decision ?? null,
      adminNote: r.dispute_admin_note ?? null,
    },
  };
}

export const REFUND_COLUMNS =
  'id, return_id, amount, method, status, gateway_reference, confirmation_reference, initiator_id, processed_at, created_at, ' +
  'return:returns!inner(id, return_number, order_id, order:orders!inner(id, order_number, store_id, delivery_address, order_phone, store:stores(id, name)))';

export function mapRefund(r: Row, events: RefundEvent[] = [], initiatorName: string | null = null): Refund {
  const ret = (r.return ?? {}) as Row;
  const order = (ret.order ?? {}) as Row;
  return {
    id: r.id,
    returnId: r.return_id,
    returnNumber: ret.return_number ?? '',
    orderId: ret.order_id ?? order.id ?? '',
    orderNumber: order.order_number ?? '',
    storeId: order.store_id ?? '',
    storeName: order.store?.name ?? '',
    customerName: mapDeliveryAddress(order.delivery_address, order.order_phone ?? '').recipientName || 'Customer',
    amount: num(r.amount),
    method: r.method,
    status: r.status,
    gatewayReference: r.gateway_reference ?? null,
    confirmationReference: r.confirmation_reference ?? null,
    initiatorId: r.initiator_id ?? null,
    initiatorName,
    processedAt: r.processed_at ?? null,
    createdAt: r.created_at,
    events,
  };
}

export const TICKET_COLUMNS =
  'id, ticket_number, queue, customer_id, store_id, order_id, category, subject, description, priority, status, assigned_to, resolution_note, ' +
  'first_merchant_response_at, escalation_at, closed_at, dispute_status, dispute_decision, dispute_admin_note, created_at, updated_at, ' +
  'store:stores(name), order:orders(order_number)';

export function mapTicket(r: Row, customerName: string): SupportTicket {
  return {
    id: r.id,
    queue: r.queue,
    storeName: r.store?.name ?? null,
    ticketNumber: r.ticket_number,
    customerId: r.customer_id,
    customerName,
    storeId: r.store_id ?? null,
    orderId: r.order_id ?? null,
    orderNumber: r.order?.order_number ?? null,
    category: r.category,
    subject: r.subject,
    description: r.description,
    priority: r.priority,
    status: r.status,
    assignedTo: r.assigned_to ?? null,
    resolutionNote: r.resolution_note ?? null,
    firstMerchantResponseAt: r.first_merchant_response_at ?? null,
    escalationAt: r.escalation_at ?? null,
    closedAt: r.closed_at ?? null,
    dispute: { status: r.dispute_status ?? 'none', decision: r.dispute_decision ?? null, adminNote: r.dispute_admin_note ?? null },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapNotification(r: Row): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    body: r.body ?? '',
    isRead: !!r.is_read,
    referenceType: r.reference_type ?? null,
    referenceId: r.reference_id ?? null,
    createdAt: r.created_at,
  };
}

export function mapAddress(r: Row): Address {
  return {
    id: r.id,
    customerId: r.customer_id,
    label: r.label,
    recipientName: r.recipient_name,
    phone: r.phone,
    address: r.address,
    district: r.district,
    postalCode: r.postal_code ?? null,
    isDefault: !!r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapCategory(r: Row): Category {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    slug: r.slug,
    parentId: r.parent_id ?? null,
    displayOrder: num(r.display_order),
  };
}

export function mapTheme(r: Row): Theme {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    previewUrl: r.preview_url ?? null,
    isActive: !!r.is_active,
    accent: r.accent ?? '#059669',
  };
}

export function mapAnnouncement(r: Row, names: Map<string, string>): Announcement {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    audience: r.audience,
    status: r.status,
    scheduledAt: r.scheduled_at ?? null,
    sentAt: r.sent_at ?? null,
    sentBy: r.sent_by ?? null,
    sentByName: r.sent_by ? (names.get(r.sent_by) ?? null) : null,
    recipientCount: r.recipient_count ?? null,
    createdAt: r.created_at,
  };
}

export function mapPolicy(r: Row, names: Map<string, string>): Policy {
  return {
    id: r.id,
    type: r.type,
    version: r.version,
    content: r.content,
    effectiveDate: r.effective_date,
    submittedBy: r.submitted_by,
    submittedByName: names.get(r.submitted_by) ?? 'Super Admin',
    approvedBy: r.approved_by ?? null,
    approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
    approvedAt: r.approved_at ?? null,
    publishedAt: r.published_at ?? null,
    status: r.status === 'draft' ? 'pending_approval' : r.status,
    createdAt: r.created_at,
  };
}

export function mapAuditLog(r: Row, names: Map<string, string>): AuditLog {
  const meta: AuditLog['metadata'] = {};
  for (const [k, v] of Object.entries((r.metadata ?? {}) as Row)) {
    meta[k] = v === null || ['string', 'number', 'boolean'].includes(typeof v) ? (v as string | number | boolean | null) : JSON.stringify(v);
  }
  return {
    id: r.id,
    actorId: r.actor_id ?? null,
    actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : 'System',
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id ?? null,
    metadata: meta,
    ipAddress: r.ip_address ?? null,
    createdAt: r.created_at,
  };
}
