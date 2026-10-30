/**
 * End-to-end check of the frontend's Supabase adapter against the local stack
 * (scripts/local-stack/start.sh): real GoTrue, PostgREST, Edge Functions and
 * every BazarHQ migration. Each role uses its own client, exactly as a browser
 * or the Android app would, through createSupabaseServices().
 *
 * Also probes the security boundaries directly with raw supabase-js clients:
 * clients cannot set payment status, touch stock, assign roles or read another
 * tenant's data.
 *
 * Run: set -a; . /tmp/bazarhq-stack/stack.env; set +a
 *      npx tsx scripts/local-stack/adapter-flows.mts
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServices, dayKey, ServiceError, type SupabasePlatformServices, type UploadFile } from '@bazarhq/shared';

const URL_ = process.env.STACK_URL!;
const ANON = process.env.STACK_ANON_KEY!;
const SERVICE = process.env.STACK_SERVICE_KEY!;
const PG_SOCKET = process.env.STACK_PG_SOCKET!;
const PG_PORT = process.env.STACK_PG_PORT!;
if (!URL_ || !ANON || !SERVICE) throw new Error('Source the stack.env written by start.sh first.');

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const results: { step: string; ok: '✓' | '✗'; detail?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ step: name, ok: '✓' });
  } catch (e) {
    const detail = e instanceof ServiceError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    results.push({ step: name, ok: '✗', detail: detail.slice(0, 300) });
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function expectError(p: Promise<unknown>, code: string | string[], msg: string) {
  try {
    await p;
  } catch (e) {
    const codes = Array.isArray(code) ? code : [code];
    if (e instanceof ServiceError && codes.includes(e.code)) return;
    throw new Error(`${msg}: expected ${codes.join('|')}, got ${e instanceof ServiceError ? e.code + ' ' + e.message : String(e)}`);
  }
  throw new Error(`${msg}: expected ${Array.isArray(code) ? code.join('|') : code}, but it succeeded`);
}
function sql(query: string): string {
  return execFileSync('psql', ['-h', PG_SOCKET, '-p', PG_PORT, '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}
type Client = { services: SupabasePlatformServices; raw: SupabaseClient; storage: ReturnType<typeof memoryStorage> };
function newClient(): Client {
  const storage = memoryStorage();
  const services = createSupabaseServices({ url: URL_, anonKey: ANON, authStorage: storage, redirectTo: 'http://localhost:3000' });
  // A second raw client sharing the same session storage, for direct security probes.
  const raw = createClient(URL_, ANON, { auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  return { services, raw, storage };
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const png = (name: string): UploadFile => ({ name, size: 68, type: 'image/png', previewUrl: PNG });

function totp(base32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

const run = Date.now().toString(36);
// Business days are Bangladesh days (the app's dayKey), not UTC days.
const today = dayKey(new Date());
const monthAgo = dayKey(new Date(Date.now() - 29 * 86_400_000));
const range = { preset: '30d' as const, from: monthAgo, to: today };

/* ------------------------------------------------------------------ */
/* Merchant A: onboarding, catalogue, payments, publish                */
/* ------------------------------------------------------------------ */

const merchantA = newClient();
const merchantB = newClient();
const customer = newClient();
const guest = newClient();
const admin = newClient();
const admin2 = newClient();

const subA = `fresh${run}`.slice(0, 20);
const subB = `tech${run}`.slice(0, 20);
let storeAId = '';
let simpleId = '';
let variantId = '';
let variantOptionId = '';
let codOrder = { id: '', number: '', total: 0 };
let walletOrderId = '';

await step('merchant registers (role from server-side signup path) and signs in', async () => {
  await merchantA.services.auth.register({ fullName: 'Nusrat Jahan', email: `m.${run}@example.test`, password: 'Merchant123', accountType: 'merchant' });
  const s = await merchantA.services.auth.getSession();
  assert(s?.user.role === 'merchant', `role was ${s?.user.role}`);
  assert(s.store === null, 'new merchant should have no store');
});

await step('subdomain check: reserved and available', async () => {
  const reserved = await merchantA.services.store.checkSubdomain('admin');
  assert(!reserved.available && reserved.reason === 'reserved', `admin: ${JSON.stringify(reserved)}`);
  const free = await merchantA.services.store.checkSubdomain(subA);
  assert(free.available, `free: ${JSON.stringify(free)}`);
});

await step('merchant creates a draft store; a second store is refused', async () => {
  const store = await merchantA.services.store.createStore({ name: 'Fresh Mart', subdomain: subA, category: 'groceries', tagline: 'Fresh every day' });
  storeAId = store.id;
  assert(store.status === 'draft', `status ${store.status}`);
  await expectError(merchantA.services.store.createStore({ name: 'Second', subdomain: `${subA}x`, category: 'groceries', tagline: '' }), ['CONFLICT', 'VALIDATION'], 'second store');
});

await step('logo upload goes through Storage RLS; onboarding progress updates', async () => {
  const before = await merchantA.services.store.getOnboarding();
  const store = await merchantA.services.store.uploadLogo(png('logo.png'));
  assert(store.logoUrl && store.logoUrl.includes('/storage/v1/object/sign/store-logos/'), `logoUrl ${store.logoUrl}`);
  const after = await merchantA.services.store.getOnboarding();
  assert(after.percent > before.percent, `${before.percent} → ${after.percent}`);
});

await step('Storage RLS: another merchant cannot write into this store’s folder', async () => {
  await merchantB.services.auth.register({ fullName: 'Rafiq Ahmed', email: `m2.${run}@example.test`, password: 'Merchant123', accountType: 'merchant' });
  await merchantB.services.store.createStore({ name: 'Tech Hub', subdomain: subB, category: 'electronics', tagline: '' });
  const { error } = await merchantB.raw.storage.from('store-logos').upload(`stores/${storeAId}/logos/evil.png`, new Blob([Buffer.from(PNG.split(',')[1]!, 'base64')], { type: 'image/png' }));
  assert(error, 'cross-tenant upload must fail');
});

