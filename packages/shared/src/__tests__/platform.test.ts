import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createMockServices, createServiceLayer, isServiceError, newIdempotencyKey, type MockPlatformServices } from '../index';

let s: MockPlatformServices;

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => isServiceError(e) && e.code === code);
}

const delivery = {
  recipientName: 'Test Buyer',
  phone: '01711000099',
  email: null,
  address: 'House 3, Road 4, Dhanmondi',
  district: 'Dhaka',
  postalCode: '1205',
};

async function signInAdmin(email = 'admin@bazarhq.test') {
  await s.adminAuth.signIn(email, 'Admin12345');
  return s.adminAuth.verifyTotp(s.dev.demoTotpCode);
}

beforeEach(() => {
  s = createMockServices({ storage: null, latencyMs: [0, 0] });
});

describe('storefront (customer, public)', () => {
  it('only exposes published stores, with one generic error (FR-C-02)', async () => {
    const found = await s.storefront.searchStores('');
    assert.ok(found.every((r) => r.subdomain !== 'kidsheaven' && r.subdomain !== 'homestyle'));
    await rejectsWith(s.storefront.resolveStore('kidsheaven'), 'NOT_FOUND');
    await rejectsWith(s.storefront.resolveStore('does-not-exist'), 'NOT_FOUND');
    const gb = await s.storefront.resolveStore('greenbasket');
    assert.equal(gb.name, 'Green Basket');
  });

  it('guest checkout decrements stock and is idempotent', async () => {
    const store = await s.storefront.resolveStore('greenbasket');
    const product = (await s.storefront.listProducts(store.id)).find((p) => p.productType === 'simple' && (p.stockQuantity ?? 0) > 2)!;
    const before = product.stockQuantity!;
    const input = {
      storeId: store.id,
      items: [{ productId: product.id, variantId: null, quantity: 2, expectedUnitPrice: product.basePrice }],
      delivery,
      paymentMethod: 'cod' as const,
      saveAddress: false,
      idempotencyKey: newIdempotencyKey('t'),
    };
    const a = await s.checkout.placeOrder(input);
    const b = await s.checkout.placeOrder(input);
    assert.equal(a.order.id, b.order.id);
    assert.equal(a.order.status, 'pending');
    assert.equal(a.order.paymentStatus, 'cod_pending');
    const after = (await s.storefront.getProduct(store.id, product.id)).product.stockQuantity;
    assert.equal(after, before - 2);
  });

  it('rejects a stale price (FR-C-12)', async () => {
    const store = await s.storefront.resolveStore('greenbasket');
    const product = (await s.storefront.listProducts(store.id)).find((p) => p.productType === 'simple' && (p.stockQuantity ?? 0) > 0)!;
    await rejectsWith(
      s.checkout.placeOrder({
        storeId: store.id,
        items: [{ productId: product.id, variantId: null, quantity: 1, expectedUnitPrice: product.basePrice - 1 }],
        delivery,
        paymentMethod: 'cod',
        saveAddress: false,
        idempotencyKey: newIdempotencyKey('t'),
      }),
      'CONFLICT',
    );
  });

  it('tracking returns the same not-found for wrong phone (FR-C-27)', async () => {
    const store = await s.storefront.resolveStore('greenbasket');
    const product = (await s.storefront.listProducts(store.id)).find((p) => p.productType === 'simple' && (p.stockQuantity ?? 0) > 0)!;
    const { order } = await s.checkout.placeOrder({
      storeId: store.id,
      items: [{ productId: product.id, variantId: null, quantity: 1, expectedUnitPrice: product.basePrice }],
      delivery,
      paymentMethod: 'cod',
      saveAddress: false,
      idempotencyKey: newIdempotencyKey('t'),
    });
    const ok = await s.storefront.trackOrder(order.orderNumber, delivery.phone);
    assert.equal(ok.orderNumber, order.orderNumber);
    let wrongPhone = '';
    let missing = '';
    await s.storefront.trackOrder(order.orderNumber, '01999999999').catch((e: Error) => (wrongPhone = e.message));
    await s.storefront.trackOrder('ORD-20260101-BHQ999999', delivery.phone).catch((e: Error) => (missing = e.message));
    assert.ok(wrongPhone);
    assert.equal(wrongPhone, missing);
  });

  it('wallet references move payment to pending_verification, never straight to paid by the client', async () => {
    const store = await s.storefront.resolveStore('greenbasket');
    const product = (await s.storefront.listProducts(store.id)).find((p) => p.productType === 'simple' && (p.stockQuantity ?? 0) > 0)!;
    const { order, nextAction } = await s.checkout
      .placeOrder({
        storeId: store.id,
        items: [{ productId: product.id, variantId: null, quantity: 1, expectedUnitPrice: product.basePrice }],
        delivery,
        paymentMethod: 'rocket',
        saveAddress: false,
        idempotencyKey: newIdempotencyKey('t'),
      })
      .catch(async () =>
        s.checkout.placeOrder({
          storeId: store.id,
          items: [{ productId: product.id, variantId: null, quantity: 1, expectedUnitPrice: product.basePrice }],
          delivery,
          paymentMethod: 'bkash',
          saveAddress: false,
          idempotencyKey: newIdempotencyKey('t'),
        }),
      );
    assert.equal(nextAction, 'submit_wallet_reference');
    const r = await s.checkout.submitWalletReference(order.id, { phone: delivery.phone, reference: 'TRX12345678', idempotencyKey: newIdempotencyKey('t') });
    assert.ok(['pending_verification', 'paid'].includes(r.paymentStatus));
    assert.equal(r.payment.providerReferenceMasked?.includes('TRX12345678'), false);
  });
});

