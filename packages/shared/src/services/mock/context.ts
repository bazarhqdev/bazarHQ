/**
 * Shared state and guards for the mock "server". Every role's mock service
 * module (merchant, storefront, customer account, admin) is built on this.
 *
 * It behaves like the trusted server: re-validates role, status, email
 * verification, tenancy and (for Super Admin) TOTP + idle timeout.
 */
import { ADMIN_LIMITS, PAYMENT_METHODS } from '../../constants';
import type { AuditLog, Order, OrderDetail, PaymentConfig, Product, ReturnRequest, Session, Store, StorefrontStore } from '../../types';
import { ServiceError } from '../contracts';
import { createSeed, MOCK_DB_VERSION, uuidFrom, type MockDb, type MockUser, type StoredProduct } from './seed';

export interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockOptions {
  /** [min, max] simulated latency in ms. */
  latencyMs?: [number, number];
  storage?: MockStorage | null;
  storageKey?: string;
  now?: () => Date;
}

function browserStorage(): MockStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const k = '__bhq_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

export const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export type NotificationDraft = Omit<MockDb['notifications'][number], 'id' | 'userId' | 'isRead' | 'createdAt'>;

export function createMockContext(options: MockOptions = {}) {
  const storageKey = options.storageKey ?? 'bazarhq.mock';
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const [minLat, maxLat] = options.latencyMs ?? [180, 520];
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  let state: MockDb = load();

  function load(): MockDb {
    try {
      const raw = storage?.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as MockDb;
        if (parsed.version === MOCK_DB_VERSION) return parsed;
      }
    } catch {
      /* corrupted or unavailable storage → reseed */
    }
    return createSeed(now());
  }

  function save() {
    try {
      storage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* quota / private mode: keep working in memory */
    }
  }

  const delay = (scale = 1) => new Promise<void>((r) => setTimeout(r, Math.round((minLat + Math.random() * (maxLat - minLat)) * scale)));

  function assertOnline() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ServiceError('NETWORK', "You're offline. Changes need a connection — check your network and try again.");
    }
  }

  function emit() {
    listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* listener errors must not break writes */
      }
    });
  }

  async function read<T>(fn: () => T, scale = 1): Promise<T> {
    await delay(scale);
    return clone(fn());
  }

  async function write<T>(fn: () => T, scale = 1): Promise<T> {
    assertOnline();
    await delay(scale);
    try {
      const result = fn();
      return clone(result);
    } finally {
      // Persist even when the operation throws after recording e.g. a failed login attempt.
      save();
      emit();
    }
  }

  const nowIso = () => now().toISOString();
  const newId = (prefix = 'abcd') => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch {
      /* insecure context */
    }
    return uuidFrom(++state.seq.id, prefix);
  };

  /* ------------------------------ Guards ------------------------------ */

  function currentUserOrNull(): MockUser | null {
    return state.users.find((x) => x.profile.id === state.currentUserId) ?? null;
  }

  function currentUser(): MockUser {
    const u = currentUserOrNull();
    if (!u || u.profile.status === 'deleted') throw new ServiceError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    return u;
  }

  /** Mirrors JWT role claim + profile status + email verification checks. */
  function requireMerchant(): MockUser {
    const u = currentUser();
    if (u.profile.role !== 'merchant') throw new ServiceError('FORBIDDEN', 'This area is only available to merchant accounts.');
    if (u.profile.status === 'suspended') {
      throw new ServiceError('SUSPENDED', `Your merchant account is suspended. ${u.profile.suspensionReason ?? ''}`.trim());
    }
    if (!u.profile.emailVerified) throw new ServiceError('UNVERIFIED', 'Please verify your email address to continue.');
    return u;
  }

  function requireCustomer(): MockUser {
    const u = currentUser();
    if (u.profile.role !== 'customer') throw new ServiceError('FORBIDDEN', 'Sign in with a customer account to use this feature.');
    if (u.profile.status !== 'active') throw new ServiceError('SUSPENDED', 'This customer account is not active.');
    if (!u.profile.emailVerified) throw new ServiceError('UNVERIFIED', 'Please verify your email address to continue.');
    return u;
  }

  /**
   * Super Admin: completed TOTP (AUTH-09) and a session that has not
   * been idle for 30 minutes (AUTH-10).
   */
  function requireAdmin(opts: { touch?: boolean } = {}): MockUser {
    const u = currentUser();
    if (u.profile.role !== 'super_admin') throw new ServiceError('FORBIDDEN', 'This area is only available to Super Admins.');
    if (!state.admin.mfaVerified) throw new ServiceError('UNAUTHENTICATED', 'Two-factor verification is required.');
    const last = state.admin.lastActivityAt ? Date.parse(state.admin.lastActivityAt) : 0;
    if (now().getTime() - last > ADMIN_LIMITS.idleTimeoutMinutes * 60_000) {
      state.admin.mfaVerified = false;
      state.currentUserId = null;
      save();
      throw new ServiceError('UNAUTHENTICATED', 'Your admin session expired after 30 minutes of inactivity. Sign in again.');
    }
    if (opts.touch !== false) state.admin.lastActivityAt = nowIso();
    return u;
  }

  function myStore(): Store | null {
    const u = requireMerchant();
    return state.stores.find((s) => s.ownerId === u.profile.id) ?? null;
  }

  function requireStore(): Store {
    const s = myStore();
    if (!s) throw new ServiceError('NOT_FOUND', 'Create your store first to use this feature.');
    return s;
  }

  function sessionFor(u: MockUser): Session {
    const session: Session = { user: u.profile, store: state.stores.find((s) => s.ownerId === u.profile.id) ?? null };
    if (u.profile.role === 'super_admin') {
      const last = state.admin.lastActivityAt ? Date.parse(state.admin.lastActivityAt) : null;
      session.admin = {
        mfaVerified: state.admin.mfaVerified,
        networkAllowed: true,
        idleExpiresAt: last ? new Date(last + ADMIN_LIMITS.idleTimeoutMinutes * 60_000).toISOString() : null,
        ip: state.admin.ip,
      };
    }
    return session;
  }

  /* ------------------------------ Effects ----------------------------- */

  function notify(userId: string, n: NotificationDraft) {
    state.notifications.unshift({ id: newId('1212'), userId, isRead: false, createdAt: nowIso(), ...n });
  }

  function notifyAdmins(n: NotificationDraft) {
    for (const u of state.users) if (u.profile.role === 'super_admin' && u.profile.status === 'active') notify(u.profile.id, n);
  }

  /** Append-only audit (FR-SA-04, DB-04). */
  function audit(actor: MockUser | null, action: string, resourceType: string, resourceId: string | null, metadata: AuditLog['metadata'] = {}) {
    state.auditLogs.unshift({
      id: newId('au01'),
      actorId: actor?.profile.id ?? null,
      actorName: actor?.profile.fullName ?? 'System',
      action,
      resourceType,
      resourceId,
      metadata,
      ipAddress: actor?.profile.role === 'super_admin' ? state.admin.ip : null,
      createdAt: nowIso(),
    });
  }

  /** Idempotency: returns true if `key` was already processed for `scope`. */
  function seen(scope: string, key: string): boolean {
    const k = `${scope}:${key}`;
    if (state.idempotency[k]) return true;
    state.idempotency[k] = nowIso();
    return false;
  }

  function recordMovement(m: Omit<MockDb['movements'][number], 'id' | 'createdAt'>) {
    state.movements.unshift({ id: newId('5555'), createdAt: nowIso(), ...m });
  }

  function categoryName(id: string | null): string | null {
    return state.categories.find((c) => c.id === id)?.name ?? null;
  }

  function stripProduct(p: StoredProduct): Product {
    const { deletedAt: _deleted, ...rest } = p;
    void _deleted;
    return rest;
  }

  function maybeLowStockAlert(p: StoredProduct, before: number, after: number, variantLabel: string | null) {
    const t = p.lowStockThreshold;
    if (after <= t && before > t) {
      const store = state.stores.find((s) => s.id === p.storeId);
      if (!store) return;
      notify(store.ownerId, {
        type: 'low_stock',
        title: after <= 0 ? 'Out of stock' : 'Product low in stock',
        body: `${p.name}${variantLabel ? ` — ${variantLabel}` : ''} has ${Math.max(after, 0)} unit${after === 1 ? '' : 's'} left (threshold ${t}).`,
        referenceType: 'product',
        referenceId: p.id,
      });
    }
  }

  function returnSummary(r: ReturnRequest | undefined) {
    return r ? { id: r.id, returnNumber: r.returnNumber, status: r.status, reason: r.reason, createdAt: r.createdAt } : null;
  }

  function orderDetail(o: Order): OrderDetail {
    return {
      order: o,
      events: state.events.filter((e) => e.orderId === o.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      payments: state.payments.filter((p) => p.orderId === o.id),
      returnRequest: returnSummary(state.returns.find((x) => x.orderId === o.id)),
    };
  }

  function deliveredAt(orderId: string): string | null {
    return state.events.find((e) => e.orderId === orderId && e.eventType === 'delivered')?.createdAt ?? null;
  }

  function ensureConfigs(storeId: string): PaymentConfig[] {
    for (const method of PAYMENT_METHODS) {
      if (!state.paymentConfigs.some((c) => c.storeId === storeId && c.method === method)) {
        state.paymentConfigs.push({
          id: newId('3333'),
          storeId,
          method,
          isEnabled: false,
          hasCredentials: false,
          credentialHint: null,
          environment: 'sandbox',
          validation: method === 'cod' ? 'not_required' : 'unverified',
          updatedAt: nowIso(),
        });
      }
    }
    return PAYMENT_METHODS.map((m) => state.paymentConfigs.find((c) => c.storeId === storeId && c.method === m)!);
  }

  function ownerOf(storeId: string): MockUser | null {
    const s = state.stores.find((x) => x.id === storeId);
    return s ? (state.users.find((u) => u.profile.id === s.ownerId) ?? null) : null;
  }

  function storefrontProjection(s: Store): StorefrontStore {
    const owner = ownerOf(s.id);
    return {
      id: s.id,
      name: s.name,
      subdomain: s.subdomain,
      tagline: s.tagline,
      logoUrl: s.logoUrl,
      bannerUrl: s.extensions.bannerUrl,
      brandColour: s.brandColour,
      themeId: s.themeId,
      themeName: state.themes.find((t) => t.id === s.themeId)?.name ?? null,
      category: s.extensions.category,
      returnWindowDays: s.returnWindowDays,
      shipping: s.extensions.shipping,
      enabledPaymentMethods: ensureConfigs(s.id)
        .filter((c) => c.isEnabled)
        .map((c) => c.method),
      contact: { phone: owner?.profile.phone ?? null, email: owner?.profile.email ?? null },
    };
  }

  const ctx = {
    get db(): MockDb {
      return state;
    },
    reset() {
      state = createSeed(now());
      try {
        storage?.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      save();
      emit();
    },
    now,
    save,
    emit,
    delay,
    read,
    write,
    nowIso,
    newId,
    listeners,
    currentUserOrNull,
    currentUser,
    requireMerchant,
    requireCustomer,
    requireAdmin,
    myStore,
    requireStore,
    sessionFor,
    notify,
    notifyAdmins,
    audit,
    seen,
    recordMovement,
    categoryName,
    stripProduct,
    maybeLowStockAlert,
    orderDetail,
    returnSummary,
    deliveredAt,
    ensureConfigs,
    ownerOf,
    storefrontProjection,
  };
  return ctx;
}

export type MockContext = ReturnType<typeof createMockContext>;