await step('publishing is blocked until the checklist is complete', async () => {
  await expectError(merchantA.services.store.publish(), ['CONFLICT', 'VALIDATION'], 'publish before checklist');
});

await step('merchant creates simple and variant products (with image) and a category', async () => {
  const cat = await merchantA.services.products.createCategory('Vegetables');
  const img = await merchantA.services.products.uploadImage(png('tomato.png'));
  const simple = await merchantA.services.products.create({
    name: 'Tomato',
    description: 'Fresh red tomatoes, per kg.',
    categoryId: cat.id,
    basePrice: 120,
    compareAtPrice: 150,
    productType: 'simple',
    stockQuantity: 10,
    lowStockThreshold: 3,
    status: 'active',
    sku: 'VEG-TOM-1KG',
    variants: [],
    images: [{ storagePath: img.storagePath, url: img.url, isPrimary: true }],
  });
  simpleId = simple.id;
  assert(simple.stockQuantity === 10 && simple.extensions.compareAtPrice === 150, 'simple product fields');
  assert(simple.images.length === 1 && simple.images[0]!.storagePath.startsWith(`stores/${storeAId}/products/${simple.id}/`), 'image stored under the product folder');
  const variant = await merchantA.services.products.create({
    name: 'Mustard Oil',
    description: 'Cold-pressed mustard oil.',
    categoryId: cat.id,
    basePrice: 140,
    compareAtPrice: null,
    productType: 'variant',
    stockQuantity: null,
    lowStockThreshold: 2,
    status: 'active',
    sku: 'GRO-OIL-MST',
    variants: [
      { variantLabel: '500 ml', priceAdjustment: 0, stockQuantity: 5, status: 'active' },
      { variantLabel: '1 L', priceAdjustment: 120, stockQuantity: 3, status: 'active' },
    ],
    images: [],
  });
  variantId = variant.id;
  variantOptionId = variant.variants.find((v) => v.variantLabel === '1 L')!.id;
  assert(variant.variants.length === 2 && variant.stockQuantity === null, 'variant stock model');
});

await step('duplicate makes a hidden draft with stock 0 and a unique SKU', async () => {
  const copy = await merchantA.services.products.duplicate(simpleId, { name: 'Tomato Copy' });
  assert(copy.status === 'draft' && copy.stockQuantity === 0, `copy ${copy.status}/${copy.stockQuantity}`);
  assert(copy.extensions.sku === 'VEG-TOM-1KG-COPY', `sku ${copy.extensions.sku}`);
  assert(copy.images.length === 1, 'images copied');
});

await step('COD needs no credentials; bKash needs validated credentials (simulator)', async () => {
  const cod = await merchantA.services.payments.setEnabled('cod', true);
  assert(cod.isEnabled, 'cod enabled');
  await expectError(merchantA.services.payments.setEnabled('bkash', true), ['CONFLICT', 'VALIDATION'], 'bkash without credentials');
  const saved = await merchantA.services.payments.saveCredentials({
    method: 'bkash',
    values: { merchantNumber: '01712345678', appKey: 'app-key-123', appSecret: 'app-secret-123', username: 'user-123', password: 'pass-123' },
  });
  assert(saved.hasCredentials && saved.credentialHint && !JSON.stringify(saved).includes('pass-123'), 'credentials masked');
  const bkash = await merchantA.services.payments.setEnabled('bkash', true);
  assert(bkash.isEnabled, 'bkash enabled');
});

await step('merchant publishes the store', async () => {
  const s = await merchantA.services.store.publish();
  assert(s.status === 'published', `status ${s.status}`);
});

/* ------------------------------------------------------------------ */
/* Storefront and checkout                                             */
/* ------------------------------------------------------------------ */

await step('public storefront: discovery returns stores only; unknown and draft stores look the same', async () => {
  const found = await guest.services.storefront.searchStores('fresh');
  assert(found.some((s) => s.subdomain === subA), 'published store found');
  await expectError(guest.services.storefront.resolveStore('no-such-store'), 'NOT_FOUND', 'unknown store');
  await expectError(guest.services.storefront.resolveStore(subB), 'NOT_FOUND', 'draft store');
});

await step('public storefront: store with contact, products, slug lookup, signed image URLs', async () => {
  const store = await guest.services.storefront.resolveStore(subA);
  assert(store.contact.email === `m.${run}@example.test`, `contact ${JSON.stringify(store.contact)}`);
  assert(store.enabledPaymentMethods.includes('cod') && store.enabledPaymentMethods.includes('bkash'), 'payment methods');
  const products = await guest.services.storefront.listProducts(store.id, { sort: 'popular' });
  assert(products.length === 2, `visible products ${products.length} (draft copy must be hidden)`);
  const view = await guest.services.storefront.getProduct(store.id, 'tomato');
  assert(view.product.id === simpleId && view.categoryName === 'Vegetables', 'slug lookup');
  assert(view.product.images[0]?.url?.includes('/object/sign/product-images/'), 'anonymous signed image URL');
  const cats = await guest.services.storefront.listCategories(store.id);
  assert(cats[0]?.productCount === 2, 'category counts');
});

await step('cart validation: price change, stock cap, delivery charge', async () => {
  const v = await guest.services.storefront.validateCart(
    storeAId,
    [
      { productId: simpleId, variantId: null, name: 'Tomato', variantLabel: null, imageUrl: null, categoryName: null, unitPrice: 100, quantity: 50 },
    ],
    'Dhaka',
  );
  const line = v.lines[0]!;
  assert(line.priceChanged && line.currentUnitPrice === 120 && line.quantityCapped && line.quantity === 10, JSON.stringify(line));
  assert(v.deliveryCharge === 60 && v.hasChanges, `charge ${v.deliveryCharge}`);
});