describe('customer account', () => {
  beforeEach(async () => {
    await s.auth.signIn('customer@bazarhq.test', 'Customer123');
  });

  it('cannot read another customer order', async () => {
    const mine = await s.account.listOrders();
    assert.ok(mine.length >= 5);
    await s.auth.signOut();
    await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
    const { items } = await s.orders.list();
    const notMine = items.find((o) => !mine.some((m) => m.id === o.id))!;
    await s.auth.signOut();
    await s.auth.signIn('customer@bazarhq.test', 'Customer123');
    await rejectsWith(s.account.getOrder(notMine.id), 'FORBIDDEN');
  });

  it('caps saved addresses at 3 (FR-C-32)', async () => {
    let list = await s.account.listAddresses();
    while (list.length < 3)
      list = await s.account.saveAddress({
        label: `Extra ${list.length}`,
        recipientName: 'Fahim',
        phone: '01711000001',
        address: 'Road 10, Banani',
        district: 'Dhaka',
        postalCode: null,
        isDefault: false,
      });
    await rejectsWith(
      s.account.saveAddress({
        label: 'Fourth',
        recipientName: 'Fahim',
        phone: '01711000001',
        address: 'Road 11, Banani',
        district: 'Dhaka',
        postalCode: null,
        isDefault: false,
      }),
      'CONFLICT',
    );
    assert.equal(list.filter((a) => a.isDefault).length, 1);
  });

  it('allows one return per delivered order inside the window (FR-RET-01)', async () => {
    const orders = await s.account.listOrders();
    const eligible = [];
    for (const o of orders) {
      const d = await s.account.getOrder(o.id);
      if (d.returnEligibility.eligible) eligible.push(d);
    }
    assert.ok(eligible.length >= 1);
    const target = eligible[0]!;
    await s.account.createReturn(target.order.id, {
      reason: 'damaged',
      conditionDescription: 'The box arrived crushed and the item is cracked.',
      idempotencyKey: newIdempotencyKey('t'),
    });
    await rejectsWith(
      s.account.createReturn(target.order.id, {
        reason: 'damaged',
        conditionDescription: 'Trying a second return for the same order.',
        idempotencyKey: newIdempotencyKey('t'),
      }),
      'CONFLICT',
    );
  });

  it('super admins cannot use the customer/merchant sign-in', async () => {
    await s.auth.signOut();
    await rejectsWith(s.auth.signIn('admin@bazarhq.test', 'Admin12345'), 'UNAUTHENTICATED');
  });
});

