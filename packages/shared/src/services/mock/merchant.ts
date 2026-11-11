/**
 * Merchant-facing mock services (auth shared with customers, store, products,
 * inventory, orders, customers, payment configs, analytics, support,
 * notifications). Behaves like the trusted server operations listed in
 * SUPABASE_OPERATION_MAP.
 */
import { analyticsReport, buildDashboard, exportAnalyticsCsv } from './analytics-impl';
import { clone, type MockContext } from './context';
import { toCsv } from '../analytics';
import type { MockUser, StoredProduct } from './seed';
import { LIMITS, PAYMENT_METHOD_LABEL, ORDER_STATUS_LABEL } from '../../constants';
import { maskSecret } from '../../formatters';
import {
  canCancelOrder,
  canManuallyReviewPayment,
  canRecordCodCollection,
  canReplyToTicket,
  canTransitionOrder,
  canTransitionTicket,
  computeOnboarding,
  confirmBlockedReason,
  inventoryRowsForProduct,
  productStockState,
  validateAttachmentFile,
  validateImageFile,
} from '../../rules-split';
import { checkSubdomainSyntax, normalizeSubdomain, suggestSubdomains } from '../../formatters/subdomain';
import type { StoreCustomer, InventoryRow, Order, OrderStatus, PaymentMethod, Store, SupportTicketDetail } from '../../types';
import { credentialSchemas, productInputSchema, toFieldErrors, type ProductInput } from '../../validation';
import { ServiceError, type MerchantServices, type UploadFile } from '../contracts';