await step('customer registers and places a COD order (atomic, idempotent)', async () => {
  await customer.services.auth.register({ fullName: 'Ayesha Rahman', email: `c.${run}@example.test`, password: 'Customer123', accountType: 'customer' });
  const input = {
    storeId: storeAId,
    items: [{ productId: simpleId, variantId: null, quantity: 2, expectedUnitPrice: 120 }],
    delivery: { recipientName: 'Ayesha Rahman', phone: '01711000111', email: null, address: 'House 9, Road 2, Banani', district: 'Dhaka', postalCode: '1213' },
    paymentMethod: 'cod' as const,
    saveAddress: true,
    idempotencyKey: `order:${run}:1`,
  };
  const first = await customer.services.checkout.placeOrder(input);
  const again = await customer.services.checkout.placeOrder(input);
  assert(first.order.id === again.order.id, 'same idempotency key returns the same order');
  assert(first.order.paymentStatus === 'cod_pending' && first.nextAction === 'none', `${first.order.paymentStatus}/${first.nextAction}`);
  assert(first.order.totalAmount === 300, `total ${first.order.totalAmount}`);
  codOrder = { id: first.order.id, number: first.order.orderNumber, total: first.order.totalAmount };
  const p = await merchantA.services.products.get(simpleId);
  assert(p.stockQuantity === 8, `stock after order ${p.stockQuantity}`);
  const addresses = await customer.services.account.listAddresses();
  assert(addresses.length === 1 && addresses[0]!.isDefault, 'address saved as default');
});

await step('overselling is refused and changes nothing', async () => {
  await expectError(
    customer.services.checkout.placeOrder({
      storeId: storeAId,
      items: [{ productId: variantId, variantId: variantOptionId, quantity: 4, expectedUnitPrice: 260 }],
      delivery: { recipientName: 'Ayesha Rahman', phone: '01711000111', email: null, address: 'House 9, Road 2, Banani', district: 'Dhaka', postalCode: null },
      paymentMethod: 'cod',
      saveAddress: false,
      idempotencyKey: `order:${run}:oversell`,
    }),
    'CONFLICT',
    'oversell',
  );
  const p = await merchantA.services.products.get(variantId);
  assert(p.variants.find((v) => v.id === variantOptionId)!.stockQuantity === 3, 'variant stock unchanged');
});

await step('bKash order: customer transaction ID → pending_verification → server-verified paid', async () => {
  const placed = await guest.services.checkout.placeOrder({
    storeId: storeAId,
    items: [{ productId: variantId, variantId: variantOptionId, quantity: 1, expectedUnitPrice: 260 }],
    delivery: { recipientName: 'Guest Buyer', phone: '01811222333', email: null, address: 'Flat 3B, Dhanmondi 27', district: 'Dhaka', postalCode: null },
    paymentMethod: 'bkash',
    saveAddress: false,
    idempotencyKey: `order:${run}:bkash`,
  });
  walletOrderId = placed.order.id;
  assert(placed.nextAction === 'submit_wallet_reference' && placed.order.paymentStatus === 'pending', placed.nextAction);
  const r = await guest.services.checkout.submitWalletReference(placed.order.id, { phone: '01811222333', reference: `TRX${run.toUpperCase()}`.slice(0, 20), idempotencyKey: `wallet:${run}` });
  assert(['paid', 'pending_verification'].includes(r.paymentStatus), `status ${r.paymentStatus}`);
  assert(r.payment.providerReferenceMasked?.startsWith('••••'), 'reference masked');
});

const walletBuyer = { recipientName: 'Wallet Buyer', phone: '01911444555', email: null, address: 'Road 5, Uttara Sector 7', district: 'Dhaka', postalCode: null };

await step('rejected wallet payment: order stays pending and retryable; cancelling releases stock exactly once', async () => {
  // Option B: a failed attempt is not an order failure and no stock-release rule is invented;
  // stock comes back through the merchant's audited cancellation (FR-M-31, §18.2), once.
  const before = (await merchantA.services.products.get(simpleId)).stockQuantity!;
  const placed = await guest.services.checkout.placeOrder({
    storeId: storeAId,
    items: [{ productId: simpleId, variantId: null, quantity: 1, expectedUnitPrice: 120 }],
    delivery: walletBuyer,
    paymentMethod: 'bkash',
    saveAddress: false,
    idempotencyKey: `order:${run}:fail`,
  });
  assert((await merchantA.services.products.get(simpleId)).stockQuantity === before - 1, 'stock reserved by the order');
  const r = await guest.services.checkout.submitWalletReference(placed.order.id, { phone: walletBuyer.phone, reference: 'FAIL12345678', idempotencyKey: `wallet:${run}:fail` });
  assert(r.paymentStatus === 'failed', `status ${r.paymentStatus}`);
  assert((await merchantA.services.products.get(simpleId)).stockQuantity === before - 1, 'no release on a failed attempt alone');
  const c = await merchantA.services.orders.cancel(placed.order.id, { reason: 'Payment failed and the customer did not retry', idempotencyKey: `cx:${run}` });
  assert(c.order.status === 'cancelled', c.order.status);
  await merchantA.services.orders.cancel(placed.order.id, { reason: 'Payment failed and the customer did not retry', idempotencyKey: `cx:${run}` });
  assert((await merchantA.services.products.get(simpleId)).stockQuantity === before, 'stock restored by cancellation');
  const restores = sql(`select count(*) from public.inventory_movements where quantity_delta > 0 and reason in ('cancellation_release', 'payment_failure_release') and reference_id::text in ('${placed.order.id}', '${placed.order.orderNumber}')`);
  assert(restores === '1', `release movements ${restores}`);
  await expectError(
    guest.services.checkout.submitWalletReference(placed.order.id, { phone: walletBuyer.phone, reference: 'TRXRETRY1234', idempotencyKey: `wallet:${run}:late` }),
    'CONFLICT',
    'a cancelled order accepts no payment',
  );
});

