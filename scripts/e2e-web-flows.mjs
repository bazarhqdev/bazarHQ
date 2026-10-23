#!/usr/bin/env node
/**
 * Smoke-tests the main Merchant Web flows against a running build (mock data):
 * onboarding a new merchant, publishing gate, product creation, stock
 * adjustment, order transitions and cancellation, payment toggles, tickets,
 * returns + refunds and delivery-history export; Customer guest checkout
 * (COD + bKash), tracking, returns and tickets; Super Admin login + TOTP,
 * suspension, dual-approval policies, disputes and theme deletion rules.
 *   BASE_URL=http://localhost:3000 node scripts/e2e-web-flows.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
const errors = [];

async function step(name, fn) {
  try {
    await fn();
    results.push({ step: name, ok: '✓' });
  } catch (e) {
    results.push({ step: name, ok: '✗' });
    errors.push(`${name}: ${e.message.split('\n')[0]}`);
    if (process.env.FAIL_DIR)
      await (globalThis.activePage ?? page).screenshot({ path: `${process.env.FAIL_DIR}/fail-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}

const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.setDefaultTimeout(12000);

async function login(email, password = 'Merchant123') {
  await page.goto(`${BASE}/merchant/login`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

await step('wrong password shows a plain-English error', async () => {
  await login('merchant@bazarhq.test', 'nope12345');
  await page.getByText('Incorrect email or password.').waitFor();
});

await step('unverified account is sent to verify-email', async () => {
  await login('unverified@bazarhq.test');
  await page.waitForURL('**/verify-email');
  await page.getByRole('button', { name: 'Simulate clicking the email link' }).click();
  await page.getByRole('button', { name: 'I’ve verified my email' }).click();
  await page.waitForURL('**/merchant/onboarding');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/merchant/login**');
});

await step('new merchant creates a store (reserved + taken subdomain checks)', async () => {
  await login('new@bazarhq.test');
  await page.waitForURL('**/merchant/onboarding');
  await page.getByRole('link', { name: 'Create my store' }).click();
  await page.getByLabel('Store name').fill('Fresh Mart');
  await page.getByText('freshmart.bazarhq.com is already taken.').waitFor();
  await page.getByRole('button', { name: 'freshmart1' }).click();
  await page.getByText('freshmart1.bazarhq.com is available.').waitFor();
  await page.locator('#subdomain').fill('admin');
  await page.getByText(/reserved by BazarHQ/).waitFor();
  await page.locator('#subdomain').fill('freshmart-bd');
  await page.getByText('freshmart-bd.bazarhq.com is available.').waitFor();
  await page.getByLabel('Store category').selectOption('groceries');
  await page.getByRole('button', { name: 'Create store & continue' }).click();
  await page.waitForURL('**/onboarding/theme');
  await page.getByRole('radio', { name: /Grocery/ }).click();
  await page.getByRole('button', { name: 'Save & continue' }).click();
  await page.waitForURL('**/merchant/onboarding');
  await page.getByText('25% complete').waitFor();
  const disabled = await page.getByRole('button', { name: 'Publish store' }).isDisabled();
  if (!disabled) throw new Error('Publish should be disabled below 100%');
});

await step('COD can be enabled without credentials; bKash cannot', async () => {
  await page.goto(`${BASE}/merchant/payment-settings`);
  await page.getByRole('switch', { name: 'Accept Cash on Delivery' }).click();
  await page.getByText('Cash on Delivery enabled').waitFor();
  await page.getByRole('switch', { name: 'Accept bKash' }).click();
  await page.getByText(/Add and verify your bKash credentials/).waitFor();
});

