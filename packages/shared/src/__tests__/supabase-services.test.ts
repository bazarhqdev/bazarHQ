import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseServices } from '../services/supabase';

test('createSupabaseServices composes every PlatformServices group', () => {
  const services = createSupabaseServices({
    url: 'https://bazarhq-test.supabase.co',
    anonKey: 'sb_publishable_test_key',
  });

  for (const key of [
    'auth',
    'store',
    'products',
    'inventory',
    'orders',
    'customers',
    'payments',
    'analytics',
    'support',
    'notifications',
    'returns',
    'storefront',
    'checkout',
    'account',
    'adminAuth',
    'admin',
  ] as const) {
    assert.ok(services[key], `Expected ${key} to be composed`);
  }

  assert.equal(typeof services.auth.signIn, 'function');
  assert.equal(typeof services.storefront.featuredStores, 'function');
  assert.equal(typeof services.checkout.placeOrder, 'function');
  assert.equal(typeof services.admin.health, 'function');
});