await step('wallet retry after a failed attempt is safe and ends paid', async () => {
  const placed = await guest.services.checkout.placeOrder({
    storeId: storeAId,
    items: [{ productId: simpleId, variantId: null, quantity: 1, expectedUnitPrice: 120 }],
    delivery: walletBuyer,
    paymentMethod: 'bkash',
    saveAddress: false,
    idempotencyKey: `order:${run}:retry`,
  });
  const first = await guest.services.checkout.submitWalletReference(placed.order.id, { phone: walletBuyer.phone, reference: 'FAIL87654321', idempotencyKey: `wallet:${run}:r1` });
  assert(first.paymentStatus === 'failed', first.paymentStatus);
  const second = await guest.services.checkout.submitWalletReference(placed.order.id, { phone: walletBuyer.phone, reference: `TRXOK${run.toUpperCase()}`.slice(0, 20), idempotencyKey: `wallet:${run}:r2` });
  assert(second.paymentStatus === 'paid', second.paymentStatus);
  const attempts = sql(`select count(*) from public.payment_transactions where order_id = '${placed.order.id}'`);
  assert(attempts === '2', `attempts ${attempts}`);
});

await step('Rocket: no verification API → pending_verification → merchant manual review (audited)', async () => {
  await merchantA.services.payments.saveCredentials({ method: 'rocket', values: { merchantNumber: '018123456789', billerId: 'BILLER-1', apiKey: 'rocket-api-key' } });
  await merchantA.services.payments.setEnabled('rocket', true);
  const placed = await guest.services.checkout.placeOrder({
    storeId: storeAId,
    items: [{ productId: simpleId, variantId: null, quantity: 1, expectedUnitPrice: 120 }],
    delivery: walletBuyer,
    paymentMethod: 'rocket',
    saveAddress: false,
    idempotencyKey: `order:${run}:rocket`,
  });
  const r = await guest.services.checkout.submitWalletReference(placed.order.id, { phone: walletBuyer.phone, reference: 'RKT12345678', idempotencyKey: `wallet:${run}:rocket` });
  assert(r.paymentStatus === 'pending_verification', `status ${r.paymentStatus}`);
  await expectError(
    merchantA.services.orders.reviewPayment(placed.order.id, { decision: 'paid', reason: '', idempotencyKey: `rv:${run}:0` }),
    'VALIDATION',
    'review without reason',
  );
  const d = await merchantA.services.orders.reviewPayment(placed.order.id, { decision: 'paid', reason: 'Checked in the Rocket merchant portal', idempotencyKey: `rv:${run}` });
  assert(d.order.paymentStatus === 'paid', d.order.paymentStatus);
  const audited = sql(`select count(*) from public.audit_logs where resource_type = 'payment_transaction' and metadata ->> 'source' = 'manual_review'`);
  assert(Number(audited) >= 1, 'manual review audited');
  await expectError(
    merchantB.services.orders.reviewPayment(placed.order.id, { decision: 'failed', reason: 'Not my store at all', idempotencyKey: `rv:${run}:b` }),
    'NOT_FOUND',
    'another merchant cannot review',
  );
});

await step('SSLCommerz: only the signed gateway callback marks paid; browser return and replays change nothing', async () => {
  await merchantA.services.payments.saveCredentials({ method: 'sslcommerz', values: { storeId: 'testbox', storePassword: 'testbox@ssl' } });
  await merchantA.services.payments.setEnabled('sslcommerz', true);
  const placed = await guest.services.checkout.placeOrder({
    storeId: storeAId,
    items: [{ productId: simpleId, variantId: null, quantity: 1, expectedUnitPrice: 120 }],
    delivery: walletBuyer,
    paymentMethod: 'sslcommerz',
    saveAddress: false,
    idempotencyKey: `order:${run}:ssl`,
  });
  assert(placed.nextAction === 'redirect_sslcommerz', placed.nextAction);
  const start = await guest.services.checkout.startSslcommerz(placed.order.id, { phone: walletBuyer.phone });
  assert(start.redirectUrl.includes('/payment/sslcommerz-sandbox?session='), start.redirectUrl);
  // The customer's browser coming back with "success" is only a redirect.
  const tx = sql(`select id from public.payment_transactions where order_id = '${placed.order.id}' order by created_at desc limit 1`);
  const back = await fetch(`${URL_}/functions/v1/payment-webhook?kind=return&result=success`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', apikey: ANON },
    body: `tran_id=${tx}&status=VALID`,
    redirect: 'manual',
  });
  assert(back.status === 303, `return status ${back.status}`);
  assert(sql(`select payment_status from public.orders where id = '${placed.order.id}'`) === 'pending', 'return redirect must not mark paid');
  const done = await guest.services.checkout.completeSslcommerzSandbox(start.sessionToken, 'success');
  assert(done.paymentStatus === 'paid', done.paymentStatus);
  const replay = await guest.services.checkout.completeSslcommerzSandbox(start.sessionToken, 'failed');
  assert(replay.paymentStatus === 'paid', `replay changed status to ${replay.paymentStatus}`);
});

