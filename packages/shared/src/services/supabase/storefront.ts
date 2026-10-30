/**
 * Public storefront and checkout on Supabase (SRS §11, API-04..07, API-20..26).
 *
 * Reads: anonymous-safe RLS reads (published stores, active products) and
 * SECURITY DEFINER lookups that return only public fields (resolve_store,
 * search_stores, validate_cart, storefront_product_popularity).
 * Writes: Edge Functions only. Order creation, wallet references and card
 * payments never touch tables from the client, and no client call can set a
 * payment status.
 */
import { productPriceRange, productTotalStock } from '../../domain';
import { productSlug } from '../../formatters';
import type { CartLineCheck, PaymentTransactionSummary, Policy, Product, StoreSearchResult, StorefrontStore, TrackingResult } from '../../types';
import { ServiceError, type CheckoutService, type StorefrontService } from '../contracts';
import { idempotencyKeyFor, type AdapterContext } from './core';
import { mapCategory, mapDeliveryAddress, mapOrder, mapPayment, mapPolicy, mapProduct, mapStorefrontStore, PRODUCT_COLUMNS, productImagePaths } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC and PostgREST JSON is narrowed field by field */
type Row = Record<string, any>;

const UNAVAILABLE = 'This store is unavailable. It may be unpublished, suspended or the address may be wrong.';

