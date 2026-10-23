/**
 * Supabase integration seam.
 *
 * Not implemented in this phase (mock data first). This module documents
 * exactly where each PlatformServices call goes so the adapter can be added
 * without touching UI code, and it guards against the most damaging
 * misconfiguration: shipping a service-role key to a client.
 */
import { ServiceError, type PlatformServices } from '../contracts';

export interface SupabaseClientConfig {
  url: string;
  /** Public anon key ONLY. Never the service-role key (§5.2, MOB-11). */
  anonKey: string;
  /**
   * Where supabase-js keeps the session. Android passes the Keystore-backed
   * vault so tokens never sit in localStorage/Preferences (AUTH-05, MOB-05);
   * the web uses supabase-js defaults with httpOnly cookie sessions planned for SSR.
   */
  authStorage?: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
}

/**
 * Rejects keys whose JWT payload says role=service_role. A cheap last line of
 * defence; the real control is never putting the key in client env vars.
 */
export function assertPublicAnonKey(key: string): void {
  const parts = key.split('.');
  if (parts.length !== 3) return; // new-style publishable keys are not JWTs
  try {
    const json = typeof atob === 'function' ? atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')) : '';
    const payload = JSON.parse(json) as { role?: string };
    // eslint-disable-next-line no-restricted-syntax -- this guard detects (never holds) a service-role key
    if (payload.role === 'service_role') {
      throw new ServiceError('FORBIDDEN', 'Refusing to start: a service-role key was supplied to a client build.');
    }
  } catch (e) {
    if (e instanceof ServiceError) throw e;
  }
}

/**
 * Operation → backend mapping (SRS §17.1 API IDs, §18 tables, RLS matrix).
 * "EF" = Supabase Edge Function / trusted server route; "RLS" = direct
 * PostgREST read allowed by RLS for the merchant's own store.
 */