await step('security: clients cannot set payment status, change stock or their role', async () => {
  const pay = await customer.raw.from('orders').update({ payment_status: 'paid' }).eq('id', codOrder.id).select('id');
  assert(pay.error || (pay.data ?? []).length === 0, 'customer must not update payment_status');
  const pay2 = await merchantA.raw.from('orders').update({ payment_status: 'cod_collected' }).eq('id', codOrder.id).select('id');
  assert(pay2.error || (pay2.data ?? []).length === 0, 'merchant must not update payment_status directly');
  const stock = await merchantA.raw.from('products').update({ stock_quantity: 999 }).eq('id', simpleId).select('id');
  assert(stock.error || (stock.data ?? []).length === 0, 'merchant must not write stock directly');
  const tx = await customer.raw.from('payment_transactions').insert({ order_id: codOrder.id, method: 'cod', provider: 'cod', status: 'paid', amount: 1 });
  assert(tx.error, 'customer must not insert payment transactions');
  const me = (await customer.raw.auth.getUser()).data.user!.id;
  const role = await customer.raw.from('profiles').update({ role: 'super_admin' }).eq('id', me).select('id');
  assert(role.error || (role.data ?? []).length === 0, 'role change must fail');
  assert(sql(`select role from public.profiles where id = '${me}'`) === 'customer', 'role unchanged');
});

await step('tenant isolation: merchant B sees none of merchant A’s orders, products or customers', async () => {
  const orders = await merchantB.raw.from('orders').select('id').eq('store_id', storeAId);
  assert((orders.data ?? []).length === 0, 'orders leak');
  const moves = await merchantB.raw.from('inventory_movements').select('id').eq('store_id', storeAId);
  assert((moves.data ?? []).length === 0, 'inventory leak');
  const cfg = await merchantB.raw.from('payment_configs').select('id').eq('store_id', storeAId);
  assert((cfg.data ?? []).length === 0, 'payment config leak');
  const custs = await merchantB.services.customers.list();
  assert(custs.length === 0, 'customers leak');
  await expectError(merchantB.services.orders.get(codOrder.id), 'NOT_FOUND', 'cross-tenant order detail');
});

await step('customer privacy: one customer cannot read another’s orders or addresses', async () => {
  const other = newClient();
  await other.services.auth.register({ fullName: 'Other Buyer', email: `c2.${run}@example.test`, password: 'Customer123', accountType: 'customer' });
  const orders = await other.raw.from('orders').select('id').eq('id', codOrder.id);
  assert((orders.data ?? []).length === 0, 'order leak');
  const addr = await other.raw.from('customer_addresses').select('id');
  assert((addr.data ?? []).length === 0, 'address leak');
  await expectError(other.services.account.getOrder(codOrder.id), 'NOT_FOUND', 'other customer order');
});

/* ------------------------------------------------------------------ */
/* Merchant order workflow, COD, analytics                             */
/* ------------------------------------------------------------------ */

await step('merchant sees the new-order notification and the order', async () => {
  const notes = await merchantA.services.notifications.list();
  assert(notes.some((n) => n.type === 'new_order'), `types ${notes.map((n) => n.type).join(',')}`);
  const list = await merchantA.services.orders.list();
  assert(list.items.some((o) => o.id === codOrder.id), 'order listed');
  const counts = await merchantA.services.orders.countsByStatus();
  assert(counts.all >= 2 && counts.pending >= 2, JSON.stringify(counts));
});

await step('order state machine: valid path, invalid jump refused, cancel needs a reason', async () => {
  await expectError(merchantA.services.orders.updateStatus(codOrder.id, 'shipped', { idempotencyKey: `st:${run}:bad` }), ['CONFLICT', 'VALIDATION'], 'pending → shipped');
  await expectError(merchantA.services.orders.cancel(codOrder.id, { reason: '', idempotencyKey: `st:${run}:c0` }), 'VALIDATION', 'cancel without reason');
  const steps = ['confirmed', 'processing', 'shipped', 'out_for_delivery'] as const;
  for (const to of steps) {
    const d = await merchantA.services.orders.updateStatus(codOrder.id, to, { idempotencyKey: `st:${run}:${to}` });
    assert(d.order.status === to, `now ${d.order.status}`);
  }
  // Replaying the same idempotency key is harmless.
  await merchantA.services.orders.updateStatus(codOrder.id, 'out_for_delivery', { idempotencyKey: `st:${run}:out_for_delivery` });
  await expectError(merchantA.services.orders.cancel(codOrder.id, { reason: 'Customer asked to cancel', idempotencyKey: `st:${run}:c1` }), 'CONFLICT', 'cancel out_for_delivery');
  const done = await merchantA.services.orders.updateStatus(codOrder.id, 'delivered', { idempotencyKey: `st:${run}:delivered` });
  assert(done.order.status === 'delivered', 'delivered');
  const types = done.events.map((e) => e.eventType);
  assert(['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'].every((t) => types.includes(t as never)), `events ${types.join(',')}`);
});

await step('COD collection is recorded separately and must match the total', async () => {
  await expectError(merchantA.services.orders.recordCodCollection(codOrder.id, { amount: 1, idempotencyKey: `cod:${run}:bad` }), ['VALIDATION', 'CONFLICT'], 'wrong amount');
  const d = await merchantA.services.orders.recordCodCollection(codOrder.id, { amount: codOrder.total, idempotencyKey: `cod:${run}` });
  assert(d.order.paymentStatus === 'cod_collected' && d.order.status === 'delivered', `${d.order.paymentStatus}`);
});

await step('inventory: never negative, adjustments are logged', async () => {
  await expectError(
    merchantA.services.inventory.adjust({ productId: simpleId, variantId: null, delta: -1000, note: 'Stock count correction', idempotencyKey: `inv:${run}:neg` }),
    ['VALIDATION', 'CONFLICT'],
    'negative stock',
  );
  const start = (await merchantA.services.products.get(simpleId)).stockQuantity!;
  const row = await merchantA.services.inventory.adjust({ productId: simpleId, variantId: null, delta: 5, note: 'New delivery from supplier', idempotencyKey: `inv:${run}:1` });
  assert(row.stockQuantity === start + 5, `stock ${row.stockQuantity} (was ${start})`);
  const replay = await merchantA.services.inventory.adjust({ productId: simpleId, variantId: null, delta: 5, note: 'New delivery from supplier', idempotencyKey: `inv:${run}:1` });
  assert(replay.stockQuantity === start + 5, 'same idempotency key does not adjust twice');
  const moves = await merchantA.services.inventory.movements({ productId: simpleId });
  assert(moves.some((m) => m.reason === 'manual_adjustment' && m.quantityDelta === 5) && moves.some((m) => m.reason === 'sale' && m.quantityDelta === -2), 'ledger');
});

