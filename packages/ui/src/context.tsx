'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createServiceLayer, errorMessage, type PlatformServices, type ServiceLayer, type Notification, type Session } from '@bazarhq/shared';

/* ------------------------------ Services ----------------------------- */

const ServicesContext = createContext<PlatformServices | null>(null);

export function ServicesProvider({ services, children }: { services: PlatformServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** The brief's named services (authService, orderService, …) over the same implementation. */
export function useServiceLayer(): ServiceLayer {
  const services = useServices();
  return useMemo(() => createServiceLayer(services), [services]);
}

export function useServices(): PlatformServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}

/* ----------------------------- Navigation ---------------------------- */

export interface MerchantPaths {
  login: string;
  register: string;
  verifyEmail: string;
  forgotPassword: string;
  onboarding: string;
  onboardingStore: string;
  onboardingTheme: string;
  dashboard: string;
  products: string;
  productNew: string;
  product(id: string): string;
  inventory: string;
  inventoryFor(productId: string): string;
  orders: string;
  order(id: string): string;
  returns: string;
  returnDetail(id: string): string;
  customers: string;
  customer(id: string): string;
  analytics: string;
  paymentSettings: string;
  storeSettings: string;
  support: string;
  ticket(id: string): string;
  notifications: string;
  profile: string;
}

/** Customer-facing routes (storefront, checkout, account). */
export interface CustomerPaths {
  home: string;
  stores(q?: string): string;
  store(subdomain: string): string;
  storeProducts(subdomain: string, query?: string): string;
  /** `slug` from productSlug(); ids are accepted too. */
  product(subdomain: string, slug: string): string;
  storeCart(subdomain: string): string;
  storeCheckout(subdomain: string): string;
  orderSuccess(subdomain: string, orderNumber: string): string;
  carts: string;
  track(orderNumber?: string): string;
  sslSandbox(token: string): string;
  policy(type: 'tos' | 'privacy'): string;
  login(next?: string): string;
  register: string;
  verifyEmail: string;
  forgotPassword: string;
  account: string;
  orders: string;
  order(id: string): string;
  returns: string;
  returnDetail(id: string): string;
  support: string;
  ticket(id: string): string;
  newTicket(orderId?: string): string;
  notifications: string;
  profile: string;
  addresses: string;
  merchantLogin: string;
}

/** Super Admin routes. */
export interface AdminPaths {
  login: string;
  totp: string;
  dashboard: string;
  systemHealth: string;
  merchants: string;
  merchant(id: string): string;
  customers: string;
  customer(id: string): string;
  stores: string;
  orders: string;
  order(id: string): string;
  themes: string;
  announcements: string;
  policies: string;
  support: string;
  ticket(id: string): string;
  disputes: string;
  dispute(kind: 'return' | 'ticket', id: string): string;
  refunds: string;
  auditLogs: string;
  notifications: string;
  profile: string;
}

export type AppLinkComponent = ComponentType<{ href: string; className?: string; children: ReactNode; 'aria-label'?: string; onClick?: () => void }>;

interface NavigationValue {
  Link: AppLinkComponent;
  navigate: (href: string, opts?: { replace?: boolean }) => void;
  paths: MerchantPaths;
  customerPaths?: CustomerPaths;
  adminPaths?: AdminPaths;
  platform: 'web' | 'mobile';
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({ children, ...value }: NavigationValue & { children: ReactNode }) {
  const memo = useMemo(() => value, [value.Link, value.navigate, value.paths, value.customerPaths, value.adminPaths, value.platform]); // eslint-disable-line react-hooks/exhaustive-deps
  return <NavigationContext.Provider value={memo}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const v = useContext(NavigationContext);
  if (!v) throw new Error('useNavigation must be used inside <NavigationProvider>');
  return v;
}

export function useCustomerPaths(): CustomerPaths {
  const v = useNavigation();
  if (!v.customerPaths) throw new Error('customerPaths missing from <NavigationProvider>');
  return v.customerPaths;
}

export function useAdminPaths(): AdminPaths {
  const v = useNavigation();
  if (!v.adminPaths) throw new Error('adminPaths missing from <NavigationProvider>');
  return v.adminPaths;
}

export function customerNotificationHref(n: Pick<Notification, 'referenceType' | 'referenceId'>, p: CustomerPaths): string | null {
  if (!n.referenceId) return null;
  switch (n.referenceType) {
    case 'order':
      return p.order(n.referenceId);
    case 'return':
      return p.returnDetail(n.referenceId);
    case 'support_ticket':
      return p.ticket(n.referenceId);
    case 'refund':
      return p.returns;
    default:
      return null;
  }
}

export function adminNotificationHref(n: Pick<Notification, 'referenceType' | 'referenceId'>, p: AdminPaths): string | null {
  switch (n.referenceType) {
    case 'support_ticket':
      return n.referenceId ? p.ticket(n.referenceId) : p.support;
    case 'return':
      return n.referenceId ? p.dispute('return', n.referenceId) : p.disputes;
    case 'refund':
      return p.refunds;
    case 'policy':
      return p.policies;
    case 'order':
      return n.referenceId ? p.order(n.referenceId) : p.orders;
    case 'store':
      return p.merchants;
    default:
      return null;
  }
}

export function notificationHref(n: Pick<Notification, 'referenceType' | 'referenceId'>, paths: MerchantPaths): string | null {
  if (!n.referenceId) return n.referenceType === 'store' ? paths.paymentSettings : null;
  switch (n.referenceType) {
    case 'order':
      return paths.order(n.referenceId);
    case 'product':
      return paths.inventoryFor(n.referenceId);
    case 'support_ticket':
      return paths.ticket(n.referenceId);
    case 'return':
      return paths.returnDetail(n.referenceId);
    case 'refund':
      return paths.returns;
    case 'store':
      return paths.paymentSettings;
    default:
      return null;
  }
}

/* ------------------------------- Session ----------------------------- */

interface SessionValue {
  session: Session | null;
  status: 'loading' | 'ready';
  refresh: () => Promise<Session | null>;
  setSession: (s: Session | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  const refresh = useCallback(async () => {
    try {
      const s = await services.auth.getSession();
      setSession(s);
      return s;
    } catch {
      setSession(null);
      return null;
    } finally {
      setStatus('ready');
    }
  }, [services]);

  useEffect(() => {
    let alive = true;
    services.auth
      .getSession()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [services]);

  const signOut = useCallback(async () => {
    try {
      await services.auth.signOut();
    } finally {
      setSession(null);
    }
  }, [services]);

  const value = useMemo(() => ({ session, status, refresh, setSession, signOut }), [session, status, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

/* -------------------------------- Hooks ------------------------------ */

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** True while re-fetching with existing data shown. */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Minimal data hook: loading/error/empty states with retry. `deps` re-run the
 * loader; stale responses are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const run = useRef(0);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const execute = useCallback(async (mode: 'initial' | 'refresh') => {
    const id = ++run.current;
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (id === run.current) setDataState(result);
    } catch (e) {
      if (id === run.current) setError(errorMessage(e));
    } finally {
      if (id === run.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // Data fetching on dependency change is exactly what this hook is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void execute('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => execute('refresh'), [execute]);
  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, refreshing, reload, setData };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Unread notification count that follows the realtime-style subscription. */
export function useUnreadCount(): number {
  const services = useServices();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      services.notifications
        .unreadCount()
        .then((c) => alive && setCount(c))
        .catch(() => undefined);
    void load();
    const unsub = services.notifications.subscribe(() => void load());
    return () => {
      alive = false;
      unsub();
    };
  }, [services]);
  return count;
}

/** Re-run a callback whenever the service layer reports a write. */
export function useServiceEvents(callback: () => void) {
  const services = useServices();
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    const unsubscribe = services.notifications.subscribe(() => ref.current());
    // Revalidate after a tab/WebView returns to the foreground. Realtime keeps
    // both clients live while connected; this catches changes made while asleep.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [services]);
}
