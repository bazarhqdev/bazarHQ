/**
 * Public storefront reads, order placement and payment flows (API-04..07,
 * API-20/21/25/32/33/41). Store context is always explicit: no endpoint
 * returns products across stores (FR-C-01/37).
 */
import { ADMIN_LIMITS, DHAKA_DISTRICT, PAYMENT_METHOD_LABEL } from '../../constants';
import { formatPublicId, productSlug } from '../../formatters';
import { normalizeSubdomain } from '../../formatters/subdomain';
import { productPriceRange, productTotalStock } from '../../domain';
import type { Cart, CartLineCheck, Order, OrderItem, PaymentTransactionSummary, Product, StoreSearchResult, TrackingResult } from '../../types';
import { bdPhoneSchema, checkoutDeliverySchema, toFieldErrors, walletReferenceSchema } from '../../validation';
import { ServiceError, type CheckoutService, type StorefrontService } from '../contracts';
import type { MockContext } from './context';
import type { StoredProduct } from './seed';

/** Sandbox: these providers have a verification API in the mock; Rocket needs manual review. */
const AUTO_VERIFY = new Set(['bkash', 'nagad']);

export function createStorefrontServices(ctx: MockContext): { storefront: StorefrontService; checkout: CheckoutService } {
  const { read, write, nowIso, newId, notify, seen, recordMovement, maybeLowStockAlert, ensureConfigs, storefrontProjection, ownerOf, deliveredAt } = ctx;

  const unavailable = () => new ServiceError('NOT_FOUND', 'This store is unavailable. Check the address or search for another store.');

  function publishedStore(idOrSub: string) {
    const key = normalizeSubdomain(idOrSub);
    const s = ctx.db.stores.find((x) => x.id === idOrSub || x.subdomain === key);
    if (!s || s.status !== 'published') throw unavailable();
    return s;
  }

  function visibleProducts(storeId: string): StoredProduct[] {
    return ctx.db.products.filter((p) => p.storeId === storeId && p.status === 'active' && !p.deletedAt);
  }

  function searchRow(s: (typeof ctx.db.stores)[number]): StoreSearchResult {
    return {
      id: s.id,
      name: s.name,
      subdomain: s.subdomain,
      tagline: s.tagline,
      logoUrl: s.logoUrl,
      brandColour: s.brandColour,
      category: s.extensions.category,
      productCount: visibleProducts(s.id).length,
    };
  }

  function unitPrice(p: Product, variantId: string | null) {
    const v = variantId ? p.variants.find((x) => x.id === variantId) : null;
    return p.basePrice + (v?.priceAdjustment ?? 0);
  }

  function stockFor(p: Product, variantId: string | null): number {
    if (p.productType === 'simple') return p.stockQuantity ?? 0;
    const v = p.variants.find((x) => x.id === variantId);
    return v && v.status === 'active' ? v.stockQuantity : 0;
  }

  function deliveryCharge(storeId: string, district: string | undefined) {
    const s = ctx.db.stores.find((x) => x.id === storeId)!;
    if (!district) return s.extensions.shipping.insideDhakaCharge;
    return district === DHAKA_DISTRICT ? s.extensions.shipping.insideDhakaCharge : s.extensions.shipping.outsideDhakaCharge;
  }

  function checkLines(storeId: string, items: Cart['items']): CartLineCheck[] {
    return items.map((it) => {
      const p = ctx.db.products.find((x) => x.id === it.productId && x.storeId === storeId && x.status === 'active' && !x.deletedAt);
      if (!p || (p.productType === 'variant' && !it.variantId)) {
        return {
          productId: it.productId,
          variantId: it.variantId,
          available: false,
          availableStock: 0,
          currentUnitPrice: it.unitPrice,
          priceChanged: false,
          quantityCapped: false,
          quantity: 0,
        };
      }
      const stock = stockFor(p, it.variantId);
      const price = unitPrice(p, it.variantId);
      const qty = Math.min(it.quantity, stock);
      return {
        productId: it.productId,
        variantId: it.variantId,
        available: stock > 0,
        availableStock: stock,
        currentUnitPrice: price,
        priceChanged: Math.abs(price - it.unitPrice) > 0.004,
        quantityCapped: qty < it.quantity,
        quantity: qty,
      };
    });
  }

  function orderByNumberAndPhone(orderNumber: string, phone: string): Order {
    const o = ctx.db.orders.find((x) => x.orderNumber === orderNumber.trim().toUpperCase());
    // FR-C-27: identical response whether the order is missing or the phone doesn't match.
    if (!o || o.orderPhone !== phone.trim()) throw new ServiceError('NOT_FOUND', 'Order not found. Check the Order ID and the phone number used at checkout.');
    return o;
  }

  function verifyAttempt(attempt: PaymentTransactionSummary, order: Order, outcome: 'paid' | 'failed', source: string) {
    attempt.status = outcome;
    attempt.verifiedAt = nowIso();
    order.paymentStatus = outcome;
    order.updatedAt = nowIso();
    ctx.audit(null, 'payment_transaction.status_changed', 'payment_transaction', attempt.id, { order_id: order.id, new_status: outcome, source });
    const store = ctx.db.stores.find((s) => s.id === order.storeId)!;
    notify(store.ownerId, {
      type: 'payment',
      title: outcome === 'paid' ? 'Payment verified' : 'Payment failed',
      body: `${PAYMENT_METHOD_LABEL[order.paymentMethod]} payment for ${order.orderNumber} ${outcome === 'paid' ? 'was verified' : 'failed verification'}.`,
      referenceType: 'order',
      referenceId: order.id,
    });
    if (order.customerId) {
      notify(order.customerId, {
        type: 'payment',
        title: outcome === 'paid' ? 'Payment confirmed' : 'Payment failed',
        body: `${order.orderNumber}: ${outcome === 'paid' ? 'your payment was confirmed.' : 'your payment could not be verified. You can retry from your order page.'}`,
        referenceType: 'order',
        referenceId: order.id,
      });
    }
  }

  const storefront: StorefrontService = {
    searchStores: (q) =>
      read(() => {
        const term = q.trim().toLowerCase();
        if (term.length < 2) return [];
        // Store discovery only — never product search across stores (DB-07).
        return ctx.db.stores
          .filter((s) => s.status === 'published')
          .filter((s) => s.name.toLowerCase().includes(term) || s.subdomain.includes(term.replace(/\s+/g, '')))
          .map(searchRow);
      }, 0.5),

    featuredStores: () => read(() => ctx.db.stores.filter((s) => s.status === 'published').map(searchRow), 0.4),

    resolveStore: (sub) => read(() => storefrontProjection(publishedStore(sub)), 0.4),

    listCategories: (storeId) =>
      read(() => {
        const s = publishedStore(storeId);
        const visible = visibleProducts(s.id);
        return ctx.db.categories
          .filter((c) => c.storeId === s.id)
          .map((c) => ({ ...c, productCount: visible.filter((p) => p.categoryId === c.id).length }))
          .filter((c) => c.productCount > 0)
          .sort((a, b) => a.displayOrder - b.displayOrder);
      }, 0.3),

    listProducts: (storeId, filters = {}) =>
      read(() => {
        const s = publishedStore(storeId);
        const q = filters.search?.trim().toLowerCase();
        const sales = new Map<string, number>();
        for (const o of ctx.db.orders)
          if (o.storeId === s.id && !o.isTest && o.status !== 'cancelled') for (const it of o.items) sales.set(it.productId, (sales.get(it.productId) ?? 0) + it.quantity);
        const list = visibleProducts(s.id)
          .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
          .filter((p) => !filters.categoryId || filters.categoryId === 'all' || p.categoryId === filters.categoryId)
          .filter((p) => filters.minPrice === undefined || productPriceRange(p)[1] >= filters.minPrice)
          .filter((p) => filters.maxPrice === undefined || productPriceRange(p)[0] <= filters.maxPrice)
          .filter((p) => !filters.inStockOnly || productTotalStock(p) > 0)
          .map(ctx.stripProduct);
        const sort = filters.sort ?? 'popular';
        list.sort((a, b) => {
          if (sort === 'price_asc') return productPriceRange(a)[0] - productPriceRange(b)[0];
          if (sort === 'price_desc') return productPriceRange(b)[0] - productPriceRange(a)[0];
          if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
          return (sales.get(b.id) ?? 0) - (sales.get(a.id) ?? 0);
        });
        return list;
      }, 0.5),

    getProduct: (storeId, productIdOrSlug) =>
      read(() => {
        const s = publishedStore(storeId);
        const list = visibleProducts(s.id);
        const key = productIdOrSlug.toLowerCase();
        // Slugs are derived from names; when two products share a name the oldest wins and the other stays reachable by id.
        const p =
          list.find((x) => x.id === productIdOrSlug) ?? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).find((x) => productSlug(x) === key);
        if (!p) throw new ServiceError('NOT_FOUND', 'This product is no longer available in this store.');
        const related = visibleProducts(s.id)
          .filter((x) => x.id !== p.id && x.categoryId === p.categoryId)
          .slice(0, 4)
          .map(ctx.stripProduct);
        return { product: ctx.stripProduct(p), categoryName: ctx.categoryName(p.categoryId), related };
      }, 0.4),

    validateCart: (storeId, items, district) =>
      read(() => {
        const s = publishedStore(storeId);
        const lines = checkLines(s.id, items);
        const subtotal = lines.reduce((sum, l) => sum + l.currentUnitPrice * l.quantity, 0);
        const charge = subtotal > 0 ? deliveryCharge(s.id, district) : 0;
        return {
          lines,
          subtotal,
          deliveryCharge: charge,
          total: subtotal + charge,
          hasChanges: lines.some((l) => l.priceChanged || l.quantityCapped || !l.available),
        };
      }, 0.4),

    getPublishedPolicy: (type) => read(() => ctx.db.policies.find((p) => p.type === type && p.status === 'published') ?? null, 0.3),

    trackOrder: (orderNumber, phone) =>
      write(() => {
        // API-32: rate limited per caller (mock: per browser).
        const t = ctx.now().getTime();
        ctx.db.trackAttempts = ctx.db.trackAttempts.filter((x) => t - x < 60_000);
        if (ctx.db.trackAttempts.length >= ADMIN_LIMITS.trackingAttemptsPerMinute) {
          throw new ServiceError('RATE_LIMITED', 'Too many tracking attempts. Wait a minute and try again.');
        }
        ctx.db.trackAttempts.push(t);
        const o = orderByNumberAndPhone(orderNumber, phone);
        const store = ctx.db.stores.find((s) => s.id === o.storeId)!;
        const owner = ownerOf(store.id);
        const delivered = deliveredAt(o.id);
        const result: TrackingResult = {
          orderNumber: o.orderNumber,
          storeName: store.name,
          storeSubdomain: store.subdomain,
          status: o.status,
          paymentStatus: o.paymentStatus,
          paymentMethod: o.paymentMethod,
          items: o.items.map((i) => ({
            productName: i.productName,
            variantLabel: i.variantLabel,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
          })),
          subtotal: o.subtotal,
          deliveryCharge: o.deliveryCharge,
          totalAmount: o.totalAmount,
          deliveryAddress: o.deliveryAddress,
          cancellationReason: o.cancellationReason,
          events: ctx.db.events
            .filter((e) => e.orderId === o.id)
            .map((e) => ({ eventType: e.eventType, createdAt: e.createdAt }))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          merchantContact: { phone: owner?.profile.phone ?? null, email: owner?.profile.email ?? null },
          createdAt: o.createdAt,
          archived: Boolean(delivered && t - Date.parse(delivered) > ADMIN_LIMITS.trackingArchiveDays * 86_400_000),
        };
        return result;
      }, 0.6),
  };

  const checkout: CheckoutService = {
    placeOrder: (input) =>
      write(() => {
        const s = publishedStore(input.storeId);
        const me = ctx.currentUserOrNull();
        const customer = me && me.profile.role === 'customer' && me.profile.status === 'active' ? me : null;

        // Idempotent: a retried submission returns the original order (API-07).
        const existingId = ctx.db.idempotency[`order:${input.idempotencyKey}`];
        if (existingId) {
          const existing = ctx.db.orders.find((o) => o.id === existingId);
          if (existing) {
            const payment = ctx.db.payments.filter((p) => p.orderId === existing.id).at(-1) ?? null;
            return { order: existing, payment, nextAction: nextActionFor(existing) };
          }
        }

        const delivery = checkoutDeliverySchema.safeParse({
          ...input.delivery,
          email: input.delivery.email ?? '',
          postalCode: input.delivery.postalCode ?? '',
          saveAddress: input.saveAddress,
        });
        if (!delivery.success) throw new ServiceError('VALIDATION', 'Please fix the delivery details.', toFieldErrors(delivery.error));
        if (input.items.length === 0) throw new ServiceError('VALIDATION', 'Your cart is empty.');

        const config = ensureConfigs(s.id).find((c) => c.method === input.paymentMethod);
        if (!config?.isEnabled)
          throw new ServiceError('CONFLICT', `${PAYMENT_METHOD_LABEL[input.paymentMethod]} is not available for this store. Choose another payment method.`);

        // Validate every line against current price and stock BEFORE any write (atomic in the real Edge Function).
        const resolved = input.items.map((it) => {
          const p = ctx.db.products.find((x) => x.id === it.productId && x.storeId === s.id && x.status === 'active' && !x.deletedAt);
          if (!p) throw new ServiceError('CONFLICT', 'An item in your cart is no longer available. Review your cart.');
          if (p.productType === 'variant') {
            const v = p.variants.find((x) => x.id === it.variantId && x.status === 'active');
            if (!v) throw new ServiceError('CONFLICT', `Choose an available option for ${p.name}.`);
          } else if (it.variantId) throw new ServiceError('VALIDATION', 'Invalid item option.');
          const price = unitPrice(p, it.variantId);
          if (Math.abs(price - it.expectedUnitPrice) > 0.004) {
            throw new ServiceError('CONFLICT', `The price of ${p.name} changed to ৳${price}. Review your cart before ordering.`);
          }
          if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new ServiceError('VALIDATION', 'Invalid quantity.');
          const stock = stockFor(p, it.variantId);
          if (it.quantity > stock) {
            throw new ServiceError(
              'CONFLICT',
              stock === 0 ? `${p.name} just sold out. Remove it to continue.` : `Only ${stock} of ${p.name} left. Reduce the quantity to continue.`,
            );
          }
          return { p, it, price };
        });

        const created = ctx.now();
        const oid = newId('9999');
        const orderNumber = formatPublicId('ORD', created, ++ctx.db.seq.order);
        const items: OrderItem[] = resolved.map(({ p, it, price }) => ({
          id: newId('8888'),
          orderId: oid,
          productId: p.id,
          variantId: it.variantId,
          productName: p.name,
          variantLabel: it.variantId ? (p.variants.find((v) => v.id === it.variantId)?.variantLabel ?? null) : null,
          quantity: it.quantity,
          unitPrice: price,
          subtotal: price * it.quantity,
        }));
        const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
        const charge = deliveryCharge(s.id, delivery.data.district);
        const d = delivery.data;
        const order: Order = {
          id: oid,
          orderNumber,
          storeId: s.id,
          customerId: customer?.profile.id ?? null,
          customerName: d.recipientName,
          orderPhone: d.phone,
          orderEmail: d.email || customer?.profile.email || null,
          status: 'pending',
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === 'cod' ? 'cod_pending' : 'pending',
          isTest: false,
          testReason: null,
          testMarkedAt: null,
          subtotal,
          deliveryCharge: charge,
          totalAmount: subtotal + charge,
          currency: 'BDT',
          deliveryAddress: { recipientName: d.recipientName, phone: d.phone, address: d.address, district: d.district, postalCode: d.postalCode || null },
          cancellationReason: null,
          items,
          createdAt: created.toISOString(),
          updatedAt: created.toISOString(),
        };

        // Stock decrement + ledger (FR-C-21, DB-03).
        for (const { p, it } of resolved) {
          const before = stockFor(p, it.variantId);
          if (p.productType === 'simple') p.stockQuantity = before - it.quantity;
          else p.variants.find((v) => v.id === it.variantId)!.stockQuantity = before - it.quantity;
          const label = it.variantId ? (p.variants.find((v) => v.id === it.variantId)?.variantLabel ?? null) : null;
          recordMovement({
            storeId: s.id,
            productId: p.id,
            variantId: it.variantId,
            productName: p.name,
            variantLabel: label,
            quantityDelta: -it.quantity,
            reason: 'sale',
            actorId: null,
            actorName: 'System',
            referenceType: 'order',
            referenceId: orderNumber,
            note: null,
          });
          maybeLowStockAlert(p, before, before - it.quantity, label);
        }
        ctx.db.orders.push(order);
        ctx.db.events.push({
          id: newId('7777'),
          orderId: oid,
          actorId: null,
          actorName: 'System',
          eventType: 'pending',
          notes: 'Order placed by customer.',
          proofImagePath: null,
          codAmount: null,
          createdAt: order.createdAt,
        });
        ctx.db.idempotency[`order:${input.idempotencyKey}`] = oid;

        // create_payment_attempt (migration 004): pending order, enabled matching config, one active attempt.
        const attempt: PaymentTransactionSummary = {
          id: newId('6666'),
          orderId: oid,
          method: input.paymentMethod,
          provider: input.paymentMethod,
          status: 'pending',
          amount: order.totalAmount,
          currency: 'BDT',
          providerReferenceMasked: null,
          createdAt: order.createdAt,
          verifiedAt: null,
        };
        ctx.db.payments.push(attempt);
        ctx.audit(customer, 'payment_transaction.created', 'payment_transaction', attempt.id, {
          order_id: oid,
          method: attempt.method,
          amount: attempt.amount,
        });

        // Saved address (FR-C-33) for registered customers.
        if (customer && input.saveAddress && ctx.db.addresses.filter((a) => a.customerId === customer.profile.id).length < ADMIN_LIMITS.maxSavedAddresses) {
          const dup = ctx.db.addresses.some((a) => a.customerId === customer.profile.id && a.address === d.address && a.phone === d.phone);
          if (!dup) {
            const first = !ctx.db.addresses.some((a) => a.customerId === customer.profile.id);
            ctx.db.addresses.push({
              id: newId('ad01'),
              customerId: customer.profile.id,
              label: first ? 'Home' : 'Saved address',
              recipientName: d.recipientName,
              phone: d.phone,
              address: d.address,
              district: d.district,
              postalCode: d.postalCode || null,
              isDefault: first,
              createdAt: nowIso(),
              updatedAt: nowIso(),
            });
          }
        }

        // FR-M-24 / FR-C-20: merchant alert; customer confirmation (SMS/email delivered by the notification adapter).
        notify(s.ownerId, {
          type: 'new_order',
          title: 'New order received',
          body: `${orderNumber} from ${order.customerName} • ৳${order.totalAmount}`,
          referenceType: 'order',
          referenceId: oid,
        });
        if (customer)
          notify(customer.profile.id, {
            type: 'order_status',
            title: 'Order placed',
            body: `${orderNumber} at ${s.name} • ৳${order.totalAmount}. We sent a confirmation SMS to ${d.phone}.`,
            referenceType: 'order',
            referenceId: oid,
          });

        return { order, payment: attempt, nextAction: nextActionFor(order) };
      }, 1.4),

    submitWalletReference: (orderId, { phone, reference, idempotencyKey }) =>
      write(() => {
        const order = ctx.db.orders.find((o) => o.id === orderId);
        if (!order || order.orderPhone !== phone) throw new ServiceError('NOT_FOUND', 'Order not found.');
        if (!['bkash', 'nagad', 'rocket'].includes(order.paymentMethod)) throw new ServiceError('VALIDATION', 'This order does not use a mobile wallet.');
        const ref = walletReferenceSchema.safeParse({ reference });
        if (!ref.success) throw new ServiceError('VALIDATION', 'Check the transaction ID.', toFieldErrors(ref.error));
        let attempt = ctx.db.payments.filter((p) => p.orderId === order.id).at(-1);
        if (seen(`wallet-ref:${order.id}`, idempotencyKey) && attempt) return { paymentStatus: order.paymentStatus, payment: attempt };
        if (order.status !== 'pending' || !['pending', 'failed'].includes(order.paymentStatus)) {
          throw new ServiceError(
            'CONFLICT',
            order.paymentStatus === 'pending_verification' ? 'This payment is already being verified.' : 'This order no longer accepts a payment.',
          );
        }
        if (!attempt || attempt.status === 'failed') {
          attempt = {
            id: newId('6666'),
            orderId: order.id,
            method: order.paymentMethod,
            provider: order.paymentMethod,
            status: 'pending',
            amount: order.totalAmount,
            currency: 'BDT',
            providerReferenceMasked: null,
            createdAt: nowIso(),
            verifiedAt: null,
          };
          ctx.db.payments.push(attempt);
        }
        const value = ref.data.reference;
        if (
          ctx.db.payments.some(
            (p) =>
              p.provider === order.paymentMethod && p.providerReferenceMasked === `••••${value.slice(-4)}` && p.orderId !== order.id && p.status === 'paid',
          )
        ) {
          throw new ServiceError('CONFLICT', 'This transaction ID was already used for another order.');
        }
        // record_payment_transaction_state(pending → pending_verification, reference once).
        attempt.status = 'pending_verification';
        attempt.providerReferenceMasked = `••••${value.slice(-4)}`;
        order.paymentStatus = 'pending_verification';
        order.updatedAt = nowIso();
        ctx.audit(null, 'payment_transaction.provider_reference_attached', 'payment_transaction', attempt.id, { order_id: order.id });
        if (AUTO_VERIFY.has(order.paymentMethod)) {
          // Simulated provider verification API: references starting with FAIL are rejected.
          verifyAttempt(attempt, order, value.startsWith('FAIL') ? 'failed' : 'paid', 'provider_verification');
        } else {
          const store = ctx.db.stores.find((x) => x.id === order.storeId)!;
          notify(store.ownerId, {
            type: 'payment',
            title: 'Payment needs manual review',
            body: `${PAYMENT_METHOD_LABEL[order.paymentMethod]} reference received for ${order.orderNumber}. Verify it in your provider dashboard.`,
            referenceType: 'order',
            referenceId: order.id,
          });
        }
        return { paymentStatus: order.paymentStatus, payment: attempt };
      }, 1.6),

    startSslcommerz: (orderId, { phone }) =>
      write(() => {
        const order = ctx.db.orders.find((o) => o.id === orderId);
        if (!order || order.orderPhone !== phone) throw new ServiceError('NOT_FOUND', 'Order not found.');
        if (order.paymentMethod !== 'sslcommerz') throw new ServiceError('VALIDATION', 'This order does not use card payment.');
        if (order.status !== 'pending' || !['pending', 'failed'].includes(order.paymentStatus))
          throw new ServiceError('CONFLICT', 'This order no longer accepts a payment.');
        let attempt = ctx.db.payments.filter((p) => p.orderId === order.id).at(-1);
        if (!attempt || attempt.status === 'failed') {
          attempt = {
            id: newId('6666'),
            orderId: order.id,
            method: 'sslcommerz',
            provider: 'sslcommerz',
            status: 'pending',
            amount: order.totalAmount,
            currency: 'BDT',
            providerReferenceMasked: null,
            createdAt: nowIso(),
            verifiedAt: null,
          };
          ctx.db.payments.push(attempt);
        }
        const token = newId('5551').replace(/-/g, '');
        ctx.db.sslSessions[token] = { orderId: order.id, attemptId: attempt.id, used: false, amount: order.totalAmount };
        return { redirectUrl: `/payment/sslcommerz-sandbox?session=${token}`, sessionToken: token };
      }, 0.8),

    completeSslcommerzSandbox: (token, outcome) =>
      write(() => {
        const session = ctx.db.sslSessions[token];
        if (!session) throw new ServiceError('NOT_FOUND', 'This payment session is invalid or has expired.');
        const order = ctx.db.orders.find((o) => o.id === session.orderId)!;
        const store = ctx.db.stores.find((s) => s.id === order.storeId)!;
        const attempt = ctx.db.payments.find((p) => p.id === session.attemptId)!;
        // Webhook replay protection: a used session never changes state again (API-21).
        if (!session.used && outcome !== 'cancelled' && attempt.status === 'pending') {
          session.used = true;
          attempt.providerReferenceMasked = `••••${token.slice(-4).toUpperCase()}`;
          verifyAttempt(attempt, order, outcome === 'success' ? 'paid' : 'failed', 'sslcommerz_webhook');
        }
        return { orderNumber: order.orderNumber, subdomain: store.subdomain, phone: order.orderPhone, paymentStatus: order.paymentStatus };
      }, 1.2),
  };

  function nextActionFor(o: Order) {
    if (o.paymentMethod === 'cod') return 'none' as const;
    if (o.paymentMethod === 'sslcommerz') return o.paymentStatus === 'paid' ? ('none' as const) : ('redirect_sslcommerz' as const);
    return o.paymentStatus === 'pending' || o.paymentStatus === 'failed' ? ('submit_wallet_reference' as const) : ('none' as const);
  }

  void bdPhoneSchema;
  return { storefront, checkout };
}
