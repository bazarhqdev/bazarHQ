import type { AdminPaths, CustomerPaths, MerchantPaths } from '@bazarhq/ui';

export const paths: MerchantPaths = {
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  forgotPassword: '/forgot-password',
  onboarding: '/onboarding',
  onboardingStore: '/onboarding/store',
  onboardingTheme: '/onboarding/theme',
  dashboard: '/home',
  products: '/products',
  productNew: '/products/new',
  product: (id) => `/products/${id}`,
  inventory: '/inventory',
  inventoryFor: (productId) => `/inventory?product=${productId}`,
  orders: '/orders',
  order: (id) => `/orders/${id}`,
  returns: '/returns',
  returnDetail: (id) => `/returns/${id}`,
  customers: '/orders',
  customer: () => '/orders',
  analytics: '/analytics',
  paymentSettings: '/payments',
  storeSettings: '/settings',
  support: '/support',
  ticket: (id) => `/support/${id}`,
  notifications: '/notifications',
  profile: '/settings',
};

const qs = (k: string, v?: string | null) => (v ? `?${k}=${encodeURIComponent(v)}` : '');

/** Customer stack (prefix /c). Store screens live under /c/s/<subdomain>. */
export const customerPaths: CustomerPaths = {
  home: '/c',
  stores: (q) => `/c/stores${qs('q', q)}`,
  store: (sub) => `/c/s/${sub}`,
  storeProducts: (sub, query) => `/c/s/${sub}/products${query ? `?${query}` : ''}`,
  product: (sub, slug) => `/c/s/${sub}/p/${slug}`,
  storeCart: (sub) => `/c/s/${sub}/cart`,
  storeCheckout: (sub) => `/c/s/${sub}/checkout`,
  orderSuccess: (sub, orderNumber) => `/c/s/${sub}/success${qs('order', orderNumber)}`,
  carts: '/c/cart',
  track: (orderNumber) => `/c/track${qs('order', orderNumber)}`,
  sslSandbox: (token) => `/c/pay/ssl${qs('session', token)}`,
  policy: (type) => `/c/policy/${type}`,
  login: (next) => `/c/login${qs('next', next)}`,
  register: '/c/register',
  verifyEmail: '/c/verify-email',
  forgotPassword: '/c/forgot-password',
  account: '/c/account',
  orders: '/c/orders',
  order: (id) => `/c/orders/${id}`,
  returns: '/c/returns',
  returnDetail: (id) => `/c/returns/${id}`,
  support: '/c/support',
  ticket: (id) => `/c/support/${id}`,
  newTicket: (orderId) => `/c/support/new${qs('order', orderId)}`,
  notifications: '/c/notifications',
  profile: '/c/profile',
  addresses: '/c/addresses',
  merchantLogin: '/login',
};

/** Super Admin stack (prefix /a). The mock enforces TOTP + idle-timeout rules like the web. */
export const adminPaths: AdminPaths = {
  login: '/a/login',
  totp: '/a/totp',
  dashboard: '/a/dashboard',
  systemHealth: '/a/health',
  merchants: '/a/merchants',
  merchant: (id) => `/a/merchants/${id}`,
  customers: '/a/customers',
  customer: (id) => `/a/customers/${id}`,
  stores: '/a/stores',
  orders: '/a/orders',
  order: (id) => `/a/orders/${id}`,
  themes: '/a/themes',
  announcements: '/a/announcements',
  policies: '/a/policies',
  support: '/a/support',
  ticket: (id) => `/a/support/${id}`,
  disputes: '/a/disputes',
  dispute: (kind, id) => `/a/disputes/${kind}/${id}`,
  refunds: '/a/refunds',
  auditLogs: '/a/audit',
  notifications: '/a/notifications',
  profile: '/a/profile',
};

/** Screens where the Android back button exits the app (MOB-17). */
export const ROOT_SCREENS = ['/', '/welcome', '/home', '/login', '/onboarding', '/c', '/c/login', '/a/dashboard', '/a/login'];

export const ROLE_START = { merchant: '/home', customer: '/c', super_admin: '/a/dashboard' } as const;
