/**
 * The named service layer from the project brief (authService, orderService, …).
 *
 * It is a thin, typed view over PlatformServices, so the same mock or Supabase
 * implementation backs both shapes and page components never change when the
 * data source does. Each name groups the operations of one domain; the
 * underlying functions are shared, not copied.
 */
import type {
  AdminAuthService,
  AdminService,
  AnalyticsService,
  AuthService,
  CheckoutService,
  CustomerAccountService,
  CustomerService,
  InventoryService,
  MerchantReturnService,
  NotificationService,
  OrderService,
  PaymentConfigService,
  PlatformServices,
  ProductService,
  StorefrontService,
  StoreService,
  SupportService,
} from './contracts';

export interface ServiceLayer {
  /** Sign-in, registration, verification, password, profile, sessions (Customer + Merchant). */
  authService: AuthService;
  /** The signed-in merchant's own store (onboarding, settings, publishing) and its customer list. */
  merchantService: StoreService & { customers: CustomerService };
  /** The signed-in customer's orders, addresses, returns, tickets and account deletion. */
  customerService: CustomerAccountService;
  /** Super Admin operations plus the admin sign-in (network + TOTP + idle). */
  adminService: AdminService & { auth: AdminAuthService };
  /** Public, store-scoped reads: discovery, storefront, products, cart checks, tracking, policies. */
  storeService: StorefrontService;
  productService: ProductService;
  inventoryService: InventoryService;
  orderService: OrderService;
  /** Merchant payment configuration plus the customer payment flows (order placement, wallet reference, SSLCommerz). */
  paymentService: PaymentConfigService & { checkout: CheckoutService };
  /** Merchant return review and the customer return request/escalation. */
  returnService: Pick<MerchantReturnService, 'list' | 'get' | 'decide' | 'setReturnMethod' | 'confirmReceipt'> & {
    request: CustomerAccountService['createReturn'];
    escalate: CustomerAccountService['escalateReturn'];
    mine: CustomerAccountService['listReturns'];
  };
  /** Refund creation/settlement (merchant) and audited intervention (Super Admin). */
  refundService: Pick<MerchantReturnService, 'createRefund' | 'markRefundProcessing' | 'recordRefundSettlement' | 'markRefundFailed'> & {
    adminList: AdminService['listRefunds'];
    adminIntervene: AdminService['interveneRefund'];
  };
  /** Merchant ticket inbox; customers use customerService.createTicket/replyTicket, admins adminService.*Ticket. */
  supportService: SupportService;
  notificationService: NotificationService;
  analyticsService: AnalyticsService;
}

export function createServiceLayer(p: PlatformServices): ServiceLayer {
  return {
    authService: p.auth,
    merchantService: { ...p.store, customers: p.customers },
    customerService: p.account,
    adminService: { ...p.admin, auth: p.adminAuth },
    storeService: p.storefront,
    productService: p.products,
    inventoryService: p.inventory,
    orderService: p.orders,
    paymentService: { ...p.payments, checkout: p.checkout },
    returnService: {
      list: p.returns.list,
      get: p.returns.get,
      decide: p.returns.decide,
      setReturnMethod: p.returns.setReturnMethod,
      confirmReceipt: p.returns.confirmReceipt,
      request: p.account.createReturn,
      escalate: p.account.escalateReturn,
      mine: p.account.listReturns,
    },
    refundService: {
      createRefund: p.returns.createRefund,
      markRefundProcessing: p.returns.markRefundProcessing,
      recordRefundSettlement: p.returns.recordRefundSettlement,
      markRefundFailed: p.returns.markRefundFailed,
      adminList: p.admin.listRefunds,
      adminIntervene: p.admin.interveneRefund,
    },
    supportService: p.support,
    notificationService: p.notifications,
    analyticsService: p.analytics,
  };
}