export function createMerchantServices(ctx: MockContext): Omit<MerchantServices, 'returns'> {
  const {
    now,
    read,
    write,
    nowIso,
    newId,
    listeners,
    currentUser,
    requireMerchant,
    myStore,
    requireStore,
    sessionFor,
    notify,
    seen,
    recordMovement,
    categoryName,
    stripProduct,
    maybeLowStockAlert,
    orderDetail,
    ensureConfigs,
  } = ctx;

  /* ---------------------------- Products ---------------------------- */

  function ownedProduct(id: string): StoredProduct {
    const store = requireStore();
    const p = ctx.db.products.find((x) => x.id === id && !x.deletedAt);
    if (!p) throw new ServiceError('NOT_FOUND', 'This product could not be found. It may have been deleted.');
    // AUTHZ-04: existing-but-unauthorized resources are 403, not 404.
    if (p.storeId !== store.id) throw new ServiceError('FORBIDDEN', 'You do not have access to this product.');
    return p;
  }

  function validateProduct(input: ProductInput, storeId: string): ProductInput {
    const res = productInputSchema.safeParse(input);
    if (!res.success) {
      throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(res.error));
    }
    const cat = ctx.db.categories.find((c) => c.id === res.data.categoryId);
    if (!cat || cat.storeId !== storeId) {
      throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', { categoryId: 'Choose one of your categories.' });
    }
    return res.data;
  }

  /* ------------------------------ Orders ---------------------------- */

  function ownedOrder(id: string): Order {
    const store = requireStore();
    const o = ctx.db.orders.find((x) => x.id === id || x.orderNumber === id);
    if (!o) throw new ServiceError('NOT_FOUND', 'This order could not be found.');
    if (o.storeId !== store.id) throw new ServiceError('FORBIDDEN', 'You do not have access to this order.');
    return o;
  }

  function actorName(u: MockUser) {
    return u.profile.fullName;
  }

  /* ----------------------------- Payments --------------------------- */

  /* ----------------------------- Support ---------------------------- */

  function ownedTicket(id: string) {
    const store = requireStore();
    const t = ctx.db.tickets.find((x) => x.id === id || x.ticketNumber === id);
    if (!t) throw new ServiceError('NOT_FOUND', 'This ticket could not be found.');
    if (t.storeId !== store.id) throw new ServiceError('FORBIDDEN', 'This ticket is not assigned to your store.');
    return t;
  }

  function ticketDetail(id: string): SupportTicketDetail {
    const t = ownedTicket(id);
    return {
      ticket: t,
      messages: ctx.db.messages.filter((m) => m.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      audit: ctx.db.ticketAudit.filter((a) => a.ticketId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  /* ----------------------------- Customers -------------------------- */

  function deriveCustomers(storeId: string): StoreCustomer[] {
    const map = new Map<string, StoreCustomer>();
    const t = now().getTime();
    const orders = ctx.db.orders.filter((o) => o.storeId === storeId && !o.isTest).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const o of orders) {
      const id = o.customerId ?? `guest:${o.orderPhone}`;
      const c = map.get(id);
      const revenue = o.status === 'cancelled' ? 0 : o.totalAmount;
      if (!c) {
        map.set(id, {
          id,
          name: o.customerName,
          phone: o.orderPhone,
          email: o.orderEmail,
          accountType: o.customerId ? 'registered' : 'guest',
          activity: 'active',
          ordersCount: 1,
          totalSpent: revenue,
          firstOrderAt: o.createdAt,
          lastOrderAt: o.createdAt,
          district: o.deliveryAddress.district,
        });
      } else {
        c.ordersCount += 1;
        c.totalSpent += revenue;
        c.lastOrderAt = o.createdAt;
        c.email = c.email ?? o.orderEmail;
      }
    }
    for (const c of map.values()) {
      const sinceFirst = (t - Date.parse(c.firstOrderAt)) / 86_400_000;
      const sinceLast = (t - Date.parse(c.lastOrderAt)) / 86_400_000;
      c.activity = sinceFirst <= 14 && c.ordersCount === 1 ? 'new' : sinceLast <= 30 ? 'active' : 'inactive';
    }
    return [...map.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  }

  /* ================================================================== */

  const services: Omit<MerchantServices, 'returns'> = {
    /* ------------------------------ Auth ------------------------------ */
    auth: {
      getSession: () =>
        read(() => {
          const u = ctx.db.users.find((x) => x.profile.id === ctx.db.currentUserId);
          if (!u || u.profile.status === 'deleted') return null;
          if (u.profile.role === 'super_admin') {
            // Admin sessions are only valid after TOTP and within the idle window.
            try {
              ctx.requireAdmin({ touch: false });
            } catch {
              return null;
            }
          }
          return sessionFor(u);
        }, 0.3),

      signIn: (email, password) =>
        write(() => {
          const u = ctx.db.users.find((x) => x.profile.email.toLowerCase() === email.trim().toLowerCase());
          const generic = new ServiceError('UNAUTHENTICATED', 'Incorrect email or password.');
          // Super Admins must use the admin login (password + TOTP, §12.1); deleted accounts cannot sign in.
          if (!u || u.profile.role === 'super_admin' || u.profile.status === 'deleted') throw generic;
          if (u.lockedUntil && Date.parse(u.lockedUntil) > now().getTime()) {
            throw new ServiceError(
              'LOCKED',
              `Too many failed attempts. For your security this account is locked for ${LIMITS.lockoutMinutes} minutes. We've emailed an unlock link to the account address.`,
            );
          }
          if (u.password !== password) {
            u.failedAttempts += 1;
            if (u.failedAttempts >= LIMITS.maxFailedLogins) {
              u.lockedUntil = new Date(now().getTime() + LIMITS.lockoutMinutes * 60_000).toISOString();
              u.failedAttempts = 0;
              throw new ServiceError(
                'LOCKED',
                `Too many failed attempts. For your security this account is locked for ${LIMITS.lockoutMinutes} minutes. We've emailed an unlock link to the account address.`,
              );
            }
            throw generic;
          }
          // AUTH-14: suspended accounts cannot authenticate; show the reason.
          if (u.profile.status === 'suspended') {
            throw new ServiceError(
              'SUSPENDED',
              `This ${u.profile.role === 'customer' ? '' : 'merchant '}account is suspended. Reason: ${u.profile.suspensionReason ?? 'Not specified'} Contact BazarHQ support if you believe this is a mistake.`,
            );
          }
          u.failedAttempts = 0;
          u.lockedUntil = null;
          ctx.db.currentUserId = u.profile.id;
          ctx.db.admin.mfaVerified = false;
          return sessionFor(u);
        }),

      signInWithGoogle: (accountType = 'merchant') =>
        write(() => {
          // FR-M-05 / FR-C-30: OAuth accounts skip email verification; the role is assigned server-side.
          const email = accountType === 'customer' ? 'google.customer@gmail.test' : 'google.merchant@gmail.test';
          let u = ctx.db.users.find((x) => x.profile.email === email);
          if (!u) {
            u = {
              profile: {
                id: newId('aaaa'),
                email,
                fullName: accountType === 'customer' ? 'Google Customer' : 'Google Merchant',
                phone: null,
                avatarUrl: null,
                role: accountType === 'customer' ? 'customer' : 'merchant',
                status: 'active',
                suspensionReason: null,
                emailVerified: true,
                pendingEmail: null,
                authProvider: 'google',
                twoFactorEnabled: false,
                createdAt: nowIso(),
              },
              password: `oauth-${Math.random()}`,
              failedAttempts: 0,
              lockedUntil: null,
            };
            ctx.db.users.push(u);
          }
          ctx.db.currentUserId = u.profile.id;
          return sessionFor(u);
        }, 1.5),

      register: ({ fullName, email, password, accountType }) =>
        write(() => {
          const normalized = email.trim().toLowerCase();
          if (ctx.db.users.some((x) => x.profile.email.toLowerCase() === normalized)) {
            throw new ServiceError('CONFLICT', 'Email already registered', { email: 'Email already registered. Sign in instead, or reset your password.' });
          }
          if (password.length < LIMITS.passwordMinLength || !/\d/.test(password)) {
            throw new ServiceError('VALIDATION', 'Please choose a stronger password.', {
              password: 'Password must be at least 8 characters and include a number.',
            });
          }
          const u: MockUser = {
            profile: {
              id: newId('aaaa'),
              email: normalized,
              fullName: fullName.trim(),
              phone: null,
              avatarUrl: null,
              // Assigned server-side (AUTHZ-01). Public signup can never create a Super Admin.
              role: accountType === 'customer' ? 'customer' : 'merchant',
              status: 'active',
              suspensionReason: null,
              emailVerified: false,
              pendingEmail: null,
              authProvider: 'email',
              twoFactorEnabled: false,
              createdAt: nowIso(),
            },
            password,
            failedAttempts: 0,
            lockedUntil: null,
          };
          ctx.db.users.push(u);
          ctx.db.currentUserId = u.profile.id; // unverified session: guard routes to verify-email
          return { email: normalized };
        }, 1.4),

      resendVerification: (email) =>
        write(() => {
          void email;
        }, 1.2),

      refreshVerification: () =>
        write(() => {
          const u = currentUser();
          if (ctx.db.verificationLinkClicked[u.profile.email]) {
            u.profile.emailVerified = true;
            delete ctx.db.verificationLinkClicked[u.profile.email];
          }
          if (!u.profile.emailVerified) {
            throw new ServiceError('UNVERIFIED', "We haven't received your verification yet. Open the link in the email we sent, then try again.");
          }
          return sessionFor(u);
        }),

      requestPasswordReset: (email) =>
        write(() => {
          // Same response whether or not the email exists (no account enumeration).
          const u = ctx.db.users.find((x) => x.profile.email.toLowerCase() === email.trim().toLowerCase());
          if (u) {
            const token = `reset-${newId('rrrr').slice(0, 8)}`;
            ctx.db.resetTokens[token] = { email: u.profile.email, expiresAt: new Date(now().getTime() + 3_600_000).toISOString(), used: false };
          }
        }, 1.2),

      resetPassword: (token, password) =>
        write(() => {
          const t = ctx.db.resetTokens[token];
          if (!t || t.used || Date.parse(t.expiresAt) < now().getTime()) {
            throw new ServiceError('VALIDATION', 'This reset link is invalid or has expired. Request a new one.');
          }
          const u = ctx.db.users.find((x) => x.profile.email === t.email);
          if (!u) throw new ServiceError('VALIDATION', 'This reset link is invalid or has expired. Request a new one.');
          u.password = password;
          u.failedAttempts = 0;
          u.lockedUntil = null;
          t.used = true; // single-use (AUTH-12)
          ctx.db.sessions[u.profile.id] = []; // invalidate sessions
          if (ctx.db.currentUserId === u.profile.id) ctx.db.currentUserId = null;
        }),

      signOut: () =>
        write(() => {
          ctx.db.currentUserId = null;
          ctx.db.admin.mfaVerified = false;
          ctx.db.admin.pendingMfaUserId = null;
        }, 0.4),

      updateProfile: ({ fullName, phone, avatar }) =>
        write(() => {
          const u = currentUser();
          if (avatar) {
            const err = validateImageFile(avatar);
            if (err) throw new ServiceError('VALIDATION', err, { avatar: err });
            u.profile.avatarUrl = avatar.previewUrl;
          } else if (avatar === null) {
            u.profile.avatarUrl = null;
          }
          u.profile.fullName = fullName.trim();
          u.profile.phone = phone || null;
          return u.profile;
        }),

      requestEmailChange: (newEmail) =>
        write(() => {
          const u = currentUser();
          const e = newEmail.trim().toLowerCase();
          if (ctx.db.users.some((x) => x.profile.email.toLowerCase() === e)) {
            throw new ServiceError('CONFLICT', 'That email is already registered.', { email: 'That email is already registered.' });
          }
          u.profile.pendingEmail = e; // FR-M-41: becomes active only after verification
        }),

      changePassword: (currentPassword, newPassword) =>
        write(() => {
          const u = currentUser();
          if (u.password !== currentPassword) {
            throw new ServiceError('VALIDATION', 'Your current password is incorrect.', { currentPassword: 'Your current password is incorrect.' });
          }
          u.password = newPassword;
          // AUTH-06: terminate all other sessions.
          ctx.db.sessions[u.profile.id] = (ctx.db.sessions[u.profile.id] ?? []).filter((s) => s.current);
        }),

      listSessions: () =>
        read(() => {
          const u = currentUser();
          return (
            ctx.db.sessions[u.profile.id] ?? [
              { id: 'current', device: 'This device', platform: 'web' as const, location: null, lastActiveAt: nowIso(), current: true },
            ]
          );
        }),

      terminateSession: (sessionId) =>
        write(() => {
          const u = currentUser();
          const list = ctx.db.sessions[u.profile.id] ?? [];
          const s = list.find((x) => x.id === sessionId);
          if (!s) throw new ServiceError('NOT_FOUND', 'That session has already ended.');
          if (s.current) throw new ServiceError('VALIDATION', 'Use "Sign out" to end the session on this device.');
          ctx.db.sessions[u.profile.id] = list.filter((x) => x.id !== sessionId);
        }),

      beginTotpEnrollment: () =>
        write(() => {
          const u = currentUser();
          const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
          const secret = Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
          ctx.db.pendingTotpSecret = secret;
          return { secret, otpauthUrl: `otpauth://totp/BazarHQ:${encodeURIComponent(u.profile.email)}?secret=${secret}&issuer=BazarHQ` };
        }),

      confirmTotpEnrollment: (code) =>
        write(() => {
          const u = currentUser();
          if (!ctx.db.pendingTotpSecret) throw new ServiceError('VALIDATION', 'Start two-factor setup again.');
          if (!/^\d{6}$/.test(code) || code === '000000') {
            throw new ServiceError('VALIDATION', 'That code did not match. Wait for a new code and try again.', { code: 'That code did not match.' });
          }
          u.profile.twoFactorEnabled = true;
          ctx.db.pendingTotpSecret = null;
          const recoveryCodes = Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 7) + '-' + Math.random().toString(36).slice(2, 7));
          return { recoveryCodes };
        }),

      disableTotp: (code) =>
        write(() => {
          const u = currentUser();
          if (!/^\d{6}$/.test(code))
            throw new ServiceError('VALIDATION', 'Enter the 6-digit code from your authenticator app.', { code: 'Enter a 6-digit code.' });
          u.profile.twoFactorEnabled = false;
        }),

      getDeletionPrecheck: () =>
        read(() => {
          const store = myStore();
          const pendingOrders = store ? ctx.db.orders.filter((o) => o.storeId === store.id && !o.isTest && o.status !== 'delivered' && o.status !== 'cancelled').length : 0;
          return { pendingOrders };
        }),

      deleteAccount: (confirmation) =>
        write(() => {
          const u = currentUser();
          if (confirmation !== 'DELETE') throw new ServiceError('VALIDATION', 'Type DELETE to confirm.', { confirmation: 'Type DELETE to confirm.' });
          const store = ctx.db.stores.find((s) => s.ownerId === u.profile.id);
          if (store) store.status = 'draft'; // unpublished immediately (FR-M-44)
          u.password = `deleted-${Math.random()}`; // soft delete in mock: login disabled
          ctx.db.currentUserId = null;
        }, 1.5),
    },

    /* ------------------------------ Store ----------------------------- */
    store: {
      getMyStore: () => read(() => myStore(), 0.5),

      checkSubdomain: (input) =>
        read(() => {
          const subdomain = normalizeSubdomain(input);
          const syntax = checkSubdomainSyntax(subdomain);
          if (!syntax.ok) {
            return {
              subdomain,
              available: false,
              reason: syntax.reason,
              message: syntax.message,
              suggestions: syntax.reason === 'reserved' ? suggestSubdomains(subdomain, isTaken) : [],
            };
          }
          const mine = ctx.db.stores.find((s) => s.ownerId === ctx.db.currentUserId);
          if (mine?.subdomain === subdomain) {
            return { subdomain, available: true, reason: 'own' as const, message: 'This is your current store address.', suggestions: [] };
          }
          if (isTaken(subdomain)) {
            return {
              subdomain,
              available: false,
              reason: 'taken' as const,
              message: `The /store/${subdomain} address is already taken.`,
              suggestions: suggestSubdomains(subdomain, isTaken),
            };
          }
          return { subdomain, available: true, reason: 'ok' as const, message: `The /store/${subdomain} address is available.`, suggestions: [] };
        }, 0.6),

      createStore: ({ name, subdomain, category, tagline }) =>
        write(() => {
          const u = requireMerchant();
          if (ctx.db.stores.some((s) => s.ownerId === u.profile.id)) {
            throw new ServiceError(
              'CONFLICT',
              'Each merchant account can own one store in this version of BazarHQ. Multi-store support is planned for a future version.',
            );
          }
          const sub = normalizeSubdomain(subdomain);
          const syntax = checkSubdomainSyntax(sub);
          if (!syntax.ok) throw new ServiceError('VALIDATION', syntax.message, { subdomain: syntax.message });
          if (isTaken(sub)) throw new ServiceError('CONFLICT', `The /store/${sub} address is already taken.`, { subdomain: `The /store/${sub} address is already taken.` });
          const theme = ctx.db.themes.find((t) => t.isActive);
          const store: Store = {
            id: newId('bbbb'),
            ownerId: u.profile.id,
            name: name.trim(),
            subdomain: sub,
            status: 'draft',
            themeId: theme?.id ?? null,
            brandColour: '#059669',
            tagline: tagline.trim() || null,
            logoUrl: null,
            returnWindowDays: LIMITS.defaultReturnWindowDays,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            extensions: {
              category,
              bannerUrl: null,
              shipping: { insideDhakaCharge: 60, outsideDhakaCharge: 120, estimatedDaysInsideDhaka: 2, estimatedDaysOutsideDhaka: 4 },
              notificationPreferences: { newOrderEmail: true, newOrderSms: false, lowStockEmail: true, supportTicketEmail: true },
            },
          };
          ctx.db.stores.push(store);
          ensureConfigs(store.id);
          return store;
        }),

      updateStore: (patch) =>
        write(() => {
          const store = requireStore();
          if (patch.themeId !== undefined) {
            const theme = ctx.db.themes.find((t) => t.id === patch.themeId);
            if (!theme || !theme.isActive) throw new ServiceError('VALIDATION', 'That theme is no longer available. Choose another.');
          }
          if (patch.brandColour !== undefined && !/^#[0-9a-fA-F]{6}$/.test(patch.brandColour)) {
            throw new ServiceError('VALIDATION', 'Pick a valid colour.');
          }
          if (patch.returnWindowDays !== undefined && (!Number.isInteger(patch.returnWindowDays) || patch.returnWindowDays < 1)) {
            throw new ServiceError('VALIDATION', 'Return window must be at least 1 day.');
          }
          Object.assign(store, patch, { updatedAt: nowIso() });
          if (patch.tagline !== undefined) store.tagline = patch.tagline?.trim() || null;
          return store;
        }),

      updateExtensions: (patch) =>
        write(() => {
          const store = requireStore();
          store.extensions = { ...store.extensions, ...patch };
          store.updatedAt = nowIso();
          return store;
        }),

      uploadLogo: (file: UploadFile) =>
        write(() => {
          const store = requireStore();
          const err = validateImageFile(file);
          if (err) throw new ServiceError('VALIDATION', err);
          store.logoUrl = file.previewUrl;
          store.updatedAt = nowIso();
          return store;
        }, 1.6),

      removeLogo: () =>
        write(() => {
          const store = requireStore();
          store.logoUrl = null;
          return store;
        }),

      uploadBanner: (file: UploadFile) =>
        write(() => {
          const store = requireStore();
          const err = validateImageFile(file);
          if (err) throw new ServiceError('VALIDATION', err);
          store.extensions.bannerUrl = file.previewUrl;
          store.updatedAt = nowIso();
          return store;
        }, 1.6),

      listThemes: () => read(() => ctx.db.themes.filter((t) => t.isActive)),

      getOnboarding: () =>
        read(() => {
          const store = myStore();
          const configs = store ? ensureConfigs(store.id) : [];
          const count = store ? ctx.db.products.filter((p) => p.storeId === store.id && !p.deletedAt).length : 0;
          return computeOnboarding(store, configs, count);
        }),

      publish: () =>
        write(() => {
          const store = requireStore();
          if (store.status === 'suspended') throw new ServiceError('FORBIDDEN', 'This store is suspended by BazarHQ and cannot be published.');
          const configs = ensureConfigs(store.id);
          const progress = computeOnboarding(store, configs, ctx.db.products.filter((p) => p.storeId === store.id && !p.deletedAt).length);
          if (!configs.some((c) => c.isEnabled)) {
            throw new ServiceError('VALIDATION', 'Enable at least one payment method before publishing your store.');
          }
          if (!progress.publishable) {
            const missing = progress.steps.filter((s) => !s.done).map((s) => s.label.toLowerCase());
            throw new ServiceError('VALIDATION', `Finish setup before publishing: ${missing.join(', ')}.`);
          }
          store.status = 'published';
          store.updatedAt = nowIso();
          return store;
        }),

      unpublish: () =>
        write(() => {
          const store = requireStore();
          if (store.status === 'suspended') throw new ServiceError('FORBIDDEN', 'This store is suspended by BazarHQ.');
          store.status = 'draft';
          store.updatedAt = nowIso();
          return store;
        }),
    },

    /* ----------------------------- Products --------------------------- */
    products: {
      list: (filters = {}) =>
        read(() => {
          const store = requireStore();
          const q = filters.search?.trim().toLowerCase();
          return ctx.db.products
            .filter((p) => p.storeId === store.id && !p.deletedAt)
            .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.extensions.sku ?? '').toLowerCase().includes(q))
            .filter((p) => !filters.status || filters.status === 'all' || p.status === filters.status)
            .filter((p) => !filters.categoryId || filters.categoryId === 'all' || p.categoryId === filters.categoryId)
            .filter((p) => !filters.productType || filters.productType === 'all' || p.productType === filters.productType)
            .filter((p) => !filters.stock || filters.stock === 'all' || productStockState(p) === filters.stock)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(stripProduct);
        }),

      get: (id) => read(() => stripProduct(ownedProduct(id))),

      create: (input) =>
        write(() => {
          const u = requireMerchant();
          const store = requireStore();
          const data = validateProduct(input, store.id);
          const pid = newId('eeee');
          const t = nowIso();
          const p: StoredProduct = {
            id: pid,
            storeId: store.id,
            name: data.name.trim(),
            description: data.description.trim(),
            categoryId: data.categoryId,
            basePrice: data.basePrice,
            productType: data.productType,
            stockQuantity: data.productType === 'simple' ? data.stockQuantity : null,
            lowStockThreshold: data.lowStockThreshold,
            status: data.status,
            images: data.images.map((img, i) => ({
              id: newId('img0'),
              productId: pid,
              storagePath: img.storagePath.replace('/products/new/', `/products/${pid}/`),
              url: img.url,
              isPrimary: img.isPrimary,
              displayOrder: i,
            })),
            variants:
              data.productType === 'variant'
                ? data.variants.map((v) => ({
                    id: newId('ffff'),
                    productId: pid,
                    variantLabel: v.variantLabel.trim(),
                    priceAdjustment: v.priceAdjustment,
                    stockQuantity: v.stockQuantity,
                    status: v.status,
                  }))
                : [],
            createdAt: t,
            updatedAt: t,
            deletedAt: null,
            extensions: { sku: data.sku.trim() || `BHQ-${pid.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`, compareAtPrice: data.compareAtPrice ?? null },
          };
          ctx.db.products.push(p);
          const initial =
            p.productType === 'simple'
              ? [{ variantId: null, label: null, qty: p.stockQuantity ?? 0 }]
              : p.variants.map((v) => ({ variantId: v.id, label: v.variantLabel, qty: v.stockQuantity }));
          for (const i of initial) {
            if (i.qty > 0) {
              recordMovement({
                storeId: store.id,
                productId: p.id,
                variantId: i.variantId,
                productName: p.name,
                variantLabel: i.label,
                quantityDelta: i.qty,
                reason: 'manual_adjustment',
                actorId: u.profile.id,
                actorName: actorName(u),
                referenceType: 'manual',
                referenceId: null,
                note: 'Initial stock on product creation',
              });
            }
          }
          return stripProduct(p);
        }, 1.4),

      update: (id, input) =>
        write(() => {
          const u = requireMerchant();
          const store = requireStore();
          const p = ownedProduct(id);
          const data = validateProduct(input, store.id);
          if (data.productType !== p.productType) {
            throw new ServiceError(
              'VALIDATION',
              'Changing between simple and variant products needs a separate stock conversion. Duplicate the product instead.',
            );
          }
          p.name = data.name.trim();
          p.description = data.description.trim();
          p.categoryId = data.categoryId;
          p.basePrice = data.basePrice;
          p.lowStockThreshold = data.lowStockThreshold;
          p.status = data.status;
          p.extensions = { sku: data.sku.trim() || `BHQ-${p.id.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`, compareAtPrice: data.compareAtPrice ?? null };
          p.images = data.images.map((img, i) => ({
            id: img.id ?? newId('img0'),
            productId: p.id,
            storagePath: img.storagePath.replace('/products/new/', `/products/${p.id}/`),
            url: img.url,
            isPrimary: img.isPrimary,
            displayOrder: i,
          }));
          if (p.productType === 'variant') {
            // Existing variants keep their authoritative stock; only label/price/status change here.
            const next = data.variants.map((v) => {
              const existing = v.id ? p.variants.find((x) => x.id === v.id) : undefined;
              if (existing) {
                return { ...existing, variantLabel: v.variantLabel.trim(), priceAdjustment: v.priceAdjustment, status: v.status };
              }
              const created = {
                id: newId('ffff'),
                productId: p.id,
                variantLabel: v.variantLabel.trim(),
                priceAdjustment: v.priceAdjustment,
                stockQuantity: v.stockQuantity,
                status: v.status,
              };
              if (created.stockQuantity > 0) {
                recordMovement({
                  storeId: store.id,
                  productId: p.id,
                  variantId: created.id,
                  productName: p.name,
                  variantLabel: created.variantLabel,
                  quantityDelta: created.stockQuantity,
                  reason: 'manual_adjustment',
                  actorId: u.profile.id,
                  actorName: actorName(u),
                  referenceType: 'manual',
                  referenceId: null,
                  note: 'Initial stock for new variant',
                });
              }
              return created;
            });
            const removed = p.variants.filter((x) => !next.some((n) => n.id === x.id));
            if (removed.length > 0) {
              throw new ServiceError('VALIDATION', 'Existing variants cannot be deleted because orders may reference them. Hide the variant instead.');
            }
            p.variants = next;
          }
          p.updatedAt = nowIso();
          return stripProduct(p);
        }, 1.2),

      setStatus: (id, status) =>
        write(() => {
          const p = ownedProduct(id);
          p.status = status;
          p.updatedAt = nowIso();
          return stripProduct(p);
        }, 0.6),

      remove: (id) =>
        write(() => {
          const p = ownedProduct(id);
          p.deletedAt = nowIso(); // soft delete; order_items keep snapshots
        }),

      duplicate: (id, options = {}) =>
        write(() => {
          const src = ownedProduct(id);
          const store = requireStore();
          const pid = newId('eeee');
          const t = nowIso();
          const name = (options.name ?? `${src.name} (Copy)`).trim();
          if (name.length < 2 || name.length > 150)
            throw new ServiceError('VALIDATION', 'Enter a product name (2–150 characters).', { name: 'Enter a product name (2–150 characters).' });
          const live = ctx.db.products.filter((p) => p.storeId === store.id && !p.deletedAt);
          // A unique SKU per store: VEG-TOM-1KG → VEG-TOM-1KG-COPY, -COPY-2, …
          let sku: string | null = null;
          if (options.copySku !== false && src.extensions.sku) {
            const taken = new Set(live.map((p) => (p.extensions.sku ?? '').toUpperCase()));
            let n = 1;
            sku = `${src.extensions.sku}-COPY`;
            while (taken.has(sku.toUpperCase())) sku = `${src.extensions.sku}-COPY-${++n}`;
          }
          const copy: StoredProduct = {
            ...clone(src),
            id: pid,
            name,
            status: 'draft',
            // Stock starts at 0 so the copy never creates unrecorded inventory (FR-M-19).
            stockQuantity: src.productType === 'simple' ? 0 : null,
            variants: src.variants.map((v) => ({ ...v, id: newId('ffff'), productId: pid, stockQuantity: 0 })),
            images: options.includeImages === false ? [] : src.images.map((img) => ({ ...img, id: newId('img0'), productId: pid })),
            createdAt: t,
            updatedAt: t,
            deletedAt: null,
            extensions: { sku: sku ?? `BHQ-${pid.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`, compareAtPrice: options.includePricing === false ? null : (src.extensions.compareAtPrice ?? null) },
          };
          ctx.db.products.push(copy);
          return stripProduct(copy);
        }),

      uploadImage: (file, productId) =>
        write(() => {
          const store = requireStore();
          const err = validateImageFile(file);
          if (err) throw new ServiceError('VALIDATION', err);
          const safeName = file.name
            .toLowerCase()
            .replace(/[^a-z0-9.]+/g, '-')
            .slice(-60);
          return { storagePath: `stores/${store.id}/products/${productId ?? 'new'}/${newId('obj0')}-${safeName}`, url: file.previewUrl };
        }, 1.3),

      listCategories: () =>
        read(() => {
          const store = requireStore();
          return ctx.db.categories.filter((c) => c.storeId === store.id).sort((a, b) => a.displayOrder - b.displayOrder);
        }, 0.5),

      createCategory: (name) =>
        write(() => {
          const store = requireStore();
          const n = name.trim();
          if (n.length < 2) throw new ServiceError('VALIDATION', 'Enter a category name.');
          if (ctx.db.categories.some((c) => c.storeId === store.id && c.name.toLowerCase() === n.toLowerCase())) {
            throw new ServiceError('CONFLICT', 'You already have a category with that name.');
          }
          const c = {
            id: newId('dddd'),
            storeId: store.id,
            name: n,
            slug: n
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
            parentId: null,
            displayOrder: ctx.db.categories.filter((x) => x.storeId === store.id).length,
          };
          ctx.db.categories.push(c);
          return c;
        }, 0.6),
    },

    /* ----------------------------- Inventory -------------------------- */
    inventory: {
      list: (filters = {}) =>
        read(() => {
          const store = requireStore();
          const q = filters.search?.trim().toLowerCase();
          const rows: InventoryRow[] = ctx.db.products
            .filter((p) => p.storeId === store.id && !p.deletedAt)
            .flatMap((p) => inventoryRowsForProduct(p, categoryName(p.categoryId)));
          return rows
            .filter((r) => !q || r.productName.toLowerCase().includes(q) || (r.variantLabel ?? '').toLowerCase().includes(q))
            .filter((r) => !filters.categoryId || filters.categoryId === 'all' || r.categoryId === filters.categoryId)
            .filter((r) => !filters.state || filters.state === 'all' || r.state === filters.state)
            .sort((a, b) => a.stockQuantity - b.stockQuantity);
        }),

      adjust: ({ productId, variantId, delta, note, idempotencyKey }) =>
        write(() => {
          const u = requireMerchant();
          const store = requireStore();
          const p = ownedProduct(productId);
          const rowFor = () => inventoryRowsForProduct(p, categoryName(p.categoryId)).find((r) => r.variantId === variantId)!;
          if (seen('adjust', idempotencyKey)) return rowFor();
          if (!Number.isInteger(delta) || delta === 0) throw new ServiceError('VALIDATION', 'Enter a non-zero whole number.');
          if (!note || note.trim().length < 3) throw new ServiceError('VALIDATION', 'Add a short reason for the audit log.');
          // DB-08: stock owner must match the product's stock model.
          if (p.productType === 'simple' && variantId) throw new ServiceError('VALIDATION', 'Simple products are adjusted at product level.');
          if (p.productType === 'variant' && !variantId) throw new ServiceError('VALIDATION', 'Choose which variant to adjust.');
          let before: number;
          let label: string | null = null;
          if (p.productType === 'simple') {
            before = p.stockQuantity ?? 0;
            if (before + delta < 0) throw new ServiceError('VALIDATION', `Stock cannot go below 0 (currently ${before}).`);
            p.stockQuantity = before + delta;
          } else {
            const v = p.variants.find((x) => x.id === variantId);
            if (!v) throw new ServiceError('NOT_FOUND', 'That variant no longer exists.');
            before = v.stockQuantity;
            label = v.variantLabel;
            if (before + delta < 0) throw new ServiceError('VALIDATION', `Stock cannot go below 0 (currently ${before}).`);
            v.stockQuantity = before + delta;
          }
          p.updatedAt = nowIso();
          recordMovement({
            storeId: store.id,
            productId: p.id,
            variantId,
            productName: p.name,
            variantLabel: label,
            quantityDelta: delta,
            reason: 'manual_adjustment',
            actorId: u.profile.id,
            actorName: actorName(u),
            referenceType: 'manual',
            referenceId: null,
            note: note.trim(),
          });
          maybeLowStockAlert(p, before, before + delta, label);
          return rowFor();
        }, 0.8),

      movements: (filters = {}) =>
        read(() => {
          const store = requireStore();
          return ctx.db.movements
            .filter((m) => m.storeId === store.id)
            .filter((m) => !filters.productId || m.productId === filters.productId)
            .filter((m) => filters.variantId === undefined || m.variantId === filters.variantId)
            .slice(0, filters.limit ?? 200);
        }),
    },

    /* ------------------------------ Orders ---------------------------- */
    orders: {
      list: (filters = {}) =>
        read(() => {
          const store = requireStore();
          const q = filters.search?.trim().toLowerCase();
          const items = ctx.db.orders
            .filter((o) => o.storeId === store.id)
            .filter((o) => filters.includeTest === true || !o.isTest)
            .filter((o) => !filters.status || filters.status === 'all' || o.status === filters.status)
            .filter((o) => !filters.paymentStatus || filters.paymentStatus === 'all' || o.paymentStatus === filters.paymentStatus)
            .filter((o) => !filters.paymentMethod || filters.paymentMethod === 'all' || o.paymentMethod === filters.paymentMethod)
            .filter((o) => !filters.from || o.createdAt.slice(0, 10) >= filters.from)
            .filter((o) => !filters.to || o.createdAt.slice(0, 10) <= filters.to)
            .filter((o) => !q || o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.orderPhone.includes(q))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return { items, total: items.length };
        }),

      countsByStatus: () =>
        read(() => {
          const store = requireStore();
          const out: Record<string, number> = { all: 0, pending: 0, confirmed: 0, processing: 0, shipped: 0, out_for_delivery: 0, delivered: 0, cancelled: 0 };
          for (const o of ctx.db.orders) {
            if (o.storeId !== store.id || o.isTest) continue;
            out.all = (out.all ?? 0) + 1;
            out[o.status] = (out[o.status] ?? 0) + 1;
          }
          return out as Record<OrderStatus | 'all', number>;
        }, 0.5),

      get: (id) => read(() => orderDetail(ownedOrder(id))),

      markAsTest: (id, reason) =>
        write(() => {
          const u = requireMerchant();
          const o = ownedOrder(id);
          const cleanReason = reason.normalize('NFC').trim();
          if (cleanReason.length < 5 || cleanReason.length > 300) {
            throw new ServiceError('VALIDATION', 'Add a reason between 5 and 300 characters.', { reason: 'Add a reason between 5 and 300 characters.' });
          }
          if (!o.isTest) {
            o.isTest = true;
            o.testReason = cleanReason;
            o.testMarkedAt = nowIso();
            ctx.audit(u, 'order.marked_test', 'order', o.id, { order: o.orderNumber, reason: cleanReason });
          }
          return orderDetail(o);
        }, 0.8),

      updateStatus: (id, to, { note, idempotencyKey }) =>
        write(() => {
          const u = requireMerchant();
          const o = ownedOrder(id);
          if (seen(`order-status:${o.id}`, idempotencyKey)) return orderDetail(o);
          if (!canTransitionOrder(o.status, to)) {
            throw new ServiceError(
              'CONFLICT',
              `This order is ${ORDER_STATUS_LABEL[o.status].toLowerCase()} and cannot move to ${ORDER_STATUS_LABEL[to].toLowerCase()}. Refresh to see its latest status.`,
            );
          }
          if (to === 'confirmed') {
            const blocked = confirmBlockedReason(o);
            if (blocked) throw new ServiceError('CONFLICT', blocked);
          }
          o.status = to;
          o.updatedAt = nowIso();
          ctx.db.events.push({
            id: newId('7777'),
            orderId: o.id,
            actorId: u.profile.id,
            actorName: actorName(u),
            eventType: to,
            notes: note?.trim() || null,
            proofImagePath: null,
            codAmount: null,
            createdAt: o.updatedAt,
          });
          return orderDetail(o);
        }, 0.9),

      cancel: (id, { reason, idempotencyKey }) =>
        write(() => {
          const u = requireMerchant();
          const o = ownedOrder(id);
          if (seen(`order-cancel:${o.id}`, idempotencyKey)) return orderDetail(o);
          if (!canCancelOrder(o.status)) {
            throw new ServiceError('CONFLICT', 'Orders that are out for delivery or delivered cannot be cancelled.');
          }
          if (!reason || reason.trim().length < 5)
            throw new ServiceError('VALIDATION', 'A cancellation reason is required.', { reason: 'A cancellation reason is required.' });
          o.status = 'cancelled';
          o.cancellationReason = reason.trim();
          o.updatedAt = nowIso();
          // Atomic + idempotent stock release (FR-M-31): only once per order.
          const alreadyReleased = ctx.db.movements.some((m) => m.reason === 'cancellation_release' && m.referenceId === o.orderNumber);
          if (!alreadyReleased) {
            for (const it of o.items) {
              const p = ctx.db.products.find((x) => x.id === it.productId);
              if (!p) continue;
              if (p.productType === 'simple') p.stockQuantity = (p.stockQuantity ?? 0) + it.quantity;
              else {
                const v = p.variants.find((x) => x.id === it.variantId);
                if (v) v.stockQuantity += it.quantity;
              }
              recordMovement({
                storeId: o.storeId,
                productId: it.productId,
                variantId: it.variantId,
                productName: it.productName,
                variantLabel: it.variantLabel,
                quantityDelta: it.quantity,
                reason: 'cancellation_release',
                actorId: u.profile.id,
                actorName: actorName(u),
                referenceType: 'order',
                referenceId: o.orderNumber,
                note: o.cancellationReason,
              });
            }
          }
          ctx.db.events.push({
            id: newId('7777'),
            orderId: o.id,
            actorId: u.profile.id,
            actorName: actorName(u),
            eventType: 'cancelled',
            notes: o.cancellationReason,
            proofImagePath: null,
            codAmount: null,
            createdAt: o.updatedAt,
          });
          return orderDetail(o);
        }, 1.1),

      recordCodCollection: (id, { amount, note, idempotencyKey }) =>
        write(() => {
          const u = requireMerchant();
          const o = ownedOrder(id);
          if (seen(`order-cod:${o.id}`, idempotencyKey)) return orderDetail(o);
          if (!canRecordCodCollection(o)) {
            throw new ServiceError(
              'CONFLICT',
              'COD collection can be recorded only for cash-on-delivery orders that are out for delivery or delivered and not yet collected.',
            );
          }
          if (Math.abs(amount - o.totalAmount) >= 0.005) {
            throw new ServiceError('VALIDATION', 'Collected amount must match the order total.', { amount: 'Collected amount must match the order total.' });
          }
          o.paymentStatus = 'cod_collected';
          o.updatedAt = nowIso();
          // Option B: the COD attempt becomes paid when cash is collected.
          const codAttempt = ctx.db.payments.filter((p) => p.orderId === o.id && p.method === 'cod' && p.status !== 'paid').at(-1);
          if (codAttempt) {
            codAttempt.status = 'paid';
            codAttempt.verifiedAt = o.updatedAt;
          }
          ctx.db.events.push({
            id: newId('7777'),
            orderId: o.id,
            actorId: u.profile.id,
            actorName: actorName(u),
            eventType: 'cod_collected',
            notes: note?.trim() || null,
            proofImagePath: null,
            codAmount: amount,
            createdAt: o.updatedAt,
          });
          return orderDetail(o);
        }, 0.9),

      reviewPayment: (id, { decision, reason, idempotencyKey }) =>
        write(() => {
          const u = requireMerchant();
          const o = ownedOrder(id);
          if (seen(`order-payment-review:${o.id}`, idempotencyKey)) return orderDetail(o);
          if (!canManuallyReviewPayment(o)) {
            throw new ServiceError('CONFLICT', 'Only wallet or card payments awaiting verification can be reviewed manually.');
          }
          if (reason.trim().length < 5) {
            throw new ServiceError('VALIDATION', 'Say what you checked (for example the wallet statement).', { reason: 'Say what you checked.' });
          }
          const attempt = ctx.db.payments.filter((p) => p.orderId === o.id && p.status === 'pending_verification').at(-1);
          if (attempt) {
            attempt.status = decision;
            attempt.verifiedAt = nowIso();
          }
          o.paymentStatus = decision;
          o.updatedAt = nowIso();
          ctx.audit(u, 'payment_transaction.manual_review', 'payment_transaction', attempt?.id ?? null, {
            order: o.orderNumber,
            decision,
            reason: reason.trim().slice(0, 200),
          });
          if (o.customerId) {
            notify(o.customerId, {
              type: 'payment',
              title: decision === 'paid' ? 'Payment confirmed' : 'Payment could not be verified',
              body:
                decision === 'paid'
                  ? `Your ${PAYMENT_METHOD_LABEL[o.paymentMethod]} payment for ${o.orderNumber} was confirmed.`
                  : `We couldn't verify your ${PAYMENT_METHOD_LABEL[o.paymentMethod]} payment for ${o.orderNumber}. The store will contact you.`,
              referenceType: 'order',
              referenceId: o.id,
            });
          }
          return orderDetail(o);
        }, 0.9),

      deliveryHistoryCsv: (range) =>
        read(() => {
          const store = requireStore();
          // Delivery history is recorded by the merchant (no Delivery Agent role in this release).
          const rows: (string | number | null)[][] = [
            [
              'Order',
              'Customer',
              'Phone',
              'District',
              'Status',
              'Payment',
              'Total (BDT)',
              'Shipped at',
              'Out for delivery at',
              'Delivered at',
              'COD collected',
            ],
          ];
          const at = (oid: string, ev: string) =>
            ctx.db.events
              .find((e) => e.orderId === oid && e.eventType === ev)
              ?.createdAt.slice(0, 16)
              .replace('T', ' ') ?? null;
          for (const o of ctx.db.orders
            .filter((x) => x.storeId === store.id && !x.isTest && ['shipped', 'out_for_delivery', 'delivered'].includes(x.status))
            .filter((x) => x.createdAt.slice(0, 10) >= range.from && x.createdAt.slice(0, 10) <= range.to)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
            rows.push([
              o.orderNumber,
              o.customerName,
              o.orderPhone,
              o.deliveryAddress.district,
              ORDER_STATUS_LABEL[o.status],
              PAYMENT_METHOD_LABEL[o.paymentMethod],
              o.totalAmount,
              at(o.id, 'shipped'),
              at(o.id, 'out_for_delivery'),
              at(o.id, 'delivered'),
              o.paymentStatus === 'cod_collected' ? 'Yes' : o.paymentMethod === 'cod' ? 'No' : '—',
            ]);
          }
          return { filename: `${store.subdomain}-delivery-history-${range.from}-to-${range.to}.csv`, csv: toCsv(rows) };
        }),
    },

    /* ----------------------------- Customers -------------------------- */
    customers: {
      list: (filters = {}) =>
        read(() => {
          const store = requireStore();
          const q = filters.search?.trim().toLowerCase();
          return deriveCustomers(store.id)
            .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email ?? '').toLowerCase().includes(q))
            .filter((c) => !filters.accountType || filters.accountType === 'all' || c.accountType === filters.accountType);
        }),

      get: (id) =>
        read(() => {
          const store = requireStore();
          const customer = deriveCustomers(store.id).find((c) => c.id === id);
          if (!customer) throw new ServiceError('NOT_FOUND', 'This customer has no orders in your store.');
          const orders = ctx.db.orders
            .filter((o) => o.storeId === store.id && (o.customerId ?? `guest:${o.orderPhone}`) === id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return { customer, orders };
        }),
    },

    /* ------------------------- Payment configs ------------------------ */
    payments: {
      list: () =>
        read(() => {
          const store = requireStore();
          return ensureConfigs(store.id);
        }),

      setEnabled: (method: PaymentMethod, enabled: boolean) =>
        write(() => {
          const store = requireStore();
          const configs = ensureConfigs(store.id);
          const c = configs.find((x) => x.method === method)!;
          if (enabled && method !== 'cod' && c.validation !== 'valid') {
            throw new ServiceError('VALIDATION', `Add and verify your ${PAYMENT_METHOD_LABEL[method]} credentials before enabling it.`);
          }
          if (!enabled && store.status === 'published' && configs.filter((x) => x.isEnabled && x.method !== method).length === 0) {
            throw new ServiceError(
              'VALIDATION',
              'A published store needs at least one active payment method. Enable another method first or unpublish the store.',
            );
          }
          c.isEnabled = enabled; // affects future orders only (FR-M-32)
          c.updatedAt = nowIso();
          return c;
        }, 0.7),

      saveCredentials: (credentials) =>
        write(() => {
          const store = requireStore();
          const schema = credentialSchemas[credentials.method];
          const res = schema.safeParse(credentials.values);
          if (!res.success) throw new ServiceError('VALIDATION', 'Please fix the highlighted fields.', toFieldErrors(res.error));
          const c = ensureConfigs(store.id).find((x) => x.method === credentials.method)!;
          const values = credentials.values as unknown as Record<string, string>;
          const identifier = values.merchantNumber ?? values.storeId ?? values.merchantId ?? '';
          // Simulated gateway check — raw provider errors are never surfaced (FR-M-34).
          const invalid =
            credentials.method === 'sslcommerz' && (values.storePassword?.toLowerCase().includes('invalid') || values.storeId?.toLowerCase().startsWith('bad'));
          c.hasCredentials = true;
          c.credentialHint = maskSecret(identifier);
          c.updatedAt = nowIso();
          if (invalid) {
            c.validation = 'invalid';
            c.isEnabled = false;
            notify(store.ownerId, {
              type: 'payment',
              title: 'SSLCommerz disabled',
              body: 'We could not verify your SSLCommerz credentials, so SSLCommerz has been turned off. Check the Store ID and password and try again.',
              referenceType: 'store',
              referenceId: store.id,
            });
          } else {
            c.validation = 'valid';
          }
          // Raw values are discarded here; the real Edge Function encrypts them server-side.
          return c;
        }, 1.8),
    },

    /* ----------------------------- Analytics -------------------------- */
    analytics: {
      dashboard: (range) =>
        read(() => {
          const u = requireMerchant();
          const store = requireStore();
          return buildDashboard(ctx.db, store, u.profile.id, range, now());
        }, 1.2),
      report: (range) =>
        read(() => {
          const store = requireStore();
          return analyticsReport(ctx.db, store, range, now());
        }, 1.4),
      exportCsv: (range) =>
        read(() => {
          const store = requireStore();
          return exportAnalyticsCsv(ctx.db, store, range);
        }),
    },

    /* ------------------------------ Support --------------------------- */
    support: {
      list: (filters = {}) =>
        read(() => {
          const store = requireStore();
          const q = filters.search?.trim().toLowerCase();
          return ctx.db.tickets
            .filter((t) => t.storeId === store.id)
            .filter((t) => !filters.status || filters.status === 'all' || t.status === filters.status)
            .filter((t) => !q || t.subject.toLowerCase().includes(q) || t.ticketNumber.toLowerCase().includes(q) || t.customerName.toLowerCase().includes(q))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }),

      get: (id) => read(() => ticketDetail(id)),

      reply: (id, { body, attachment }) =>
        write(() => {
          const u = requireMerchant();
          const store = requireStore();
          const t = ownedTicket(id);
          if (!canReplyToTicket(t.status)) throw new ServiceError('CONFLICT', 'Closed tickets are read-only.');
          if (!body.trim()) throw new ServiceError('VALIDATION', 'Write a reply.', { body: 'Write a reply.' });
          if (attachment) {
            const err = validateAttachmentFile(attachment);
            if (err) throw new ServiceError('VALIDATION', err, { attachment: err });
          }
          const msgId = newId('2223');
          const createdAt = nowIso();
          ctx.db.messages.push({
            id: msgId,
            ticketId: t.id,
            senderId: u.profile.id,
            senderName: `${u.profile.fullName} (${store.name})`,
            senderRole: 'merchant',
            body: body.trim(),
            attachmentName: attachment?.name ?? null,
            attachmentStoragePath: attachment ? `tickets/${t.id}/${msgId}-${attachment.name}` : null,
            createdAt,
          });
          t.firstMerchantResponseAt = t.firstMerchantResponseAt ?? createdAt;
          t.updatedAt = createdAt;
          ctx.db.ticketAudit.push({
            id: newId('2224'),
            ticketId: t.id,
            actorName: u.profile.fullName,
            eventType: 'reply',
            previousValue: null,
            newValue: null,
            createdAt,
          });
          return ticketDetail(t.id);
        }, 0.9),

      updateStatus: (id, to, input = {}) =>
        write(() => {
          const u = requireMerchant();
          const t = ownedTicket(id);
          if (!canTransitionTicket(t.status, to))
            throw new ServiceError('CONFLICT', 'That status change is not allowed for this ticket. Refresh to see its latest state.');
          if (to === 'resolved') {
            const note = input.resolutionNote?.trim() ?? '';
            if (note.length < 5)
              throw new ServiceError('VALIDATION', 'A resolution note is required to resolve a ticket.', { resolutionNote: 'A resolution note is required.' });
            t.resolutionNote = note;
          }
          const prev = t.status;
          t.status = to;
          t.updatedAt = nowIso();
          if (to === 'closed') t.closedAt = t.updatedAt;
          ctx.db.ticketAudit.push({
            id: newId('2224'),
            ticketId: t.id,
            actorName: u.profile.fullName,
            eventType: to === 'closed' ? 'closed' : 'status_changed',
            previousValue: prev,
            newValue: to,
            createdAt: t.updatedAt,
          });
          return ticketDetail(t.id);
        }, 0.8),
    },

    /* --------------------------- Notifications ------------------------ */
    notifications: {
      list: (filters = {}) =>
        read(() => {
          const u = currentUser();
          return ctx.db.notifications.filter((n) => n.userId === u.profile.id && (!filters.unreadOnly || !n.isRead));
        }, 0.6),
      unreadCount: () =>
        read(() => {
          const u = ctx.db.users.find((x) => x.profile.id === ctx.db.currentUserId);
          return u ? ctx.db.notifications.filter((n) => n.userId === u.profile.id && !n.isRead).length : 0;
        }, 0.2),
      markRead: (id) =>
        write(() => {
          const u = currentUser();
          const n = ctx.db.notifications.find((x) => x.id === id && x.userId === u.profile.id);
          if (n) n.isRead = true; // recipient may change is_read only
        }, 0.3),
      markAllRead: () =>
        write(() => {
          const u = currentUser();
          ctx.db.notifications.forEach((n) => {
            if (n.userId === u.profile.id) n.isRead = true;
          });
        }, 0.5),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      registerDevice: ({ token, platform }) =>
        write(() => {
          const u = currentUser();
          if (!/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) throw new ServiceError('VALIDATION', 'Invalid device token.');
          const existing = ctx.db.deviceTokens.find((d) => d.token === token);
          if (existing) {
            existing.userId = u.profile.id; // a device follows whoever is signed in
            existing.lastSeenAt = nowIso();
            const { token: _raw, ...safe } = existing;
            return safe;
          }
          const d = { id: newId('dddd'), userId: u.profile.id, token, tokenHint: maskSecret(token), platform, createdAt: nowIso(), lastSeenAt: nowIso() };
          ctx.db.deviceTokens.push(d);
          const { token: _raw, ...safe } = d;
          return safe;
        }, 0.4),
      unregisterDevice: (token) =>
        write(() => {
          ctx.db.deviceTokens = ctx.db.deviceTokens.filter((d) => d.token !== token);
        }, 0.3),
    },
  };

  function isTaken(sub: string): boolean {
    const mine = ctx.db.stores.find((s) => s.ownerId === ctx.db.currentUserId);
    return ctx.db.takenSubdomains.includes(sub) || ctx.db.stores.some((s) => s.subdomain === sub && s.id !== mine?.id);
  }

  return services;
}
