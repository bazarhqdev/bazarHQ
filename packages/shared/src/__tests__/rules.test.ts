import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  displayPrice,
  canCancelOrder,
  canRecordCodCollection,
  canTransitionOrder,
  canTransitionTicket,
  checkSubdomainSyntax,
  computeOnboarding,
  confirmBlockedReason,
  formatPublicId,
  nextForwardStatus,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  productInputSchema,
  productStockState,
  registerSchema,
  suggestSubdomains,
  bdPhoneSchema,
} from '../index';
import type { OrderStatus, Product } from '../index';

describe('order state machine (SRS §13.1)', () => {
  it('uses exactly the canonical statuses', () => {
    assert.deepEqual([...ORDER_STATUSES], ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled']);
    assert.deepEqual([...PAYMENT_STATUSES], ['pending', 'pending_verification', 'paid', 'failed', 'cod_pending', 'cod_collected', 'refunded']);
  });

  it('allows only the forward path', () => {
    const path: OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(nextForwardStatus(path[i]!), path[i + 1]);
      assert.ok(canTransitionOrder(path[i]!, path[i + 1]!));
    }
    assert.equal(canTransitionOrder('pending', 'shipped'), false, 'no skipping');
    assert.equal(canTransitionOrder('delivered', 'pending'), false, 'no going back');
    assert.equal(nextForwardStatus('delivered'), null);
    assert.equal(nextForwardStatus('cancelled'), null);
  });

  it('blocks cancellation for out_for_delivery and delivered', () => {
    assert.ok(canCancelOrder('pending'));
    assert.ok(canCancelOrder('shipped'));
    assert.equal(canCancelOrder('out_for_delivery'), false);
    assert.equal(canCancelOrder('delivered'), false);
    assert.equal(canCancelOrder('cancelled'), false);
  });

  it('records COD collection only after dispatch and only once', () => {
    assert.ok(canRecordCodCollection({ paymentMethod: 'cod', paymentStatus: 'cod_pending', status: 'delivered' }));
    assert.equal(canRecordCodCollection({ paymentMethod: 'cod', paymentStatus: 'cod_pending', status: 'processing' }), false);
    assert.equal(canRecordCodCollection({ paymentMethod: 'cod', paymentStatus: 'cod_collected', status: 'delivered' }), false);
    assert.equal(canRecordCodCollection({ paymentMethod: 'bkash', paymentStatus: 'paid', status: 'delivered' }), false);
  });

  it('never lets an unverified payment be confirmed from the UI', () => {
    assert.ok(confirmBlockedReason({ status: 'pending', paymentStatus: 'pending_verification' }));
    assert.equal(confirmBlockedReason({ status: 'pending', paymentStatus: 'paid' }), null);
    assert.equal(confirmBlockedReason({ status: 'pending', paymentStatus: 'cod_pending' }), null);
  });
});

describe('ticket workflow (FR-SUP-04)', () => {
  it('follows Open → In Progress → Waiting → Resolved → Closed', () => {
    assert.ok(canTransitionTicket('open', 'in_progress'));
    assert.ok(canTransitionTicket('in_progress', 'resolved'));
    assert.ok(canTransitionTicket('resolved', 'closed'));
    assert.equal(canTransitionTicket('open', 'closed'), false);
    assert.equal(canTransitionTicket('closed', 'open'), false);
  });
});

describe('stock model (FR-M-15/18/21)', () => {
  const base = { lowStockThreshold: 5, basePrice: 100 } as const;
  it('simple products use products.stock_quantity', () => {
    assert.equal(productStockState({ ...base, productType: 'simple', stockQuantity: 0, variants: [] }), 'out_of_stock');
    assert.equal(productStockState({ ...base, productType: 'simple', stockQuantity: 5, variants: [] }), 'low_stock');
    assert.equal(productStockState({ ...base, productType: 'simple', stockQuantity: 6, variants: [] }), 'in_stock');
  });
  it('variant products flag low stock if any variant is low; out of stock only if all are', () => {
    const v = (stock: number) => ({
      id: String(stock),
      productId: 'p',
      variantLabel: 'x',
      priceAdjustment: 0,
      stockQuantity: stock,
      status: 'active' as const,
    });
    assert.equal(productStockState({ ...base, productType: 'variant', stockQuantity: null, variants: [v(0), v(40)] }), 'low_stock');
    assert.equal(productStockState({ ...base, productType: 'variant', stockQuantity: null, variants: [v(0), v(0)] }), 'out_of_stock');
    assert.equal(productStockState({ ...base, productType: 'variant', stockQuantity: null, variants: [v(10), v(40)] }), 'in_stock');
  });
});