export const SUPABASE_OPERATION_MAP = {
  'auth.signIn': 'supabase.auth.signInWithPassword; lockout/rate limit enforced server-side (AUTH-07)',
  'auth.register': 'API-01 POST /auth/register → supabase.auth.signUp; role set server-side (AUTHZ-01)',
  'auth.signInWithGoogle': 'supabase.auth.signInWithOAuth({ provider: "google" }); Android uses native Custom Tab (MOB-07)',
  'auth.changePassword': 'supabase.auth.updateUser + signOut({ scope: "others" }) (AUTH-06)',
  'auth.listSessions/terminateSession': 'EF using Auth admin API (FR-M-43)',
  'auth.beginTotpEnrollment': 'supabase.auth.mfa.enroll({ factorType: "totp" }) (AUTH-11)',
  'store.getMyStore': 'RLS select stores where owner_id = auth.uid()',
  'store.checkSubdomain': 'EF (reserved list + uniqueness, < 1 s, FR-M-06/07/08)',
  'store.createStore': 'EF (one store per owner, draft status, FR-M-09/10)',
  'store.uploadLogo': 'Storage store-logos/stores/{store_uuid}/logos/{file} via server upload authorizer',
  'store.publish': 'EF (100% checklist + ≥1 enabled payment method, FR-M-11/35)',
  'products.list/get': 'RLS select products/product_variants/product_images for own store',
  'products.create': 'API-12 POST /products (EF, stock model validation, DB-08)',
  'products.update': 'API-13 PATCH /products/{id} (EF; stock unchanged)',
  'products.remove': 'API-14 DELETE /products/{id} (soft delete)',
  'products.uploadImage': 'Storage product-images/stores/{store}/products/{product}/{file} via upload authorizer',
  'inventory.adjust': 'EF trusted inventory operation → inventory_movements append (FR-M-22-INV)',
  'inventory.movements': 'RLS select inventory_movements for own store',
  'orders.list/get': 'API-08 / RLS select orders, order_items, delivery_events, safe payment_transactions projection',
  'orders.updateStatus': 'API-09 PATCH /orders/{id}/status (EF, §13.1 transitions, delivery_events append)',
  'orders.cancel': 'API-10 POST /orders/{id}/cancel (EF, reason, idempotent stock release)',
  'orders.recordCodCollection': 'EF trusted COD collection (DM-05) → payment_status cod_collected',
  'customers.list/get': 'Derived from own-store orders (RLS) — no direct profiles access',
  'payments.list': 'EF safe projection of payment_configs (no credentials_encrypted)',
  'payments.saveCredentials': 'EF credential validation + encryption (FR-M-33/34, DB-05)',
  'analytics.dashboard': 'API-11 GET /merchant/dashboard (scoped analytics views)',
  'analytics.exportCsv': 'EF export (FR-M-38); large reports emailed',
  'support.list/get': 'RLS support_tickets/ticket_messages assigned to own store',
  'support.reply': 'API-19 POST /support-tickets/{id}/reply',
  'support.updateStatus': 'API-34 PATCH /support-tickets/{id}/workflow',
  'notifications.markRead': 'RLS update notifications set is_read (recipient only)',
  'notifications.subscribe': 'Supabase Realtime channel filtered by user_id',
  'orders.reviewPayment': 'EF manual payment review (Option B: pending_verification → paid|failed), audited',
  'orders.deliveryHistoryCsv': 'EF export of merchant-recorded delivery_events',
  'returns.list/get': 'RLS return_requests + refunds for own store',
  'returns.decide': 'API-16 PATCH /returns/{id} (EF, §14 transitions, reason on rejection)',
  'returns.confirmReceipt': 'EF receipt + optional restock → inventory_movements reason "return"',
  'returns.createRefund': 'API-17 POST /refunds (EF, one refund per return, amount ≤ order total)',
  'returns.recordRefundSettlement': 'API-42 EF manual settlement (reference required, idempotent)',
  // Customer (§11)
  'storefront.searchStores/resolveStore': 'API-05 public store discovery: published stores only; non-published → same NOT_FOUND',
  'storefront.listProducts/getProduct': 'API-06 public RLS select of active products for a published store',
  'storefront.validateCart': 'EF cart revalidation (price, stock, availability)',
  'storefront.trackOrder': 'API-21 EF public tracking (order number + phone, rate limited, privacy-preserving not-found)',
  'checkout.placeOrder': 'API-07 POST /orders (EF: idempotency key, atomic stock decrement, payment_transactions attempt)',
  'checkout.submitWalletReference': 'API-24 EF wallet reference submit → provider verify (credentials never leave the server)',
  'checkout.startSslcommerz': 'API-25 EF creates SSLCommerz session; IPN handled server-side (API-26)',
  'account.listOrders/getOrder': 'RLS select orders where customer_id = auth.uid()',
  'account.saveAddress': 'RLS insert/update addresses (max 3, one default — DB trigger)',
  'account.createReturn': 'API-15 POST /returns (EF re-checks 7-day window + one return per order)',
  'account.escalateReturn': 'EF dispute escalation → Super Admin queue',
  'account.createTicket/replyTicket': 'API-18/19 EF ticket routing (store vs platform queue, FR-SUP-03)',
  'account.deleteAccount': 'EF account deletion (anonymise, retain transaction history §20.6)',
  // Super Admin (§12) — every call passes the IP allowlist at the edge and requires an AAL2 (TOTP) session.
  'adminAuth.signIn/verifyTotp': 'supabase.auth.signInWithPassword + mfa.challengeAndVerify; IP allowlist at gateway (FR-SA-01/02)',
  'admin.dashboard/health': 'API-27 EF platform metrics + monitoring probes',
  'admin.suspendMerchant/reinstateMerchant': 'API-29/30 EF (reason, unpublish store, revoke sessions, audit_logs)',
  'admin.deleteMerchant': 'API-31 EF (confirmation phrase, retain transactions, audit)',
  'admin.listOrders/getOrder': 'EF read-only cross-store order view (no status changes)',
  'admin.saveTheme/deleteTheme': 'API-32 EF themes (delete blocked while in use; breaking change 7-day notice)',
  'admin.saveAnnouncement': 'API-33 EF announcements (draft/scheduled/sent; sent immutable)',
  'admin.submitPolicy/approvePolicy/publishPolicy': 'API-35 EF policies with dual approval (submitter ≠ approver, DB-12)',
  'admin.resolveDispute': 'API-36 EF dispute actions (audited)',
  'admin.interveneRefund': 'EF refund intervention (audited)',
  'admin.listAuditLogs': 'RLS select audit_logs (super_admin only, append-only)',
} as const;

export function createSupabaseServices(config: SupabaseClientConfig): PlatformServices {
  assertPublicAnonKey(config.anonKey);
  throw new ServiceError(
    'UNKNOWN',
    'The Supabase adapter is not implemented yet. Set NEXT_PUBLIC_DATA_SOURCE / VITE_DATA_SOURCE to "mock".',
  );
}