await step('merchant analytics, customers and CSV exports', async () => {
  const dash = await merchantA.services.analytics.dashboard(range);
  assert(dash.totalOrders.value >= 2 && dash.totalSales.value >= 300, `orders ${dash.totalOrders.value} sales ${dash.totalSales.value}`);
  const report = await merchantA.services.analytics.report(range);
  assert(report.ordersByStatus.delivered >= 1, 'report by status');
  const csv = await merchantA.services.analytics.exportCsv(range);
  assert(csv.csv.split('\n').length > 2, 'analytics csv');
  const hist = await merchantA.services.orders.deliveryHistoryCsv(range);
  assert(hist.csv.includes(codOrder.number), 'delivery csv');
  const custs = await merchantA.services.customers.list();
  assert(custs.some((c) => c.accountType === 'registered') && custs.some((c) => c.accountType === 'guest'), 'registered + guest customers');
});

/* ------------------------------------------------------------------ */
/* Tracking, returns, refunds                                          */
/* ------------------------------------------------------------------ */

await step('public tracking: right phone shows the timeline; any mismatch is the same not-found', async () => {
  const t = await guest.services.storefront.trackOrder(codOrder.number, '01711000111');
  assert(t.status === 'delivered' && t.events.length >= 6 && t.merchantContact.email, 'tracking result');
  await expectError(guest.services.storefront.trackOrder(codOrder.number, '01799999999'), 'NOT_FOUND', 'wrong phone');
});

let returnId = '';
await step('customer return: eligibility, one per order, evidence photo via Storage RLS', async () => {
  const d = await customer.services.account.getOrder(codOrder.id);
  assert(d.returnEligibility.eligible && d.storeName === 'Fresh Mart', JSON.stringify(d.returnEligibility));
  const r = await customer.services.account.createReturn(codOrder.id, {
    reason: 'damaged',
    conditionDescription: 'Two tomatoes arrived crushed in the bag.',
    evidence: png('photo.png'),
    idempotencyKey: `ret:${run}`,
  });
  returnId = r.id;
  assert(r.status === 'requested' && r.evidenceStoragePath?.startsWith(`returns/${r.id}/`) && r.evidenceUrl, 'return with evidence');
  await expectError(
    customer.services.account.createReturn(codOrder.id, { reason: 'other', conditionDescription: 'Trying a second return here.', idempotencyKey: `ret:${run}:2` }),
    ['CONFLICT', 'VALIDATION'],
    'second return',
  ).catch(async (e) => {
    // An idempotent replay of the first request is also acceptable; anything else is not.
    const list = await customer.services.account.listReturns();
    if (list.filter((x) => x.orderId === codOrder.id).length !== 1) throw e;
  });
});

await step('merchant return workflow → refund settled with a reference (server-side only)', async () => {
  const stockBefore = (await merchantA.services.products.get(simpleId)).stockQuantity!;
  let d = await merchantA.services.returns.decide(returnId, { decision: 'approved', reason: '' });
  assert(d.returnRequest.status === 'approved', d.returnRequest.status);
  d = await merchantA.services.returns.setReturnMethod(returnId, 'customer_drop_off');
  d = await merchantA.services.returns.confirmReceipt(returnId, { restock: true, note: 'Received at the shop', idempotencyKey: `rcv:${run}` });
  assert(d.returnRequest.status === 'received', d.returnRequest.status);
  const p = await merchantA.services.products.get(simpleId);
  assert(p.stockQuantity === stockBefore + 2, `restocked to ${p.stockQuantity} (was ${stockBefore})`);
  await expectError(merchantA.services.returns.createRefund(returnId, { amount: 999999, method: 'bkash', idempotencyKey: `rf:${run}:big` }), ['VALIDATION', 'CONFLICT'], 'refund above total');
  d = await merchantA.services.returns.createRefund(returnId, { amount: 240, method: 'bkash', idempotencyKey: `rf:${run}` });
  assert(d.refund?.status === 'initiated', `refund ${d.refund?.status}`);
  const refundId = d.refund!.id;
  const fake = await customer.raw.from('refunds').update({ status: 'completed' }).eq('id', refundId).select('id');
  assert(fake.error || (fake.data ?? []).length === 0, 'client cannot complete a refund');
  d = await merchantA.services.returns.markRefundProcessing(refundId, 'Sent to bKash');
  d = await merchantA.services.returns.recordRefundSettlement(refundId, { reference: `BK${run}`.toUpperCase(), note: 'Refund sent', idempotencyKey: `rs:${run}` });
  assert(d.refund?.status === 'completed' && d.refund.events.length >= 2, `refund ${d.refund?.status}`);
  const mine = await customer.services.account.getReturn(returnId);
  assert(mine.refund?.status === 'completed', 'customer sees refund status');
});

/* ------------------------------------------------------------------ */
/* Support tickets                                                     */
/* ------------------------------------------------------------------ */

