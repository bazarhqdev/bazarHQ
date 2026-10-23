import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createMockServices, isServiceError, newIdempotencyKey, type MockMerchantServices } from '../index';

let s: MockMerchantServices;

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => isServiceError(e) && e.code === code);
}

beforeEach(async () => {
  s = createMockServices({ storage: null, latencyMs: [0, 0] });
  await s.auth.signIn('merchant@bazarhq.test', 'Merchant123');
});

describe('mock auth', () => {
  it('locks after 5 failed attempts (AUTH-07)', async () => {
    await s.auth.signOut();
    for (let i = 0; i < 4; i++) await rejectsWith(s.auth.signIn('new@bazarhq.test', 'wrong'), 'UNAUTHENTICATED');
    await rejectsWith(s.auth.signIn('new@bazarhq.test', 'wrong'), 'LOCKED');
    await rejectsWith(s.auth.signIn('new@bazarhq.test', 'Merchant123'), 'LOCKED');
  });
  it('blocks suspended accounts with a reason (AUTH-14)', async () => {
    await s.auth.signOut();
    await rejectsWith(s.auth.signIn('suspended@bazarhq.test', 'Merchant123'), 'SUSPENDED');
  });
  it('rejects duplicate registration (FR-M-02)', async () => {
    await rejectsWith(s.auth.register({ fullName: 'X Y', email: 'merchant@bazarhq.test', password: 'Password1' }), 'CONFLICT');
  });
  it('blocks a second store (FR-M-10)', async () => {
    await rejectsWith(s.store.createStore({ name: 'Second', subdomain: 'secondshop', category: 'other', tagline: '' }), 'CONFLICT');
  });
});

describe('mock orders', () => {
  it('rejects invalid transitions server-side', async () => {
    const { items } = await s.orders.list({ status: 'delivered' });
    const delivered = items[0]!;
    await rejectsWith(s.orders.updateStatus(delivered.id, 'processing', { idempotencyKey: newIdempotencyKey('t') }), 'CONFLICT');
    await rejectsWith(s.orders.cancel(delivered.id, { reason: 'Customer asked', idempotencyKey: newIdempotencyKey('t') }), 'CONFLICT');
  });

  it('releases stock exactly once on cancellation (FR-M-31)', async () => {
    const { items } = await s.orders.list({ status: 'processing' });
    const order = items[0]!;
    const before = await s.inventory.movements({ limit: 1000 });
    const key = newIdempotencyKey('cancel');
    await s.orders.cancel(order.id, { reason: 'Customer asked to cancel', idempotencyKey: key });
    await s.orders.cancel(order.id, { reason: 'Customer asked to cancel', idempotencyKey: key }); // retry
    const after = await s.inventory.movements({ limit: 1000 });
    const releases = after.filter((m) => m.reason === 'cancellation_release' && m.referenceId === order.orderNumber);
    assert.equal(releases.length, order.items.length);
    assert.equal(after.length - before.length, order.items.length);
  });

  it('is idempotent for repeated status updates', async () => {
    const { items } = await s.orders.list({ status: 'confirmed' });
    const order = items[0]!;
    const key = newIdempotencyKey('status');
    await s.orders.updateStatus(order.id, 'processing', { idempotencyKey: key });
    const detail = await s.orders.updateStatus(order.id, 'processing', { idempotencyKey: key });
    assert.equal(detail.order.status, 'processing');
    assert.equal(detail.events.filter((e) => e.eventType === 'processing').length, 1);
  });
});

describe('mock tenancy and payments', () => {
  it('returns 403 for another store’s resources (AUTHZ-04)', async () => {
    const products = await s.products.list();
    const id = products[0]!.id;
    await s.auth.signOut();
    await s.auth.signIn('new@bazarhq.test', 'Merchant123');
    await s.store.createStore({ name: 'Other', subdomain: 'othershop', category: 'other', tagline: '' });
    await rejectsWith(s.products.get(id), 'FORBIDDEN');
  });

  it('never returns raw credentials and disables SSLCommerz on invalid credentials (FR-M-33/34)', async () => {
    const cfg = await s.payments.saveCredentials({ method: 'sslcommerz', values: { storeId: 'bad_store', storePassword: 'secret-pass' } });
    assert.equal(cfg.isEnabled, false);
    assert.equal(cfg.validation, 'invalid');
    assert.equal(JSON.stringify(cfg).includes('secret-pass'), false);
  });

  it('keeps stock non-negative and records movements', async () => {
    const rows = await s.inventory.list();
    const row = rows.find((r) => r.variantId === null && r.stockQuantity > 0)!;
    await rejectsWith(
      s.inventory.adjust({
        productId: row.productId,
        variantId: null,
        delta: -(row.stockQuantity + 1),
        note: 'too many',
        idempotencyKey: newIdempotencyKey('a'),
      }),
      'VALIDATION',
    );
    const updated = await s.inventory.adjust({ productId: row.productId, variantId: null, delta: 5, note: 'restock', idempotencyKey: newIdempotencyKey('a') });
    assert.equal(updated.stockQuantity, row.stockQuantity + 5);
  });
});