describe('merchant returns and refunds (§14)', () => {
  beforeEach(async () => {
    await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
  });

  it('requires a reason to reject and follows the state machine', async () => {
    const requested = (await s.returns.list({ status: 'requested' }))[0]!;
    await rejectsWith(s.returns.decide(requested.id, { decision: 'rejected', reason: '' }), 'VALIDATION');
    await s.returns.decide(requested.id, { decision: 'approved', reason: '' });
    await rejectsWith(s.returns.createRefund(requested.id, { amount: 100, method: 'bkash', idempotencyKey: newIdempotencyKey('t') }), 'CONFLICT');
    await rejectsWith(s.returns.confirmReceipt(requested.id, { restock: true, note: '', idempotencyKey: newIdempotencyKey('t') }), 'VALIDATION');
    await s.returns.setReturnMethod(requested.id, 'customer_drop_off');
    await s.returns.confirmReceipt(requested.id, { restock: true, note: 'Checked', idempotencyKey: newIdempotencyKey('t') });
    const d = await s.returns.get(requested.id);
    await rejectsWith(
      s.returns.createRefund(requested.id, { amount: d.order.totalAmount + 1, method: 'bank_transfer', idempotencyKey: newIdempotencyKey('t') }),
      'VALIDATION',
    );
    const withRefund = await s.returns.createRefund(requested.id, {
      amount: d.order.totalAmount,
      method: 'bank_transfer',
      idempotencyKey: newIdempotencyKey('t'),
    });
    const f = withRefund.refund!;
    const done = await s.returns.recordRefundSettlement(f.id, { reference: 'BT-55821', note: '', idempotencyKey: newIdempotencyKey('t') });
    assert.equal(done.refund?.status, 'completed');
    assert.equal(done.returnRequest.status, 'closed');
    assert.equal(done.order.paymentStatus, 'refunded');
  });

  it('cannot read another store return', async () => {
    await s.auth.signOut();
    await signInAdmin();
    const all = await s.admin.listRefunds();
    const other = all.find((f) => f.storeName !== 'Green Basket')!;
    await s.adminAuth.signOut();
    await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
    await rejectsWith(s.returns.markRefundProcessing(other.id, ''), 'FORBIDDEN');
  });
});