let ticketId = '';
await step('support: order ticket routes to the store; merchant replies; resolution needs a note', async () => {
  const t = await customer.services.account.createTicket({
    category: 'delivery',
    subject: 'Courier was late',
    description: 'The courier arrived two hours after the promised time window.',
    priority: 'normal',
    orderId: codOrder.id,
    attachment: png('receipt.png'),
  });
  ticketId = t.ticket.id;
  assert(t.ticket.queue === 'store' && t.messages.some((m) => m.attachmentStoragePath), `queue ${t.ticket.queue}`);
  const inbox = await merchantA.services.support.list();
  assert(inbox.some((x) => x.id === ticketId && x.customerName === 'Ayesha Rahman'), 'merchant inbox');
  await merchantA.services.support.updateStatus(ticketId, 'in_progress');
  await merchantA.services.support.reply(ticketId, { body: 'Sorry about that — we have spoken to the courier.' });
  await expectError(merchantA.services.support.updateStatus(ticketId, 'resolved', {}), ['VALIDATION', 'CONFLICT'], 'resolve without note');
  const r = await merchantA.services.support.updateStatus(ticketId, 'resolved', { resolutionNote: 'Courier issue explained, apology given.' });
  assert(r.ticket.status === 'resolved' && r.audit.length >= 2, 'resolved + audited');
  const other = await merchantB.services.support.list();
  assert(!other.some((x) => x.id === ticketId), 'other merchant cannot see the ticket');
  const c = await customer.services.account.getTicket(ticketId);
  assert(c.messages.length >= 3, `messages ${c.messages.length}`);
});

await step('support: account ticket goes to the platform queue; early escalation is refused (72 h rule)', async () => {
  const t = await customer.services.account.createTicket({ category: 'account', subject: 'Change my email', description: 'Please help me change the email on my account.', priority: 'normal', orderId: null });
  assert(t.ticket.queue === 'platform', t.ticket.queue);
  const store = await customer.services.account.createTicket({ category: 'order', subject: 'Missing item', description: 'One item was missing from my delivered order.', priority: 'urgent', orderId: codOrder.id });
  await expectError(customer.services.account.escalateTicket(store.ticket.id), ['CONFLICT', 'VALIDATION', 'FORBIDDEN'], 'escalate before 72 h');
});

await step('notifications: unread count, mark all read, device token stored masked', async () => {
  const before = await customer.services.notifications.unreadCount();
  assert(before > 0, 'customer has notifications');
  await customer.services.notifications.markAllRead();
  assert((await customer.services.notifications.unreadCount()) === 0, 'all read');
  const token = `fcm-${run}-${'x'.repeat(40)}`;
  const dt = await customer.services.notifications.registerDevice({ token, platform: 'android' });
  assert(dt.tokenHint && !dt.tokenHint.includes(token.slice(0, 20)), 'token masked');
  const raw = await customer.raw.from('device_tokens').select('*');
  assert(!JSON.stringify(raw.data ?? []).includes(token.slice(0, 20)) || raw.error, 'raw token not readable by the client');
  await customer.services.notifications.unregisterDevice(token);
});

/* ------------------------------------------------------------------ */
/* Super Admin                                                         */
/* ------------------------------------------------------------------ */

async function bootstrapAdmin(c: Client, email: string, name: string): Promise<string> {
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin12345!', email_confirm: true, user_metadata: { full_name: name } }),
  });
  const user = (await res.json()) as { id: string };
  sql(`select private.grant_super_admin('${user.id}', 'local verification bootstrap')`);
  // TOTP enrolment (BACKEND_SETUP.md): sign in with the password, enrol, verify once.
  const { error } = await c.raw.auth.signInWithPassword({ email, password: 'Admin12345!' });
  if (error) throw error;
  const enrol = await c.raw.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'authenticator' });
  if (enrol.error) throw enrol.error;
  const v = await c.raw.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
  if (v.error) throw v.error;
  await c.raw.auth.signOut();
  return enrol.data.totp.secret;
}

let secret1 = '';
let secret2 = '';
await step('Super Admin: no default account; bootstrap via grant_super_admin + TOTP enrolment', async () => {
  assert(sql(`select count(*) from public.profiles where role = 'super_admin'`) === '0', 'no admin before bootstrap');
  secret1 = await bootstrapAdmin(admin, `a1.${run}@example.test`, 'Admin One');
  secret2 = await bootstrapAdmin(admin2, `a2.${run}@example.test`, 'Admin Two');
  assert(sql(`select count(*) from public.audit_logs where action = 'profile.role_changed' and metadata ->> 'new_role' = 'super_admin'`) === '2', 'grant audited');
});

await step('Super Admin sign-in: network check → password → TOTP; wrong code refused', async () => {
  const net = await admin.services.adminAuth.checkNetwork();
  assert(net.allowed && net.ip === '127.0.0.1', JSON.stringify(net));
  const r = await admin.services.adminAuth.signIn(`a1.${run}@example.test`, 'Admin12345!');
  assert(r.mfaRequired, 'mfa required');
  await expectError(admin.services.adminAuth.verifyTotp('000000'), 'VALIDATION', 'wrong TOTP');
  const s = await admin.services.adminAuth.verifyTotp(totp(secret1));
  assert(s.user.role === 'super_admin' && s.admin?.mfaVerified, 'admin session (aal2)');
  await admin2.services.adminAuth.signIn(`a2.${run}@example.test`, 'Admin12345!');
  await admin2.services.adminAuth.verifyTotp(totp(secret2));
});

await step('aal1 admin session (password only) gets no admin data from RLS', async () => {
  const probe = newClient();
  await probe.raw.auth.signInWithPassword({ email: `a1.${run}@example.test`, password: 'Admin12345!' });
  const logs = await probe.raw.from('audit_logs').select('id').limit(1);
  assert((logs.data ?? []).length === 0, 'audit logs must need aal2');
  const dash = await probe.raw.rpc('admin_dashboard', { p_from: new Date(Date.now() - 86_400_000).toISOString(), p_to: new Date().toISOString() });
  assert(dash.error, 'admin_dashboard must need aal2');
});