describe('validation', () => {
  it('enforces password rules (AUTH-01)', () => {
    assert.equal(registerSchema.safeParse({ fullName: 'Ana B', email: 'a@b.co', password: 'short1', confirmPassword: 'short1' }).success, false);
    assert.equal(registerSchema.safeParse({ fullName: 'Ana B', email: 'a@b.co', password: 'longenough', confirmPassword: 'longenough' }).success, false);
    assert.equal(registerSchema.safeParse({ fullName: 'Ana B', email: 'a@b.co', password: 'longenough1', confirmPassword: 'longenough1' }).success, true);
  });

  it('validates Bangladeshi phone numbers', () => {
    assert.ok(bdPhoneSchema.safeParse('01306060688').success);
    assert.equal(bdPhoneSchema.safeParse('0130606068').success, false);
    assert.equal(bdPhoneSchema.safeParse('01206060688').success, false);
  });

  it('original price must be above the base price (display only)', () => {
    const p = {
      name: 'Rice',
      description: 'Fragrant rice grains',
      categoryId: 'c',
      basePrice: 100,
      lowStockThreshold: 5,
      status: 'active',
      sku: '',
      images: [],
      productType: 'simple',
      stockQuantity: 3,
      variants: [],
    };
    assert.equal(productInputSchema.safeParse({ ...p, compareAtPrice: 120 }).success, true);
    assert.equal(productInputSchema.safeParse({ ...p, compareAtPrice: 100 }).success, false);
    assert.equal(productInputSchema.safeParse({ ...p, compareAtPrice: null }).success, true);
    assert.deepEqual(displayPrice({ basePrice: 100, extensions: { sku: null, compareAtPrice: 125 } }, { priceAdjustment: 25 }), {
      price: 125,
      original: 150,
      percentOff: 17,
    });
    assert.deepEqual(displayPrice({ basePrice: 100, extensions: { sku: null, compareAtPrice: null } }), { price: 100, original: null, percentOff: null });
  });

  it('rejects mixed stock representations', () => {
    const p = {
      name: 'Rice',
      description: 'Fragrant rice grains',
      categoryId: 'c',
      basePrice: 100,
      lowStockThreshold: 5,
      status: 'active',
      sku: '',
      images: [],
    };
    assert.equal(productInputSchema.safeParse({ ...p, productType: 'simple', stockQuantity: null, variants: [] }).success, false);
    assert.equal(productInputSchema.safeParse({ ...p, productType: 'variant', stockQuantity: null, variants: [] }).success, false);
    assert.equal(
      productInputSchema.safeParse({
        ...p,
        productType: 'variant',
        stockQuantity: null,
        variants: [{ variantLabel: '1 kg', priceAdjustment: 0, stockQuantity: 3, status: 'active' }],
      }).success,
      true,
    );
    assert.equal(productInputSchema.safeParse({ ...p, productType: 'simple', stockQuantity: 4, variants: [] }).success, true);
  });
});

describe('subdomains (FR-M-07/08)', () => {
  it('rejects reserved words and bad syntax', () => {
    assert.equal(checkSubdomainSyntax('admin').ok, false);
    assert.equal(checkSubdomainSyntax('-shop').ok, false);
    assert.equal(checkSubdomainSyntax('Green_Basket').ok, false);
    assert.equal(checkSubdomainSyntax('greenbasket').ok, true);
  });
  it('suggests numeric suffixes', () => {
    const taken = new Set(['greenbasket1']);
    assert.deepEqual(
      suggestSubdomains('greenbasket', (s) => taken.has(s)),
      ['greenbasket2', 'greenbasket3', 'greenbasket4'],
    );
  });
});

describe('onboarding (FR-M-11)', () => {
  it('is publishable only at 100% with a payment method', () => {
    const store = { subdomain: 's', logoUrl: 'x' } as unknown as Parameters<typeof computeOnboarding>[0];
    assert.equal(computeOnboarding(store, [{ isEnabled: true }], 1).publishable, true);
    assert.equal(computeOnboarding(store, [{ isEnabled: false }], 1).publishable, false);
    assert.equal(computeOnboarding(store, [{ isEnabled: true }], 0).percent, 75);
  });
});

describe('ids', () => {
  it('formats ORD-YYYYMMDD-BHQXXXXXX', () => {
    assert.match(formatPublicId('ORD', new Date('2026-10-20T06:00:00Z'), 123), /^ORD-20261020-BHQ000123$/);
  });
});

void ({} as Product);