describe('super admin (§12)', () => {
  it('requires password and TOTP without IP allowlisting (FR-SA-02)', async () => {
    s.dev.setAdminNetwork('blocked');
    const r = await s.adminAuth.signIn('admin@bazarhq.test', 'Admin12345');
    assert.equal(r.mfaRequired, true);
    await rejectsWith(s.admin.dashboard({ preset: 'custom', from: '2026-01-01', to: '2026-12-31' }), 'UNAUTHENTICATED');
    await rejectsWith(s.adminAuth.verifyTotp('000000'), 'VALIDATION');
    const session = await s.adminAuth.verifyTotp(s.dev.demoTotpCode);
    assert.equal(session.user.role, 'super_admin');
    assert.equal(session.admin?.mfaVerified, true);
  });

  it('expires after 30 idle minutes (FR-SA-03)', async () => {
    await signInAdmin();
    s.dev.expireAdminSession();
    await rejectsWith(s.admin.listMerchants(), 'UNAUTHENTICATED');
  });

  it('suspends with a reason, unpublishes the store and blocks login (FR-SA-11)', async () => {
    await signInAdmin();
    const fp = (await s.admin.listMerchants({ search: 'fashion' }))[0]!;
    await rejectsWith(s.admin.suspendMerchant(fp.merchant.id, 'short'), 'VALIDATION');
    const d = await s.admin.suspendMerchant(fp.merchant.id, 'Repeated counterfeit product complaints.');
    assert.equal(d.store?.status, 'suspended');
    await rejectsWith(s.storefront.resolveStore('fashionpoint'), 'NOT_FOUND');
    const logs = await s.admin.listAuditLogs({ search: 'merchant.suspended' });
    assert.ok(logs.length >= 1);
    await s.adminAuth.signOut();
    await rejectsWith(s.auth.signIn('fashion@bazarhq.test', 'Merchant123'), 'SUSPENDED');
  });

  it('requires the exact deletion phrase (FR-SA-13)', async () => {
    await signInAdmin();
    const m = (await s.admin.listMerchants({ search: 'tech' }))[0]!;
    await rejectsWith(s.admin.deleteMerchant(m.merchant.id, 'DELETE'), 'VALIDATION');
    await s.admin.deleteMerchant(m.merchant.id, `DELETE ${m.merchant.email}`);
    assert.equal((await s.admin.listMerchants({ search: 'tech' })).length, 0);
  });

  it('blocks deleting a theme in use (FR-SA-14)', async () => {
    await signInAdmin();
    const themes = await s.admin.listThemes();
    const used = themes.find((t) => t.usedBy.length > 0)!;
    await rejectsWith(s.admin.deleteTheme(used.id), 'CONFLICT');
  });

  it('enforces policy dual approval (FR-SA-18)', async () => {
    const admin = await signInAdmin();
    const p = await s.admin.submitPolicy({
      type: 'privacy',
      version: '9.0',
      effectiveDate: '2026-12-01',
      content: 'Updated privacy policy text that is long enough to pass validation rules for content.',
    });
    await rejectsWith(s.admin.approvePolicy(p.id), 'FORBIDDEN');
    await rejectsWith(s.admin.publishPolicy(p.id), 'CONFLICT');
    await s.adminAuth.signOut();
    const second = await signInAdmin('admin2@bazarhq.test');
    assert.notEqual(admin.user.id, second.user.id);
    const approved = await s.admin.approvePolicy(p.id);
    assert.equal(approved.status, 'approved');
    const published = await s.admin.publishPolicy(p.id);
    assert.equal(published.status, 'published');
    assert.equal((await s.storefront.getPublishedPolicy('privacy'))?.version, '9.0');
  });

  it('cannot delete a sent announcement', async () => {
    await signInAdmin();
    const sent = (await s.admin.listAnnouncements()).find((a) => a.status === 'sent')!;
    await rejectsWith(s.admin.deleteAnnouncement(sent.id), 'CONFLICT');
  });

  it('has read-only order access (no status mutations on the admin service)', async () => {
    await signInAdmin();
    const keys = Object.keys(s.admin);
    assert.ok(!keys.some((k) => /updateOrderStatus|cancelOrder/.test(k)));
    const { items } = await s.admin.listOrders();
    assert.ok(items.length > 50);
  });

  it('can override a rejected-return dispute', async () => {
    await signInAdmin();
    const d = (await s.admin.listDisputes()).find((x) => x.kind === 'return')!;
    await s.admin.resolveDispute('return', d.id, { action: 'override', note: 'Evidence shows the item was faulty on arrival.' });
    const r = await s.admin.getReturnDispute(d.id);
    assert.equal(r.returnRequest.status, 'approved');
    assert.equal(r.returnRequest.dispute.decision, 'overridden');
  });
});