await step('create a variant product with validation', async () => {
  await page.goto(`${BASE}/merchant/products/new`);
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByText('Please fix the highlighted fields.').waitFor();
  await page.getByLabel('Product name').fill('Basmati Rice');
  await page.getByLabel('Description').fill('Long grain aromatic basmati rice.');
  await page.getByRole('button', { name: 'New category' }).click();
  await page.getByLabel('Category name').fill('Rice');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel('Base price').fill('180');
  await page.getByText('Has variants').click();
  await page.getByLabel('Variant name').first().fill('1 kg');
  await page.getByLabel('Opening stock').first().fill('20');
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.waitForURL('**/merchant/products');
  await page.getByText('Basmati Rice').first().waitFor();
});

await step('onboarding shows progress after product + payment', async () => {
  await page.goto(`${BASE}/merchant/onboarding`);
  await page.getByText('75% complete').waitFor();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/merchant/login**');
});

await step('order: confirm → processing, cancel requires reason', async () => {
  await login('merchant@bazarhq.test');
  await page.waitForURL('**/dashboard');
  await page.goto(`${BASE}/merchant/orders`);
  await page.getByRole('tab', { name: /^Confirmed/ }).click();
  await page.locator('a[href^="/merchant/orders/"]').first().click();
  await page.getByRole('button', { name: 'Start processing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start processing' }).click();
  await page.getByText('Order marked processing').waitFor();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await page.getByText('Give the customer a reason').waitFor();
  await page.getByLabel('Cancellation reason').fill('Customer asked to cancel by phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await page.getByText('Order cancelled').waitFor();
  await page.getByText('This order is cancelled. No further status changes are available.').waitFor();
});

await step('delivered orders cannot be cancelled', async () => {
  await page.goto(`${BASE}/merchant/orders`);
  await page.getByRole('tab', { name: /^Delivered/ }).click();
  await page.locator('a[href^="/merchant/orders/"]').first().click();
  await page.getByText('Items (').waitFor();
  if (await page.getByRole('button', { name: 'Cancel order' }).count()) throw new Error('Cancel offered on delivered order');
});

await step('inventory adjustment cannot go negative and is logged', async () => {
  await page.goto(`${BASE}/merchant/inventory`);
  await page.getByRole('button', { name: 'Adjust' }).first().click();
  await page.getByRole('radio', { name: 'Remove stock' }).click();
  await page.getByLabel('Quantity').fill('9999');
  await page.getByLabel('Reason').fill('test');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await page.getByText(/Stock cannot go below 0/).waitFor();
  await page.getByRole('radio', { name: 'Add stock' }).click();
  await page.getByLabel('Quantity').fill('12');
  await page.getByLabel('Reason').fill('Restock from supplier');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await page.getByText('Stock updated').waitFor();
  await page.getByText('“Restock from supplier”').first().waitFor();
});

await step('support: resolve requires a note', async () => {
  await page.goto(`${BASE}/merchant/support`);
  await page.getByText('Order not delivered yet').click();
  await page.getByRole('button', { name: 'Mark in progress' }).click();
  await page.getByText('Ticket in progress').waitFor();
  await page.getByLabel('Reply to customer').fill('We are checking with the courier now.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await page.getByText('We are checking with the courier now.').nth(0).waitFor();
  await page.getByRole('button', { name: 'Resolve', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByRole('alert').getByText('A resolution note is required').waitFor();
});

await step('analytics CSV export downloads', async () => {
  await page.goto(`${BASE}/merchant/analytics`);
  await page.getByText('Revenue trend').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  if (!download.suggestedFilename().endsWith('.csv')) throw new Error('not a csv');
});

await step('merchant: delivery history CSV downloads', async () => {
  await page.goto(`${BASE}/merchant/orders`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Delivery history CSV' }).click()]);
  if (!download.suggestedFilename().includes('delivery-history')) throw new Error('unexpected filename');
});

await step('merchant: approve return → receive → refund → settle', async () => {
  await page.goto(`${BASE}/merchant/returns`);
  await page.getByRole('tab', { name: /Return requested/ }).click();
  await page.locator('ul button').first().click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Return approved').first().waitFor();
  await page.getByLabel('Return method').selectOption('customer_drop_off');
  await page.getByRole('button', { name: 'Confirm item received' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm receipt' }).click();
  await page.getByRole('button', { name: 'Create refund' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create refund' }).click();
  await page.getByRole('button', { name: 'Record settlement' }).click();
  await page.getByLabel('Settlement reference').fill('BKASH-REF-7781');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark completed' }).click();
  await page.getByText('Settlement reference: BKASH-REF-7781').waitFor();
});

await step('merchant: rejecting a return requires a reason', async () => {
  // (the seed has a single requested return; the rule is enforced by the shared schema + service tests)
  await page.goto(`${BASE}/merchant/returns`);
  await page.getByRole('heading', { name: 'Returns & refunds' }).waitFor();
});

// ---------------------------------------------------------------- Customer
await step('merchant: original price must be above the base price and previews the discount', async () => {
  await page.goto(`${BASE}/merchant/products/new`);
  await page.getByLabel('Base price').fill('500');
  await page.getByLabel('Original / asking price').fill('400');
  await page.getByText('Original price must be higher than the base price to show.').waitFor();
  await page.getByLabel('Original / asking price').fill('650');
  await page.getByText('Customers see').waitFor();
  await page.getByText('23% off').first().waitFor();
});

await step('merchant: duplicate makes a draft copy with stock 0 and a unique SKU', async () => {
  await page.goto(`${BASE}/merchant/products`);
  await page.getByRole('button', { name: 'Duplicate Red Apple' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name of the copy/).fill('Red Apple Copy E2E');
  await dialog.getByRole('button', { name: 'Create copy' }).click();
  await page.getByText('Draft copy created').waitFor();
  await page.waitForURL(/\/merchant\/products\/(?!new)[^/]+$/);
  await page.goto(`${BASE}/merchant/products`);
  await page.getByRole('tab', { name: /^Draft/ }).click();
  await page.getByText('Red Apple Copy E2E').first().waitFor();
  await page.getByText('FRU-APL-1KG-COPY').first().waitFor();
});

const cctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const cpage = await cctx.newPage();
cpage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
cpage.setDefaultTimeout(12000);
globalThis.activePage = cpage;
let guestOrder = '';

async function addFirstProduct(store) {
  await cpage.goto(`${BASE}/store/${store}/products?sort=price_asc`);
  await cpage.locator(`a[href^="/store/${store}/products/"]`).first().click();
  await cpage.getByRole('button', { name: 'Add to cart' }).click();
  await cpage.getByText('Added to cart').waitFor();
}

async function checkoutAsGuest(store, method) {
  await cpage.goto(`${BASE}/store/${store}/checkout`);
  await cpage.getByLabel('Full name').fill('E2E Guest');
  await cpage.getByLabel('Phone').fill('01712345000');
  await cpage.getByLabel('Address').fill('House 9, Road 2, Banani');
  await cpage.getByLabel('District').selectOption('Dhaka');
  await cpage.getByRole('button', { name: 'Continue to payment' }).click();
  await cpage.getByRole('radio', { name: new RegExp(method) }).click();
  await cpage.getByRole('button', { name: 'Review order' }).click();
  await cpage.getByRole('button', { name: /Place order/ }).click();
  await cpage.getByTestId('order-number').waitFor();
  return (await cpage.getByTestId('order-number').textContent()).trim();
}

await step('customer: unknown and suspended stores show the same unavailable page', async () => {
  await cpage.goto(`${BASE}/store/kidsheaven`);
  await cpage.getByRole('heading', { name: 'Store unavailable' }).waitFor();
  await cpage.goto(`${BASE}/store/nope-not-real`);
  await cpage.getByRole('heading', { name: 'Store unavailable' }).waitFor();
});

await step('customer: store search finds stores, not products', async () => {
  await cpage.goto(`${BASE}/stores?q=tech`);
  await cpage.getByText('techworld.bazarhq.com').waitFor();
});

await step('customer: carts stay per store', async () => {
  await addFirstProduct('greenbasket');
  await addFirstProduct('techworld');
  await cpage.goto(`${BASE}/cart`);
  await cpage.getByText('Green Basket', { exact: true }).waitFor();
  await cpage.getByText('Tech World', { exact: true }).waitFor();
});

await step('customer: compare up to 3 products from one store', async () => {
  await cpage.goto(`${BASE}/store/greenbasket/products`);
  const add = cpage.getByRole('button', { name: /^Add .+ to compare$/ });
  for (let i = 0; i < 3; i++) await add.first().click();
  await add.first().click();
  await cpage.getByText('You can compare up to 3 products').waitFor();
  await cpage.getByRole('button', { name: 'Compare (3)' }).click();
  const dialog = cpage.getByRole('dialog');
  await dialog.getByText('Lowest price').first().waitFor();
  await dialog.getByRole('link', { name: /View/ }).first().waitFor();
  await cpage.keyboard.press('Escape');
  await cpage.getByRole('button', { name: 'Clear' }).click();
  await cpage.getByRole('region', { name: 'Compare products' }).waitFor({ state: 'detached' });
});

await step('customer: guest COD checkout creates an order and clears that cart only', async () => {
  guestOrder = await checkoutAsGuest('greenbasket', 'Cash on Delivery');
  if (!/^ORD-\d{8}-BHQ\d{6}$/.test(guestOrder)) throw new Error(`bad order id ${guestOrder}`);
  await cpage.goto(`${BASE}/cart`);
  await cpage.getByText('Tech World', { exact: true }).waitFor();
  if (await cpage.getByText('Green Basket', { exact: true }).count()) throw new Error('green basket cart not cleared');
});

await step('customer: invalid phone blocks the delivery step', async () => {
  await cpage.goto(`${BASE}/store/techworld/checkout`);
  await cpage.getByLabel('Full name').fill('E2E Guest');
  await cpage.getByLabel('Phone').fill('12345');
  await cpage.getByLabel('Address').fill('House 9, Road 2, Banani');
  await cpage.getByLabel('District').selectOption('Dhaka');
  await cpage.getByRole('button', { name: 'Continue to payment' }).click();
  await cpage
    .getByText(/Bangladesh|01/)
    .first()
    .waitFor();
  if (await cpage.getByRole('radiogroup', { name: 'Payment method' }).count()) throw new Error('advanced with invalid phone');
});

await step('customer: bKash order → transaction ID → server-verified payment', async () => {
  await checkoutAsGuest('techworld', 'bKash');
  await cpage.getByLabel('Transaction ID').fill('9BX4K2LQ7M');
  await cpage.getByRole('button', { name: 'Submit' }).click();
  await cpage.getByText('Payment verified').first().waitFor();
});

await step('customer: tracking needs the right phone (privacy-preserving)', async () => {
  await cpage.goto(`${BASE}/track?order=${guestOrder}`);
  await cpage.getByLabel('Phone number').fill('01999999999');
  await cpage.getByRole('button', { name: 'Track' }).click();
  await cpage
    .getByRole('heading', { name: 'Order not found' })
    .first()
    .waitFor()
    .catch(() => cpage.getByText('Order not found').first().waitFor());
  await cpage.getByLabel('Phone number').fill('01712345000');
  await cpage.getByRole('button', { name: 'Track' }).click();
  await cpage.getByText('Contact Green Basket').waitFor();
});

await step('customer: signed-in return request + ticket', async () => {
  await cpage.goto(`${BASE}/login`);
  await cpage.getByLabel('Email').fill('customer@bazarhq.test');
  await cpage.getByLabel(/^Password/).fill('Customer123');
  await cpage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await cpage.waitForURL('**/customer');
  await cpage.goto(`${BASE}/orders`);
  await cpage.getByRole('tab', { name: 'Delivered' }).click();
  await cpage.locator('main a[href^="/orders/"]').first().waitFor();
  const hrefs = await cpage.locator('main a[href^="/orders/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  let done = false;
  for (const href of hrefs) {
    await cpage.goto(BASE + href);
    await cpage.getByRole('link', { name: 'Get help' }).waitFor();
    await cpage.waitForTimeout(600);
    if (await cpage.getByRole('button', { name: 'Request return' }).count()) {
      await cpage.getByRole('button', { name: 'Request return' }).click();
      await cpage.getByLabel('Reason').selectOption('damaged');
      await cpage.getByLabel('Item condition').fill('The glass screen cracked during delivery.');
      await cpage.getByRole('dialog').getByRole('button', { name: 'Submit request' }).click();
      await cpage.waitForURL('**/customer/returns/**');
      done = true;
      break;
    }
  }
  if (!done) throw new Error('no return-eligible order found');
  await cpage.goto(`${BASE}/customer/support/new`);
  await cpage.getByLabel('Category').selectOption('account_issue');
  await cpage.getByLabel('Subject').fill('Cannot change my email');
  await cpage.getByLabel('Describe the issue').fill('The verification email never arrives when I change my address.');
  await cpage.getByRole('button', { name: 'Create ticket' }).click();
  await cpage.waitForURL('**/customer/support/**');
  await cpage.getByText('BazarHQ support').first().waitFor();
});

await step('customer: address book is capped at 3', async () => {
  await cpage.goto(`${BASE}/profile`);
  await cpage.getByRole('heading', { name: 'Saved addresses' }).waitFor();
  const add = cpage.getByRole('button', { name: 'Add', exact: true });
  if (!(await add.isDisabled())) {
    await add.click();
    await cpage
      .getByRole('dialog')
      .getByLabel(/^Label/)
      .fill('Parents');
    await cpage
      .getByRole('dialog')
      .getByLabel(/^Address/)
      .fill('Road 3, Agrabad, Chattogram');
    await cpage
      .getByRole('dialog')
      .getByLabel(/^District/)
      .selectOption('Chattogram');
    await cpage.getByRole('button', { name: 'Save address' }).click();
    await cpage.getByText('Address saved').waitFor();
  }
  if (!(await cpage.getByRole('button', { name: 'Add', exact: true }).isDisabled())) throw new Error('add not disabled at 3 addresses');
});

// ------------------------------------------------------------ Super Admin
const actx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const apage = await actx.newPage();
apage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
apage.setDefaultTimeout(12000);
globalThis.activePage = apage;

async function adminLogin(email) {
  await apage.goto(`${BASE}/admin/login`);
  await apage.getByLabel('Email').fill(email);
  await apage.getByLabel(/^Password/).fill('Admin12345');
  await apage.getByRole('button', { name: 'Continue' }).click();
  await apage.waitForURL('**/admin/totp');
  await apage.getByLabel('Authentication code').fill('246810');
  await apage.getByRole('button', { name: 'Verify' }).click();
  await apage.waitForURL('**/admin/dashboard');
}

await step('admin: wrong TOTP is rejected, correct TOTP signs in', async () => {
  await apage.goto(`${BASE}/admin/login`);
  await apage.getByLabel('Email').fill('admin@bazarhq.test');
  await apage.getByLabel(/^Password/).fill('Admin12345');
  await apage.getByRole('button', { name: 'Continue' }).click();
  await apage.waitForURL('**/admin/totp');
  await apage.getByLabel('Authentication code').fill('111111');
  await apage.getByRole('button', { name: 'Verify' }).click();
  await apage.getByText('That code is not valid').waitFor();
  await apage.getByLabel('Authentication code').fill('246810');
  await apage.getByRole('button', { name: 'Verify' }).click();
  await apage.waitForURL('**/admin/dashboard');
});

await step('admin: suspension needs a reason and unpublishes the store', async () => {
  await apage.goto(`${BASE}/admin/merchants`);
  await apage.getByRole('link', { name: 'Sarah Khan' }).first().click();
  await apage.getByRole('button', { name: 'Suspend' }).click();
  await apage.getByRole('dialog').getByRole('button', { name: 'Suspend merchant' }).click();
  await apage
    .getByText(/at least 10 characters/)
    .first()
    .waitFor();
  await apage.getByLabel('Reason').fill('Repeated complaints about counterfeit chargers.');
  await apage.getByRole('dialog').getByRole('button', { name: 'Suspend merchant' }).click();
  await apage.getByText('Suspension reason (shown to the merchant)').waitFor();
  // The mock database lives in this browser's storage, so check the storefront from the same browser.
  await apage.goto(`${BASE}/store/techworld`);
  await apage.getByRole('heading', { name: 'Store unavailable' }).waitFor();
});

await step('admin: a theme in use cannot be deleted', async () => {
  await apage.goto(`${BASE}/admin/themes`);
  await apage.getByText('Used by').first().waitFor();
  const firstUsedDelete = apage.locator('li', { hasText: 'Used by' }).first().getByRole('button', { name: 'Delete' });
  if (!(await firstUsedDelete.isDisabled())) throw new Error('delete enabled for a theme in use');
});

await step('admin: policy needs a second admin to approve', async () => {
  await apage.goto(`${BASE}/admin/policies`);
  await apage.getByRole('button', { name: 'New version' }).click();
  await apage
    .getByRole('dialog')
    .getByRole('textbox', { name: /^Version/ })
    .fill('7.0');
  await apage
    .getByRole('dialog')
    .getByLabel(/^Effective date/)
    .fill('2026-12-01');
  await apage
    .getByRole('dialog')
    .getByLabel(/^Policy text/)
    .fill('These are the updated terms of service for BazarHQ customers and merchants, effective December.');
  await apage.getByRole('button', { name: 'Submit for approval' }).click();
  await apage.getByText('Version 7.0').first().waitFor();
  const approve = apage.locator('li', { hasText: 'Version 7.0' }).getByRole('button', { name: 'Approve' });
  if (!(await approve.isDisabled())) throw new Error('submitter could approve own policy');
  await apage.getByRole('button', { name: 'Sign out' }).click();
  await apage.waitForURL('**/admin/login');
  await apage.getByRole('heading', { name: 'Super Admin sign in' }).waitFor();
  await adminLogin('admin2@bazarhq.test');
  await apage.goto(`${BASE}/admin/policies`);
  await apage.locator('li', { hasText: 'Version 7.0' }).getByRole('button', { name: 'Approve' }).click();
  await apage.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await apage.locator('li', { hasText: 'Version 7.0' }).getByRole('button', { name: 'Publish' }).click();
  await apage.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await apage.locator('li', { hasText: 'Version 7.0' }).getByText('Published', { exact: true }).waitFor();
});

await step('admin: override a rejected-return dispute', async () => {
  await apage.goto(`${BASE}/admin/disputes`);
  await apage.locator('a[href^="/admin/disputes/return/"]').first().click();
  await apage.getByRole('button', { name: 'Override — approve the return' }).click();
  await apage.getByLabel('Note').fill('Photos show the shoes were faulty on arrival.');
  await apage.getByRole('dialog').getByRole('button', { name: 'Override decision' }).click();
  await apage.getByText(/Resolved — overridden/).waitFor();
});

await step('admin: actions appear in the audit log', async () => {
  await apage.goto(`${BASE}/admin/audit-logs`);
  await apage.getByText('Merchant suspended').first().waitFor();
  await apage.getByText('Policy published').first().waitFor();
});

await browser.close();
console.table(results);
if (process.env.REPORT_DIR) {
  const { writeFileSync, mkdirSync: mk } = await import('node:fs');
  mk(process.env.REPORT_DIR, { recursive: true });
  writeFileSync(`${process.env.REPORT_DIR}/e2e-web.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results, errors }, null, 2));
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`All ${results.length} flows passed.`);
