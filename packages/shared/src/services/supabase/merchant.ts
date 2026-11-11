/**
 * Merchant services on Supabase: store, catalogue, inventory, orders,
 * customers, payment settings, analytics, support and returns.
 *
 * Reads: PostgREST under RLS (own store only — enforced by owns_store()).
 * Catalogue writes: SECURITY DEFINER RPCs that use auth.uid().
 * Stock / order / payment / refund writes: Edge Functions only.
 */
import { PAYMENT_METHODS } from '../../constants';
import { inventoryRowsForProduct, productStockState } from '../../domain';
import { slugify } from '../../formatters';
import type {
  Category,
  DeliveryEvent,
  InventoryMovement,
  InventoryRow,
  Order,
  OrderDetail,
  OrderStatus,
  PaymentConfig,
  Product,
  ReturnRequest,
  Store,
  StoreCustomer,
  SubdomainCheck,
  SupportTicket,
  SupportTicketDetail,
  TicketMessage,
} from '../../types';
import type { ProductInput } from '../../validation';
import { ServiceError, type MerchantReturnService, type MerchantServices, type ReturnDetail, type UploadFile } from '../contracts';
import type { AuthModule } from './auth';
import { idempotencyKeyFor, objectName, toServiceError, type AdapterContext } from './core';
import {
  mapCategory,
  mapDeliveryEvent,
  mapOrder,
  mapPayment,
  mapPaymentConfig,
  mapProduct,
  mapRefund,
  mapReturn,
  mapStore,
  mapTheme,
  mapTicket,
  ORDER_COLUMNS,
  PAYMENT_COLUMNS,
  PRODUCT_COLUMNS,
  productImagePaths,
  REFUND_COLUMNS,
  RETURN_COLUMNS,
  STORE_COLUMNS,
  TICKET_COLUMNS,
} from './mappers';
import { createAnalytics } from './analytics';
import { toCsv } from '../analytics';
import { validateImageFile } from '../../validation/files';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are mapped field by field */
type Row = Record<string, any>;

const ONBOARDING_LABELS: Record<string, string> = {
  subdomain: 'Choose your store address',
  logo: 'Upload a store logo',
  payment_method: 'Enable a payment method',
  first_product: 'Add your first product',
};

/** New images picked in the product form are held here until the product is saved. */
const PENDING_PREFIX = 'pending:';