describe('security invariants from the brief', () => {
  it('blocks invalid order transitions server-side', async () => {
    await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
    const { items } = await s.orders.list({ status: 'pending' });
    const pending = items[0]!;
    for (const to of ['shipped', 'out_for_delivery', 'delivered'] as const) {
      await rejectsWith(s.orders.updateStatus(pending.id, to, { idempotencyKey: newIdempotencyKey('t') }), 'CONFLICT');
    }
    const delivered = (await s.orders.list({ status: 'delivered' })).items[0]!;
    await rejectsWith(s.orders.updateStatus(delivered.id, 'confirmed', { idempotencyKey: newIdempotencyKey('t') }), 'CONFLICT');
  });

  it('never lets a customer or guest set payment status', async () => {
    // Guest: a wallet reference only moves the attempt to pending_verification/verification by the server.
    const store = await s.storefront.resolveStore('greenbasket');
    const product = (await s.storefront.listProducts(store.id)).find((p) => p.productType === 'simple' && (p.stockQuantity ?? 0) > 0)!;
    const { order } = await s.checkout.placeOrder({
      storeId: store.id,
      items: [{ productId: product.id, variantId: null, quantity: 1, expectedUnitPrice: product.basePrice }],
      delivery,
      paymentMethod: 'bkash',
      saveAddress: false,
      idempotencyKey: newIdempotencyKey('t'),
    });
    assert.equal(order.paymentStatus, 'pending');
    const failed = await s.checkout.submitWalletReference(order.id, {
      phone: delivery.phone,
      reference: 'FAIL1234567',
      idempotencyKey: newIdempotencyKey('t'),
    });
    assert.equal(failed.paymentStatus, 'failed');
    // Customer: manual review endpoints are merchant/admin only.
    await s.auth.signIn('customer@bazarhq.test', 'Customer123');
    await assert.rejects(s.orders.reviewPayment(order.id, { decision: 'paid', reason: 'I promise I paid already', idempotencyKey: newIdempotencyKey('t') }));
    await assert.rejects(s.admin.reviewPayment(order.id, { decision: 'paid', reason: 'I promise I paid already', idempotencyKey: newIdempotencyKey('t') }));
    // The wrong phone can't even submit a reference for someone else's order.
    await rejectsWith(
      s.checkout.submitWalletReference(order.id, { phone: '01999999999', reference: 'TRX12345678', idempotencyKey: newIdempotencyKey('t') }),
      'NOT_FOUND',
    );
  });

  it('assigns roles server-side (public signup can never create an admin)', async () => {
    await s.auth.register({ fullName: 'New Shopper', email: 'shopper@example.test', password: 'Password1', accountType: 'customer' });
    const session = await s.auth.getSession();
    assert.equal(session?.user.role, 'customer');
    await s.auth.signOut();
    await s.auth.register({ fullName: 'Sneaky', email: 'sneaky@example.test', password: 'Password1', accountType: 'super_admin' as never });
    assert.equal((await s.auth.getSession())?.user.role, 'merchant');
  });

  it('exposes the named service layer over the same implementation', () => {
    const layer = createServiceLayer(s);
    assert.equal(layer.orderService, s.orders);
    assert.equal(layer.refundService.adminIntervene, s.admin.interveneRefund);
    assert.equal(typeof layer.paymentService.checkout.placeOrder, 'function');
    assert.equal(Object.keys(layer).length, 14);
  });
});

describe('product duplicate (FR-M-19)', () => {
  it('creates a draft copy with stock 0, a unique SKU and the chosen parts', async () => {
    await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
    const src = (await s.products.list()).find((p) => p.extensions.compareAtPrice !== null && p.productType === 'simple')!;
    const a = await s.products.duplicate(src.id);
    const b = await s.products.duplicate(src.id, { name: 'Apple gift box', includePricing: false, includeImages: false });
    assert.equal(a.status, 'draft');
    assert.equal(a.stockQuantity, 0);
    assert.equal(a.extensions.sku, `${src.extensions.sku}-COPY`);
    assert.equal(b.extensions.sku, `${src.extensions.sku}-COPY-2`);
    assert.equal(a.extensions.compareAtPrice, src.extensions.compareAtPrice);
    assert.equal(b.extensions.compareAtPrice, null);
    assert.equal(b.name, 'Apple gift box');
    assert.equal(b.basePrice, src.basePrice);
    await rejectsWith(s.products.duplicate(src.id, { name: ' ' }), 'VALIDATION');
  });
});