export function createStorefront(ctx: AdapterContext) {
  const { sb } = ctx;

  async function searchRows(q: string, limit: number): Promise<StoreSearchResult[]> {
    const rows = await ctx.rpc<Row[]>('search_stores', { p_query: q, p_limit: limit });
    const urls = await ctx.signedUrls(
      'store-logos',
      rows.map((r) => r.logo_url),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      subdomain: r.subdomain,
      tagline: r.tagline ?? null,
      logoUrl: urls.get(r.logo_url) ?? null,
      brandColour: r.brand_colour,
      category: r.category ?? null,
      productCount: Number(r.product_count ?? 0),
    }));
  }

  /** Active, non-deleted products of a published store (RLS: products_select_published). */
  async function visibleProducts(storeId: string): Promise<Product[]> {
    const rows = await ctx.q<Row[]>(
      sb.from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId).eq('status', 'active').is('deleted_at', null).limit(2000),
    );
    const urls = await ctx.signedUrls('product-images', productImagePaths(rows));
    return rows.map((r) => {
      const p = mapProduct(r, urls);
      // Hidden variants never reach the storefront.
      return { ...p, variants: p.variants.filter((v) => v.status === 'active') };
    });
  }

  async function publishedStoreId(storeId: string): Promise<string> {
    const row = await ctx.q<Row | null>(sb.from('stores').select('id').eq('id', storeId).eq('status', 'published').maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', UNAVAILABLE);
    return row.id as string;
  }

  const storefront: StorefrontService = {
    async searchStores(q) {
      const term = q.trim();
      if (term.length < 2) return [];
      return await searchRows(term, 20);
    },

    featuredStores: () => searchRows('', 12),

    async resolveStore(subdomain) {
      let r: Row;
      try {
        r = await ctx.rpc<Row>('resolve_store', { p_subdomain: subdomain });
      } catch (e) {
        if (e instanceof ServiceError && (e.code === 'NOT_FOUND' || e.code === 'VALIDATION')) throw new ServiceError('NOT_FOUND', UNAVAILABLE);
        throw e;
      }
      const urls = await ctx.signedUrls('store-logos', [r.logo_url, r.banner_url]);
      const contact = (r.contact ?? {}) as Row;
      return mapStorefrontStore(
        r,
        { logo: urls.get(r.logo_url) ?? null, banner: urls.get(r.banner_url) ?? null },
        { phone: contact.phone ?? null, email: contact.email ?? null },
      ) satisfies StorefrontStore;
    },

    async listCategories(storeId) {
      const id = await publishedStoreId(storeId);
      const [cats, products] = await Promise.all([
        ctx.q<Row[]>(sb.from('categories').select('*').eq('store_id', id).order('display_order').order('name')),
        visibleProducts(id),
      ]);
      return cats
        .map((c) => ({ ...mapCategory(c), productCount: products.filter((p) => p.categoryId === c.id).length }))
        .filter((c) => c.productCount > 0);
    },

    async listProducts(storeId, filters = {}) {
      const id = await publishedStoreId(storeId);
      const sort = filters.sort ?? 'popular';
      const [all, popularity] = await Promise.all([
        visibleProducts(id),
        sort === 'popular' ? ctx.rpc<Row[]>('storefront_product_popularity', { p_store_id: id }).catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
      ]);
      const sales = new Map(popularity.map((p) => [String(p.product_id), Number(p.units)]));
      const q = filters.search?.trim().toLowerCase();
      const list = all
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        .filter((p) => !filters.categoryId || filters.categoryId === 'all' || p.categoryId === filters.categoryId)
        .filter((p) => filters.minPrice === undefined || productPriceRange(p)[1] >= filters.minPrice)
        .filter((p) => filters.maxPrice === undefined || productPriceRange(p)[0] <= filters.maxPrice)
        .filter((p) => !filters.inStockOnly || productTotalStock(p) > 0);
      list.sort((a, b) => {
        if (sort === 'price_asc') return productPriceRange(a)[0] - productPriceRange(b)[0];
        if (sort === 'price_desc') return productPriceRange(b)[0] - productPriceRange(a)[0];
        if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
        return (sales.get(b.id) ?? 0) - (sales.get(a.id) ?? 0) || b.createdAt.localeCompare(a.createdAt);
      });
      return list;
    },

    async getProduct(storeId, productSlugOrId) {
      const id = await publishedStoreId(storeId);
      const list = await visibleProducts(id);
      const key = productSlugOrId.toLowerCase();
      // Slugs come from names; when two products share a name the oldest owns the slug (same rule as the mock).
      const p = list.find((x) => x.id === productSlugOrId) ?? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).find((x) => productSlug(x) === key);
      if (!p) throw new ServiceError('NOT_FOUND', 'This product is no longer available in this store.');
      let categoryName: string | null = null;
      if (p.categoryId) {
        const c = await ctx.q<Row | null>(sb.from('categories').select('name').eq('id', p.categoryId).maybeSingle());
        categoryName = c?.name ?? null;
      }
      const related = list.filter((x) => x.id !== p.id && x.categoryId === p.categoryId).slice(0, 4);
      return { product: p, categoryName, related };
    },

    async validateCart(storeId, items, district) {
      const r = await ctx.rpc<Row>('validate_cart', {
        p_store_id: storeId,
        p_items: items.map((i) => ({ product_id: i.productId, variant_id: i.variantId, quantity: i.quantity, unit_price: i.unitPrice })),
        p_district: district ?? null,
      });
      const lines: CartLineCheck[] = ((r.lines ?? []) as Row[]).map((l) => ({
        productId: l.product_id,
        variantId: l.variant_id || null,
        available: !!l.available,
        availableStock: Number(l.available_stock ?? 0),
        currentUnitPrice: Number(l.current_unit_price ?? 0),
        priceChanged: !!l.price_changed,
        quantityCapped: !!l.quantity_capped,
        quantity: Number(l.quantity ?? 0),
      }));
      const subtotal = Number(r.subtotal ?? 0);
      // Like the mock: no delivery charge on an empty (or fully unavailable) cart.
      const deliveryCharge = subtotal > 0 ? Number(r.delivery_charge ?? 0) : 0;
      return { lines, subtotal, deliveryCharge, total: subtotal + deliveryCharge, hasChanges: !!r.has_changes };
    },

    async getPublishedPolicy(type) {
      const row = await ctx.q<Row | null>(
        sb.from('policies').select('*').eq('type', type).eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle(),
      );
      return row ? (mapPolicy(row, new Map()) satisfies Policy) : null;
    },

    async trackOrder(orderNumber, phone) {
      const r = await ctx.invoke<Row>('track-order', { orderNumber, phone });
      return {
        orderNumber: r.order_number,
        storeName: r.store_name ?? '',
        storeSubdomain: r.store_subdomain ?? '',
        status: r.status ?? 'delivered',
        paymentStatus: r.payment_status ?? 'paid',
        paymentMethod: r.payment_method ?? 'cod',
        items: ((r.items ?? []) as Row[]).map((i) => ({
          productName: i.product_name,
          variantLabel: i.variant_label ?? null,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          subtotal: Number(i.subtotal),
        })),
        subtotal: Number(r.subtotal ?? 0),
        deliveryCharge: Number(r.delivery_charge ?? 0),
        totalAmount: Number(r.total_amount ?? 0),
        deliveryAddress: mapDeliveryAddress(r.delivery_address, phone),
        cancellationReason: r.cancellation_reason ?? null,
        events: ((r.events ?? []) as Row[]).map((e) => ({ eventType: e.event_type, createdAt: e.created_at })),
        merchantContact: { phone: r.merchant_contact?.phone ?? null, email: r.merchant_contact?.email ?? null },
        createdAt: r.created_at ?? new Date(0).toISOString(),
        archived: !!r.archived,
      } satisfies TrackingResult;
    },
  };

  const checkout: CheckoutService = {
    async placeOrder(input) {
      const r = await ctx.invoke<Row>('create-order', {
        storeId: input.storeId,
        items: input.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, expectedUnitPrice: i.expectedUnitPrice })),
        delivery: {
          recipientName: input.delivery.recipientName,
          phone: input.delivery.phone,
          email: input.delivery.email || null,
          address: input.delivery.address,
          district: input.delivery.district,
          postalCode: input.delivery.postalCode || null,
        },
        paymentMethod: input.paymentMethod,
        saveAddress: input.saveAddress,
        idempotencyKey: input.idempotencyKey,
      });
      ctx.emit();
      return {
        order: mapOrder(r.order, r.items),
        payment: r.payment ? mapPayment(r.payment) : null,
        nextAction: r.next_action ?? 'none',
      };
    },

    async submitWalletReference(orderId, { phone, reference, idempotencyKey }) {
      const r = await ctx.invoke<{ paymentStatus: string; payment: PaymentTransactionSummary | null }>('create-payment-attempt', {
        kind: 'wallet_reference',
        orderId,
        reference,
        phone,
        idempotencyKey,
      });
      if (!r.payment) throw new ServiceError('CONFLICT', 'This order no longer accepts a payment.');
      ctx.emit();
      return { paymentStatus: r.paymentStatus as PaymentTransactionSummary['status'], payment: r.payment };
    },

    async startSslcommerz(orderId, { phone }) {
      return await ctx.invoke<{ redirectUrl: string; sessionToken: string }>('create-payment-attempt', {
        kind: 'sslcommerz',
        orderId,
        phone,
        idempotencyKey: idempotencyKeyFor(`ssl:${orderId}`),
      });
    },

    async completeSslcommerzSandbox(sessionToken, outcome) {
      // Development simulator only: the function refuses this unless PAYMENT_PROVIDER_MODE=simulator.
      const r = await ctx.invoke<Row>('payment-webhook?kind=simulator', { sessionToken, outcome });
      ctx.emit();
      return { orderNumber: r.orderNumber, subdomain: r.subdomain, phone: r.phone, paymentStatus: r.paymentStatus };
    },
  };

  return { storefront, checkout };
}