export function createMerchant(ctx: AdapterContext, auth: AuthModule) {
  const { sb } = ctx;
  const pendingFiles = new Map<string, UploadFile>();

  async function me() {
    const s = await auth.requireSession();
    if (s.user.role !== 'merchant') throw new ServiceError('FORBIDDEN', 'This area is only available to merchant accounts.');
    if (s.user.status === 'suspended') throw new ServiceError('SUSPENDED', `Your merchant account is suspended. ${s.user.suspensionReason ?? ''}`.trim());
    return s;
  }

  async function myStore(): Promise<Store> {
    const s = await me();
    if (!s.store) throw new ServiceError('NOT_FOUND', 'Create your store first to use this feature.');
    return s.store;
  }

  async function storeRow(): Promise<Store> {
    const s = await me();
    const row = await ctx.q<Row | null>(sb.from('stores').select(STORE_COLUMNS).eq('owner_id', s.user.id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'Create your store first to use this feature.');
    const urls = await ctx.signedUrls('store-logos', [row.logo_url, row.banner_url]);
    auth.invalidate();
    return mapStore(row, { logo: urls.get(row.logo_url) ?? null, banner: urls.get(row.banner_url) ?? null });
  }

  /* ------------------------------ Products ------------------------------ */

  async function productsFor(storeId: string, ids?: string[]): Promise<Product[]> {
    let query = sb.from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId).is('deleted_at', null);
    if (ids) query = query.in('id', ids);
    const rows = await ctx.q<Row[]>(query.order('updated_at', { ascending: false }).limit(2000));
    const urls = await ctx.signedUrls('product-images', productImagePaths(rows));
    return rows.map((r) => mapProduct(r, urls));
  }

  async function productById(id: string): Promise<Product> {
    const store = await myStore();
    const [p] = await productsFor(store.id, [id]);
    if (!p) throw new ServiceError('NOT_FOUND', 'Product not found.');
    return p;
  }

  function productPayload(input: ProductInput, includeStock: boolean) {
    return {
      name: input.name,
      description: input.description,
      category_id: input.categoryId || null,
      base_price: input.basePrice,
      compare_at_price: input.compareAtPrice ?? null,
      product_type: input.productType,
      ...(includeStock && input.productType === 'simple' ? { stock_quantity: input.stockQuantity ?? 0 } : {}),
      low_stock_threshold: input.lowStockThreshold,
      status: input.status,
      sku: input.sku || null,
      variants:
        input.productType === 'variant'
          ? input.variants.map((v) => ({
              ...(v.id && !v.id.startsWith('new') ? { id: v.id } : {}),
              variant_label: v.variantLabel,
              price_adjustment: v.priceAdjustment,
              stock_quantity: v.stockQuantity,
              status: v.status,
            }))
          : [],
    };
  }

  /** Uploads pending images and makes product_images match the form (one primary, form order). */
  async function syncImages(storeId: string, productId: string, images: ProductInput['images']): Promise<void> {
    const existing = await ctx.q<Row[]>(sb.from('product_images').select('id, storage_path, is_primary, display_order').eq('product_id', productId));
    const wanted: { path: string; isPrimary: boolean; id?: string }[] = [];
    for (const img of images) {
      if (img.storagePath.startsWith(PENDING_PREFIX)) {
        const file = pendingFiles.get(img.storagePath);
        if (!file) continue;
        const path = `stores/${storeId}/products/${productId}/${objectName(file)}`;
        await ctx.upload('product-images', path, file);
        pendingFiles.delete(img.storagePath);
        wanted.push({ path, isPrimary: img.isPrimary });
      } else {
        const row = existing.find((e) => e.id === img.id || e.storage_path === img.storagePath);
        if (row) wanted.push({ path: row.storage_path, isPrimary: img.isPrimary, id: row.id });
      }
    }
    const keep = new Set(wanted.filter((w) => w.id).map((w) => w.id));
    const removed = existing.filter((e) => !keep.has(e.id));
    if (removed.length) {
      await ctx.q(sb.from('product_images').delete().in('id', removed.map((r) => r.id)));
      await sb.storage.from('product-images').remove(removed.map((r) => r.storage_path));
    }
    // Clear primaries first so at most one is ever set.
    if (wanted.some((w) => w.id)) {
      await ctx.q(sb.from('product_images').update({ is_primary: false }).eq('product_id', productId));
    }
    if (wanted.length && !wanted.some((w) => w.isPrimary)) wanted[0]!.isPrimary = true;
    for (const [i, w] of wanted.entries()) {
      if (w.id) {
        await ctx.q(sb.from('product_images').update({ is_primary: w.isPrimary, display_order: i }).eq('id', w.id));
      } else {
        await ctx.q(sb.from('product_images').insert({ product_id: productId, storage_path: w.path, is_primary: w.isPrimary, display_order: i }));
      }
    }
  }

  /* ------------------------------- Orders ------------------------------- */

  async function orderDetail(id: string, scope: 'merchant' | 'any' = 'merchant'): Promise<OrderDetail> {
    let query = sb.from('orders').select(ORDER_COLUMNS).eq('id', id);
    if (scope === 'merchant') query = query.eq('store_id', (await myStore()).id);
    const row = await ctx.q<Row | null>(query.maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'Order not found.');
    const [events, payments, ret] = await Promise.all([
      ctx.q<Row[]>(sb.from('delivery_events').select('*').eq('order_id', id).order('created_at')),
      ctx.q<Row[]>(sb.from('payment_transactions').select(PAYMENT_COLUMNS).eq('order_id', id).order('created_at', { ascending: false })),
      ctx.q<Row | null>(sb.from('returns').select('id, return_number, status, reason, created_at').eq('order_id', id).maybeSingle()),
    ]);
    const s = await auth.buildSession();
    return {
      order: mapOrder(row),
      events: events.map((e): DeliveryEvent => mapDeliveryEvent(e, e.actor_id && s && e.actor_id === s.user.id ? s.user.fullName : null)),
      payments: payments.map(mapPayment),
      returnRequest: ret ? { id: ret.id, returnNumber: ret.return_number, status: ret.status, reason: ret.reason, createdAt: ret.created_at } : null,
    };
  }

  async function ordersOf(storeId: string, filters: import('../../types').OrderListFilters = {}): Promise<{ items: Order[]; total: number }> {
    let query = sb.from('orders').select(ORDER_COLUMNS, { count: 'exact' }).eq('store_id', storeId);
    if (!filters.includeTest) query = query.eq('is_test', false);
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.paymentStatus && filters.paymentStatus !== 'all') query = query.eq('payment_status', filters.paymentStatus);
    if (filters.paymentMethod && filters.paymentMethod !== 'all') query = query.eq('payment_method', filters.paymentMethod);
    if (filters.from) query = query.gte('created_at', `${filters.from.slice(0, 10)}T00:00:00+06:00`);
    if (filters.to) query = query.lte('created_at', `${filters.to.slice(0, 10)}T23:59:59.999+06:00`);
    const q = filters.search?.trim().replace(/[%,()]/g, '');
    if (q) query = query.or(`order_number.ilike.%${q}%,order_phone.ilike.%${q}%,delivery_address->>recipient_name.ilike.%${q}%`);
    const { data, count, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw toServiceError(error);
    return { items: ((data ?? []) as Row[]).map((r) => mapOrder(r)), total: count ?? 0 };
  }

  /* ------------------------------ Returns ------------------------------- */

  async function returnDetail(id: string): Promise<ReturnDetail> {
    const row = await ctx.q<Row | null>(sb.from('returns').select(RETURN_COLUMNS).eq('id', id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'Return not found.');
    const [evidence, orderRow, refundRow] = await Promise.all([
      ctx.signedUrl('return-evidence', row.evidence_storage_path),
      ctx.q<Row>(sb.from('orders').select(ORDER_COLUMNS).eq('id', row.order_id).single()),
      ctx.q<Row | null>(sb.from('refunds').select(REFUND_COLUMNS).eq('return_id', id).maybeSingle()),
    ]);
    return { returnRequest: mapReturn(row, evidence), order: mapOrder(orderRow), refund: refundRow ? await refundWithEvents(refundRow) : null };
  }

  async function refundWithEvents(r: Row) {
    const events = await ctx.rpc<Row[]>('refund_timeline', { p_refund_id: r.id }).catch(() => [] as Row[]);
    const mapped = events.map((e) => ({ status: e.status, actorName: e.actor_name ?? null, note: e.note ?? null, createdAt: e.created_at }));
    return mapRefund(r, mapped, mapped[0]?.actorName ?? null);
  }

  /* ------------------------------ Support ------------------------------- */

  async function ticketDetail(id: string): Promise<SupportTicketDetail> {
    const row = await ctx.q<Row | null>(sb.from('support_tickets').select(TICKET_COLUMNS).eq('id', id).maybeSingle());
    if (!row) throw new ServiceError('NOT_FOUND', 'Ticket not found.');
    const [thread, names] = await Promise.all([
      ctx.rpc<{ messages: Row[]; audit: Row[] }>('get_ticket_thread', { p_ticket_id: id }),
      ctx.rpc<{ ticket_id: string; customer_name: string }[]>('ticket_customer_names', { p_ticket_ids: [id] }),
    ]);
    const messages: TicketMessage[] = (thread.messages ?? []).map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      senderId: m.sender_id,
      senderName: m.sender_name ?? 'User',
      senderRole: m.sender_role ?? 'customer',
      body: m.body,
      attachmentName: m.attachment_storage_path ? String(m.attachment_storage_path).split('/').pop()!.replace(/^[a-z0-9]{8}-/, '') : null,
      attachmentStoragePath: m.attachment_storage_path ?? null,
      createdAt: m.created_at,
    }));
    return {
      ticket: mapTicket(row, names[0]?.customer_name ?? 'Customer'),
      messages,
      audit: (thread.audit ?? []).map((a) => ({
        id: a.id,
        ticketId: id,
        actorName: a.actor_name ?? null,
        eventType: a.event_type,
        previousValue: a.previous_value ?? null,
        newValue: a.new_value ?? null,
        createdAt: a.created_at,
      })),
    };
  }

  async function ticketsWithNames(rows: Row[]): Promise<SupportTicket[]> {
    if (!rows.length) return [];
    const names = await ctx.rpc<{ ticket_id: string; customer_name: string }[]>('ticket_customer_names', { p_ticket_ids: rows.map((r) => r.id) });
    const byId = new Map(names.map((n) => [n.ticket_id, n.customer_name]));
    return rows.map((r) => mapTicket(r, byId.get(r.id) ?? 'Customer'));
  }

  async function replyWithAttachment(id: string, body: string, attachment?: UploadFile | null): Promise<void> {
    let path: string | null = null;
    if (attachment) {
      path = `tickets/${id}/${objectName(attachment)}`;
      await ctx.upload('support-attachments', path, attachment, 'attachment');
    }
    await ctx.rpc('reply_to_ticket', { p_ticket_id: id, p_body: body, p_attachment_path: path });
  }

  const analytics = createAnalytics(ctx, myStore);

  const returns: MerchantReturnService = {
    async list(filters = {}) {
      const store = await myStore();
      let query = sb.from('returns').select(RETURN_COLUMNS).eq('order.store_id', store.id);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(500));
      const q = filters.search?.trim().toLowerCase();
      return rows
        .map((r) => mapReturn(r))
        .filter((r: ReturnRequest) => !q || r.returnNumber.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q));
    },
    get: (id) => returnDetail(id),
    async decide(id, { decision, reason }) {
      await ctx.invoke('manage-return', { action: 'decide', returnId: id, decision, reason: reason || undefined });
      return await returnDetail(id);
    },
    async setReturnMethod(id, method) {
      await ctx.invoke('manage-return', { action: 'set_method', returnId: id, method });
      return await returnDetail(id);
    },
    async confirmReceipt(id, { restock, note, idempotencyKey }) {
      await ctx.invoke('manage-return', { action: 'confirm_receipt', returnId: id, restock, note, idempotencyKey });
      return await returnDetail(id);
    },
    async createRefund(id, { amount, method, idempotencyKey }) {
      await ctx.invoke('process-refund', { action: 'create', returnId: id, amount, method, idempotencyKey });
      return await returnDetail(id);
    },
    async markRefundProcessing(refundId, note) {
      const r = await ctx.invoke<{ return: Row }>('process-refund', { action: 'mark_processing', refundId, note });
      return await returnDetail(r.return.id);
    },
    async recordRefundSettlement(refundId, { reference, note, idempotencyKey }) {
      const r = await ctx.invoke<{ return: Row }>('process-refund', { action: 'settle', refundId, reference, note, idempotencyKey });
      return await returnDetail(r.return.id);
    },
    async markRefundFailed(refundId, note) {
      const r = await ctx.invoke<{ return: Row }>('process-refund', { action: 'mark_failed', refundId, note });
      return await returnDetail(r.return.id);
    },
  };

  const services: MerchantServices = {
    auth: auth.auth,
    returns,

    store: {
      async getMyStore() {
        const s = await me();
        return s.store;
      },
      async checkSubdomain(subdomain) {
        const r = await ctx.rpc<Row>('check_subdomain', { p_subdomain: subdomain });
        return {
          subdomain: r.subdomain,
          available: !!r.available,
          reason: r.reason,
          message: r.message,
          suggestions: r.suggestions ?? [],
        } satisfies SubdomainCheck;
      },
      async createStore(input) {
        await me();
        await ctx.rpc('create_store', { p_name: input.name, p_subdomain: input.subdomain, p_category: input.category, p_tagline: input.tagline || null });
        return await storeRow();
      },
      async updateStore(patch) {
        const store = await myStore();
        const row: Row = {};
        if (patch.name !== undefined) row.name = patch.name.trim();
        if (patch.tagline !== undefined) row.tagline = patch.tagline?.trim() || null;
        if (patch.brandColour !== undefined) row.brand_colour = patch.brandColour;
        if (patch.themeId !== undefined) row.theme_id = patch.themeId;
        if (patch.returnWindowDays !== undefined) row.return_window_days = patch.returnWindowDays;
        await ctx.q(sb.from('stores').update(row).eq('id', store.id));
        return await storeRow();
      },
      async updateExtensions(patch) {
        const store = await myStore();
        const row: Row = {};
        if (patch.category !== undefined) row.category = patch.category;
        if (patch.bannerUrl === null) row.banner_url = null;
        if (patch.shipping) {
          row.shipping_settings = {
            inside_dhaka_charge: patch.shipping.insideDhakaCharge,
            outside_dhaka_charge: patch.shipping.outsideDhakaCharge,
            estimated_days_inside_dhaka: patch.shipping.estimatedDaysInsideDhaka,
            estimated_days_outside_dhaka: patch.shipping.estimatedDaysOutsideDhaka,
          };
        }
        if (patch.notificationPreferences) {
          row.notification_preferences = {
            new_order_email: patch.notificationPreferences.newOrderEmail,
            new_order_sms: patch.notificationPreferences.newOrderSms,
            low_stock_email: patch.notificationPreferences.lowStockEmail,
            support_ticket_email: patch.notificationPreferences.supportTicketEmail,
          };
        }
        await ctx.q(sb.from('stores').update(row).eq('id', store.id));
        return await storeRow();
      },
      async uploadLogo(file) {
        const store = await myStore();
        const path = `stores/${store.id}/logos/${objectName(file)}`;
        await ctx.upload('store-logos', path, file);
        const old = await ctx.q<Row>(sb.from('stores').select('logo_url').eq('id', store.id).single());
        await ctx.q(sb.from('stores').update({ logo_url: path }).eq('id', store.id));
        if (old.logo_url) await sb.storage.from('store-logos').remove([old.logo_url]);
        return await storeRow();
      },
      async removeLogo() {
        const store = await myStore();
        const old = await ctx.q<Row>(sb.from('stores').select('logo_url').eq('id', store.id).single());
        await ctx.q(sb.from('stores').update({ logo_url: null }).eq('id', store.id));
        if (old.logo_url) await sb.storage.from('store-logos').remove([old.logo_url]);
        return await storeRow();
      },
      async uploadBanner(file) {
        const store = await myStore();
        const path = `stores/${store.id}/banners/${objectName(file)}`;
        await ctx.upload('store-logos', path, file);
        await ctx.q(sb.from('stores').update({ banner_url: path }).eq('id', store.id));
        return await storeRow();
      },
      async listThemes() {
        const rows = await ctx.q<Row[]>(sb.from('themes').select('*').eq('is_active', true).order('name'));
        return rows.map(mapTheme);
      },
      async getOnboarding() {
        await me();
        const r = await ctx.rpc<{ steps: { key: string; done: boolean }[]; percent: number; publishable: boolean }>('get_onboarding_progress');
        return {
          steps: r.steps.map((s) => ({ key: s.key as 'subdomain', label: ONBOARDING_LABELS[s.key] ?? s.key, done: s.done })),
          percent: r.percent,
          publishable: r.publishable,
        };
      },
      async publish() {
        await ctx.rpc('publish_store');
        return await storeRow();
      },
      async unpublish() {
        await ctx.rpc('unpublish_store');
        return await storeRow();
      },
    },

    products: {
      async list(filters = {}) {
        const store = await myStore();
        const q = filters.search?.trim().toLowerCase();
        return (await productsFor(store.id))
          .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.extensions.sku ?? '').toLowerCase().includes(q))
          .filter((p) => !filters.status || filters.status === 'all' || p.status === filters.status)
          .filter((p) => !filters.categoryId || filters.categoryId === 'all' || p.categoryId === filters.categoryId)
          .filter((p) => !filters.productType || filters.productType === 'all' || p.productType === filters.productType)
          .filter((p) => !filters.stock || filters.stock === 'all' || productStockState(p) === filters.stock);
      },
      get: (id) => productById(id),
      async create(input) {
        const store = await myStore();
        const id = await ctx.rpc<string>('create_product', { p_input: productPayload(input, true) });
        await syncImages(store.id, id, input.images);
        return await productById(id);
      },
      async update(id, input) {
        const store = await myStore();
        await ctx.rpc('update_product', { p_product_id: id, p_input: productPayload(input, false) });
        await syncImages(store.id, id, input.images);
        return await productById(id);
      },
      async setStatus(id, status) {
        await ctx.rpc('set_product_status', { p_product_id: id, p_status: status });
        return await productById(id);
      },
      async remove(id) {
        await ctx.rpc('delete_product', { p_product_id: id });
      },
      async duplicate(id, options = {}) {
        const store = await myStore();
        const source = await productById(id);
        const newId = await ctx.rpc<string>('duplicate_product', {
          p_product_id: id,
          p_options: { name: options.name ?? null, include_pricing: options.includePricing !== false, copy_sku: options.copySku !== false },
        });
        if (options.includeImages !== false) {
          for (const [i, img] of source.images.entries()) {
            const to = `stores/${store.id}/products/${newId}/${img.storagePath.split('/').pop()}`;
            const { error } = await sb.storage.from('product-images').copy(img.storagePath, to);
            if (!error) await ctx.q(sb.from('product_images').insert({ product_id: newId, storage_path: to, is_primary: img.isPrimary, display_order: i }));
          }
        }
        return await productById(newId);
      },
      async uploadImage(file) {
        const err = validateImageFile(file);
        if (err) throw new ServiceError('VALIDATION', err);
        const token = `${PENDING_PREFIX}${idempotencyKeyFor('img')}`;
        pendingFiles.set(token, file);
        // Uploaded to stores/{store}/products/{product}/… when the product is saved (Storage RLS needs the product row).
        return { storagePath: token, url: file.previewUrl };
      },
      async listCategories() {
        const store = await myStore();
        const rows = await ctx.q<Row[]>(sb.from('categories').select('*').eq('store_id', store.id).order('display_order').order('name'));
        return rows.map(mapCategory);
      },
      async createCategory(name) {
        const store = await myStore();
        const clean = name.trim();
        if (clean.length < 2 || clean.length > 60) throw new ServiceError('VALIDATION', 'Category name must be 2–60 characters.', { name: 'Use 2–60 characters.' });
        const { data, error } = await sb.from('categories').insert({ store_id: store.id, name: clean, slug: slugify(clean) || `category-${Date.now()}` }).select('*').single();
        if (error) {
          if ((error as { code?: string }).code === '23505') throw new ServiceError('CONFLICT', 'A category with this name already exists.', { name: 'Already exists.' });
          throw toServiceError(error);
        }
        return mapCategory(data as Row) satisfies Category;
      },
    },

    inventory: {
      async list(filters = {}) {
        const store = await myStore();
        const [products, cats] = await Promise.all([productsFor(store.id), services.products.listCategories()]);
        const catName = new Map(cats.map((c) => [c.id, c.name]));
        const q = filters.search?.trim().toLowerCase();
        return products
          .flatMap((p) => inventoryRowsForProduct(p, p.categoryId ? (catName.get(p.categoryId) ?? null) : null))
          .filter((r: InventoryRow) => !q || r.productName.toLowerCase().includes(q) || (r.variantLabel ?? '').toLowerCase().includes(q))
          .filter((r) => !filters.categoryId || filters.categoryId === 'all' || r.categoryId === filters.categoryId)
          .filter((r) => !filters.state || filters.state === 'all' || r.state === filters.state);
      },
      async adjust({ productId, variantId, delta, note, idempotencyKey }) {
        await ctx.invoke('adjust-inventory', { productId, variantId, delta, note, idempotencyKey });
        const p = await productById(productId);
        const rows = inventoryRowsForProduct(p, null);
        const row = rows.find((r) => r.variantId === variantId) ?? rows[0];
        if (!row) throw new ServiceError('NOT_FOUND', 'Product not found.');
        return row;
      },
      async movements(filters = {}) {
        const store = await myStore();
        const s = await me();
        let query = sb
          .from('inventory_movements')
          .select('id, store_id, product_id, variant_id, quantity_delta, reason, actor_id, reference_type, reference_id, note, created_at, product:products(name), variant:product_variants(variant_label)')
          .eq('store_id', store.id);
        if (filters.productId) query = query.eq('product_id', filters.productId);
        if (filters.variantId) query = query.eq('variant_id', filters.variantId);
        const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(filters.limit ?? 200));
        return rows.map(
          (m): InventoryMovement => ({
            id: m.id,
            storeId: m.store_id,
            productId: m.product_id,
            variantId: m.variant_id ?? null,
            productName: m.product?.name ?? '',
            variantLabel: m.variant?.variant_label ?? null,
            quantityDelta: Number(m.quantity_delta),
            reason: m.reason,
            actorId: m.actor_id ?? null,
            actorName: m.actor_id === s.user.id ? s.user.fullName : m.actor_id ? 'Customer' : 'System',
            referenceType: m.reference_type ?? null,
            referenceId: m.reference_id ?? null,
            note: m.note ?? null,
            createdAt: m.created_at,
          }),
        );
      },
    },

    orders: {
      async list(filters = {}) {
        const store = await myStore();
        return await ordersOf(store.id, filters);
      },
      async countsByStatus() {
        const store = await myStore();
        const rows = await ctx.q<{ status: OrderStatus }[]>(sb.from('orders').select('status').eq('store_id', store.id).eq('is_test', false).limit(100000));
        const counts = { all: rows.length, pending: 0, confirmed: 0, processing: 0, shipped: 0, out_for_delivery: 0, delivered: 0, cancelled: 0 } as Record<OrderStatus | 'all', number>;
        for (const r of rows) counts[r.status] += 1;
        return counts;
      },
      get: (id) => orderDetail(id),
      async markAsTest(id, reason) {
        const cleanReason = reason.normalize('NFC').trim();
        if (cleanReason.length < 5 || cleanReason.length > 300) throw new ServiceError('VALIDATION', 'Add a reason between 5 and 300 characters.');
        await ctx.rpc('mark_order_as_test', { p_order_id: id, p_reason: cleanReason });
        return await orderDetail(id);
      },
      async updateStatus(id, to, { note, idempotencyKey }) {
        await ctx.invoke('update-order-status', { orderId: id, toStatus: to, note: note || undefined, idempotencyKey });
        return await orderDetail(id);
      },
      async cancel(id, { reason, idempotencyKey }) {
        await ctx.invoke('update-order-status', { orderId: id, toStatus: 'cancelled', reason, idempotencyKey });
        return await orderDetail(id);
      },
      async recordCodCollection(id, { amount, note, idempotencyKey }) {
        await ctx.invoke('record-cod-collection', { orderId: id, amount, note: note || undefined, idempotencyKey });
        return await orderDetail(id);
      },
      async reviewPayment(id, { decision, reason, idempotencyKey }) {
        await ctx.invoke('verify-payment', { mode: 'manual_review', orderId: id, decision, reason, idempotencyKey });
        return await orderDetail(id);
      },
      async deliveryHistoryCsv(range) {
        const store = await myStore();
        const rows = await ctx.q<Row[]>(
          sb
            .from('delivery_events')
            .select('event_type, notes, cod_amount, created_at, order:orders!inner(order_number, store_id, delivery_address, order_phone, is_test)')
            .eq('order.store_id', store.id)
            .eq('order.is_test', false)
            .gte('created_at', `${range.from.slice(0, 10)}T00:00:00+06:00`)
            .lte('created_at', `${range.to.slice(0, 10)}T23:59:59.999+06:00`)
            .order('created_at'),
        );
        const csv = toCsv([
          ['Order', 'Event', 'Recipient', 'District', 'COD amount', 'Note', 'Recorded at'],
          ...rows.map((r) => [
            r.order?.order_number ?? '',
            r.event_type,
            r.order?.delivery_address?.recipient_name ?? '',
            r.order?.delivery_address?.district ?? '',
            r.cod_amount ?? '',
            r.notes ?? '',
            r.created_at,
          ]),
        ]);
        return { filename: `${store.subdomain}-delivery-history-${range.from.slice(0, 10)}_to_${range.to.slice(0, 10)}.csv`, csv };
      },
    },

    customers: {
      async list(filters = {}) {
        await myStore();
        const rows = await ctx.rpc<Row[]>('merchant_customers');
        const q = filters.search?.trim().toLowerCase();
        const now = Date.now();
        return rows
          .map(
            (c): StoreCustomer => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              email: c.email ?? null,
              accountType: c.account_type,
              activity:
                Number(c.orders_count) <= 1 && now - Date.parse(c.first_order_at) < 30 * 86_400_000
                  ? 'new'
                  : now - Date.parse(c.last_order_at) <= 90 * 86_400_000
                    ? 'active'
                    : 'inactive',
              ordersCount: Number(c.orders_count),
              totalSpent: Number(c.total_spent),
              firstOrderAt: c.first_order_at,
              lastOrderAt: c.last_order_at,
              district: c.district ?? null,
            }),
          )
          .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email ?? '').toLowerCase().includes(q))
          .filter((c) => !filters.accountType || filters.accountType === 'all' || c.accountType === filters.accountType);
      },
      async get(id) {
        const store = await myStore();
        const customer = (await services.customers.list()).find((c) => c.id === id);
        if (!customer) throw new ServiceError('NOT_FOUND', 'Customer not found.');
        let query = sb.from('orders').select(ORDER_COLUMNS).eq('store_id', store.id);
        query = id.startsWith('guest:') ? query.is('customer_id', null).eq('order_phone', id.slice(6)) : query.eq('customer_id', id);
        const rows = await ctx.q<Row[]>(query.order('created_at', { ascending: false }).limit(200));
        return { customer, orders: rows.map((r) => mapOrder(r)) };
      },
    },

    payments: {
      async list() {
        const store = await myStore();
        const rows = await ctx.rpc<Row[] | Record<string, Row>>('get_payment_configs');
        const list = Array.isArray(rows) ? rows : Object.values(rows);
        const byMethod = new Map(list.map((r) => [r.method, r]));
        return PAYMENT_METHODS.map((m) => mapPaymentConfig({ store_id: store.id, method: m, ...(byMethod.get(m) ?? {}) }));
      },
      async setEnabled(method, enabled) {
        const store = await myStore();
        const r = await ctx.rpc<Row>('set_payment_method_enabled', { p_method: method, p_enabled: enabled });
        return mapPaymentConfig({ store_id: store.id, ...r }) satisfies PaymentConfig;
      },
      async saveCredentials(credentials) {
        const store = await myStore();
        const r = await ctx.invoke<Row>('payment-credentials', { method: credentials.method, values: credentials.values });
        return mapPaymentConfig({ store_id: store.id, ...r });
      },
    },

    analytics,

    support: {
      async list(filters = {}) {
        const store = await myStore();
        let query = sb.from('support_tickets').select(TICKET_COLUMNS).eq('store_id', store.id).eq('queue', 'store');
        if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
        const rows = await ctx.q<Row[]>(query.order('updated_at', { ascending: false }).limit(500));
        const tickets = await ticketsWithNames(rows);
        const q = filters.search?.trim().toLowerCase();
        return tickets.filter((t) => !q || t.subject.toLowerCase().includes(q) || t.ticketNumber.toLowerCase().includes(q) || t.customerName.toLowerCase().includes(q));
      },
      get: (id) => ticketDetail(id),
      async reply(id, { body, attachment }) {
        await replyWithAttachment(id, body, attachment);
        return await ticketDetail(id);
      },
      async updateStatus(id, to, input = {}) {
        await ctx.rpc('update_ticket_status', { p_ticket_id: id, p_to_status: to, p_resolution_note: input.resolutionNote ?? null });
        return await ticketDetail(id);
      },
    },

    notifications: undefined as unknown as MerchantServices['notifications'],
  };

  return { services, orderDetail, returnDetail, refundWithEvents, ticketDetail, ticketsWithNames, replyWithAttachment, productsFor, ordersOf };
}

export type MerchantModule = ReturnType<typeof createMerchant>;