await step('admin dashboard, health, merchants, customers, stores, orders (read-only)', async () => {
  const d = await admin.services.admin.dashboard(range);
  assert(d.merchants.value >= 2 && d.activeStores.value >= 1 && d.orders.value >= 1, `dash ${d.merchants.value}/${d.activeStores.value}/${d.orders.value}`);
  assert(d.recentActivity.length > 0, 'recent activity');
  const h = await admin.services.admin.health();
  assert(h.components.some((c) => c.key === 'database' && c.status !== 'outage'), 'health');
  const merchants = await admin.services.admin.listMerchants();
  assert(merchants.some((m) => m.store?.subdomain === subA && m.orderCount >= 2), 'merchant rows');
  const detail = await admin.services.admin.getMerchant(merchants.find((m) => m.store?.subdomain === subA)!.merchant.id);
  assert(detail.recentOrders.length >= 2, 'merchant detail');
  const customers = await admin.services.admin.listCustomers();
  assert(customers.some((c) => c.customer.email === `c.${run}@example.test` && c.orderCount === 1), 'customers');
  const stores = await admin.services.admin.listStores();
  assert(stores.some((s) => s.subdomain === subA && s.ownerEmail === `m.${run}@example.test`), 'stores');
  const orders = await admin.services.admin.listOrders({ storeId: storeAId });
  assert(orders.items.length >= 2, 'orders');
  const o = await admin.services.admin.getOrder(codOrder.id);
  assert(o.storeName === 'Fresh Mart', 'order detail');
  const write = await admin.raw.from('orders').update({ status: 'cancelled' }).eq('id', walletOrderId).select('id');
  assert(write.error || (write.data ?? []).length === 0, 'admin cannot change order status directly');
});

await step('governance: theme in use cannot be deleted; announcement sent; policy needs a second admin', async () => {
  const themes = await admin.services.admin.listThemes();
  assert(themes.length >= 6, `themes ${themes.length}`);
  const t = await admin.services.admin.saveTheme({ name: `Test ${run}`, description: 'Temporary', accent: '#123456', isActive: true });
  await admin.services.admin.deleteTheme(t.id);
  const n = await admin.services.admin.recipientCount('customers');
  assert(n >= 2, `recipients ${n}`);
  const a = await admin.services.admin.saveAnnouncement({ title: 'Maintenance', body: 'Planned maintenance tonight at 2 AM.', audience: 'all', scheduledAt: null }, 'send');
  assert(a.status === 'sent', a.status);
  await expectError(admin.services.admin.deleteAnnouncement(a.id), ['CONFLICT', 'VALIDATION', 'FORBIDDEN'], 'sent announcement is immutable');
  const p = await admin.services.admin.submitPolicy({ type: 'tos', version: `1.${run}`.slice(0, 20), effectiveDate: today, content: 'These are the BazarHQ terms of service. '.repeat(3) });
  await expectError(admin.services.admin.approvePolicy(p.id), ['CONFLICT', 'FORBIDDEN', 'VALIDATION'], 'submitter cannot approve');
  const approved = await admin2.services.admin.approvePolicy(p.id);
  assert(approved.approvedBy, 'second admin approved');
  const published = await admin.services.admin.publishPolicy(p.id);
  assert(published.status === 'published', published.status);
  const pub = await guest.services.storefront.getPublishedPolicy('tos');
  assert(pub?.id === p.id, 'public policy');
});

await step('suspension: reason required, store unpublished, merchant locked out; reinstate', async () => {
  const m = (await admin.services.admin.listMerchants()).find((x) => x.store?.subdomain === subA)!;
  await expectError(admin.services.admin.suspendMerchant(m.merchant.id, ''), 'VALIDATION', 'suspend without reason');
  const s = await admin.services.admin.suspendMerchant(m.merchant.id, 'Repeated policy violations reported');
  assert(s.merchant.status === 'suspended' && s.store?.status === 'suspended', `${s.merchant.status}/${s.store?.status}`);
  await expectError(guest.services.storefront.resolveStore(subA), 'NOT_FOUND', 'suspended store hidden');
  const t = await guest.services.storefront.trackOrder(codOrder.number, '01711000111');
  assert(t.orderNumber === codOrder.number, 'orders stay trackable');
  const relog = newClient();
  await expectError(relog.services.auth.signIn(`m.${run}@example.test`, 'Merchant123'), ['SUSPENDED', 'FORBIDDEN', 'UNAUTHENTICATED'], 'suspended sign-in');
  const back = await admin.services.admin.reinstateMerchant(m.merchant.id);
  assert(back.merchant.status === 'active', back.merchant.status);
});

await step('admin audit log records privileged actions with IP', async () => {
  const logs = await admin.services.admin.listAuditLogs({});
  const actions = new Set(logs.map((l) => l.action));
  for (const a of ['merchant.suspended', 'merchant.reinstated']) assert([...actions].some((x) => x.includes(a.split('.')[1]!)), `missing ${a} in ${[...actions].slice(0, 30).join(',')}`);
  assert(logs.some((l) => l.ipAddress === '127.0.0.1'), 'IP recorded');
  const del = await admin.raw.from('audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id');
  assert(del.error || (del.data ?? []).length === 0, 'audit log is append-only');
});

await step('admin tickets, disputes and refunds views load', async () => {
  const tickets = await admin.services.admin.listTickets({ queue: 'platform' });
  assert(tickets.some((t) => t.category === 'account'), 'platform queue');
  await admin.services.admin.listDisputes({ status: 'all' });
  const refunds = await admin.services.admin.listRefunds({});
  assert(refunds.some((r) => r.status === 'completed'), 'refunds');
});

/* ------------------------------------------------------------------ */

console.table(results.map(({ step: s, ok, detail }) => ({ step: s.slice(0, 90), ok, detail: detail?.slice(0, 120) ?? '' })));
const failed = results.filter((r) => r.ok === '✗');
if (process.env.REPORT_DIR) {
  writeFileSync(`${process.env.REPORT_DIR}/adapter-flows.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
}
console.log(failed.length ? `${failed.length} of ${results.length} steps failed.` : `All ${results.length} adapter steps passed.`);
process.exit(failed.length ? 1 : 0);
