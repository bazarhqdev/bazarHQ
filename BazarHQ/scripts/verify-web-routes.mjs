#!/usr/bin/env node
/**
 * Route verification for the web build — Customer, Merchant and Super Admin.
 *
 *   npm run build:web && ADMIN_IP_ALLOWLIST=127.0.0.1 npm run start:web   (one terminal)
 *   npm run verify:routes                                                 (another)
 *
 * Visits every public/customer route, signs in as the demo merchant and
 * visits every /merchant route, then signs in as the demo Super Admin
 * (password + TOTP) and visits every /admin route — each at a
 * desktop and a 360px phone width, and fails on: non-2xx responses, a missing
 * <h1>, uncaught page errors, console errors, or horizontal page overflow.
 * Screenshots go to ./verification/screenshots.
 *
 * Env: BASE_URL (default http://localhost:3000), CHROMIUM_PATH (optional).
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.SCREENSHOT_DIR ?? 'verification/screenshots';
mkdirSync(OUT, { recursive: true });

const publicRoutes = ['/merchant/login', '/merchant/register', '/merchant/forgot-password', '/merchant/reset-password?token=demo'];
const portalRoutes = [
  '/merchant/dashboard',
  '/merchant/products',
  '/merchant/products/new',
  '/merchant/inventory',
  '/merchant/orders',
  '/merchant/returns',
  '/merchant/customers',
  '/merchant/analytics',
  '/merchant/payment-settings',
  '/merchant/store-settings',
  '/merchant/support',
  '/merchant/notifications',
  '/merchant/profile',
  '/merchant/onboarding',
  '/merchant/onboarding/store',
  '/merchant/onboarding/theme',
];

const customerPublic = [
  '/',
  '/stores?q=green',
  '/track',
  '/login',
  '/register',
  '/forgot-password',
  '/policies/tos',
  '/policies/privacy',
  '/cart',
  '/store/greenbasket',
  '/store/greenbasket/products',
  '/store/techworld/products?sort=price_asc',
  '/store/greenbasket/cart',
  '/store/kidsheaven',
];
const customerAccount = ['/customer', '/orders', '/customer/returns', '/customer/support', '/customer/support/new', '/customer/notifications', '/profile'];
const adminRoutes = [
  '/admin/dashboard',
  '/admin/system-health',
  '/admin/merchants',
  '/admin/customers',
  '/admin/stores',
  '/admin/orders',
  '/admin/themes',
  '/admin/announcements',
  '/admin/policies',
  '/admin/support',
  '/admin/disputes',
  '/admin/refunds',
  '/admin/audit-logs',
  '/admin/notifications',
  '/admin/profile',
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
const results = [];

async function check(page, route, label, errors) {
  const res = await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // mock latency
  const status = res?.status() ?? 0;
  const h1 = await page
    .locator('h1')
    .first()
    .textContent({ timeout: 4000 })
    .catch(() => null);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const name = `${label}-${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}.png`;
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
  const ok = status >= 200 && status < 400 && Boolean(h1) && overflow <= 1 && errors.length === 0;
  results.push({ route, viewport: label, status, h1: h1?.trim() ?? '—', overflow, errors: errors.length });
  if (!ok) failures.push({ route, label, status, h1, overflow, errors: [...errors] });
  errors.length = 0;
}

for (const [label, viewport] of [
  ['desktop', { width: 1366, height: 900 }],
  ['phone', { width: 360, height: 780 }],
]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  for (const r of publicRoutes) await check(page, r, label, errors);
  for (const r of customerPublic) await check(page, r, label, errors);
  // Product detail (dynamic)
  await page.goto(`${BASE}/store/greenbasket/products`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const prodHref = await page.locator('a[href^="/store/greenbasket/products/"]').first().getAttribute('href');
  if (prodHref) await check(page, prodHref, label, errors);

  // Customer account
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill('customer@bazarhq.test');
  await page.getByLabel(/^Password/).fill('Customer123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/customer', { timeout: 15000 });
  for (const r of customerAccount) await check(page, r, label, errors);
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const cOrder = await page.locator('main a[href^="/orders/"]').first().getAttribute('href');
  if (cOrder) await check(page, cOrder, label, errors);
  await page.goto(`${BASE}/customer/returns`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const cReturn = await page.locator('a[href^="/customer/returns/"]').first().getAttribute('href');
  if (cReturn) await check(page, cReturn, label, errors);
  await page.goto(`${BASE}/customer/support`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const cTicket = await page.locator('a[href^="/customer/support/"]:not([href$="/new"])').first().getAttribute('href');
  if (cTicket) await check(page, cTicket, label, errors);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForTimeout(500);

  // Sign in with the demo merchant.
  await page.goto(`${BASE}/merchant/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email address').fill('merchant@bazarhq.test');
  await page.getByLabel(/^Password/).fill('Merchant123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/merchant/dashboard', { timeout: 15000 });

  for (const r of portalRoutes) await check(page, r, label, errors);

  // Dynamic routes: first order and first product.
  await page.goto(`${BASE}/merchant/orders`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const orderHref = await page.locator('a[href^="/merchant/orders/"]').first().getAttribute('href');
  if (orderHref) await check(page, orderHref, label, errors);
  await page.goto(`${BASE}/merchant/products`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const productHref = await page.locator('a[href^="/merchant/products/"]:not([href$="/new"])').first().getAttribute('href');
  if (productHref) await check(page, productHref, label, errors);

  // Super Admin (approved network + password + TOTP)
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await check(page, '/admin/login', label, errors);
  await page.getByLabel('Email').fill('admin@bazarhq.test');
  await page.getByLabel(/^Password/).fill('Admin12345');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/admin/totp', { timeout: 15000 });
  await page.getByLabel('Authentication code').fill('246810');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  for (const r of adminRoutes) await check(page, r, label, errors);
  for (const [list, sel] of [
    ['/admin/merchants', 'a[href^="/admin/merchants/"]'],
    ['/admin/orders', 'a[href^="/admin/orders/"]'],
    ['/admin/support', 'a[href^="/admin/support/"]'],
    ['/admin/disputes', 'a[href^="/admin/disputes/return/"]'],
  ]) {
    await page.goto(BASE + list, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const href = await page
      .locator(sel)
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (href) await check(page, href, label, errors);
    else failures.push({ route: list, label, error: 'no detail link found' });
  }

  await context.close();
}

// Role-aware protection: unauthenticated → login; customer role → 403 screen.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/merchant/orders`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/merchant/login**', { timeout: 10000 }).catch(() => failures.push({ route: 'guard:unauthenticated', label: 'redirect to login' }));
  await page.getByLabel('Email address').fill('customer@bazarhq.test');
  await page.getByLabel(/^Password/).fill('Customer123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const denied = await page
    .getByText('403 — Access denied')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!denied) failures.push({ route: 'guard:customer-role', label: 'expected 403 screen' });
  await page.screenshot({ path: `${OUT}/guard-customer-403.png` });
  results.push({ route: 'guard: customer role', viewport: 'desktop', status: denied ? 'blocked' : 'NOT BLOCKED', h1: '403', overflow: 0, errors: 0 });
  await context.close();
}

// Super Admin guard: no session → admin login; a customer session is not an admin session.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/admin/merchants`, { waitUntil: 'networkidle' });
  const redirected = await page
    .waitForURL('**/admin/login**', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!redirected) failures.push({ route: 'guard:admin-unauthenticated', label: 'expected redirect to /admin/login' });
  results.push({ route: 'guard: admin (no session)', viewport: 'desktop', status: redirected ? 'blocked' : 'NOT BLOCKED', h1: '—', overflow: 0, errors: 0 });
  // Super Admins cannot use the customer/merchant sign-in.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill('admin@bazarhq.test');
  await page.getByLabel(/^Password/).fill('Admin12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const rejected = await page
    .getByText('Incorrect email or password')
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!rejected) failures.push({ route: 'guard:admin-via-public-login', label: 'expected rejection' });
  results.push({ route: 'guard: admin via public login', viewport: 'desktop', status: rejected ? 'blocked' : 'NOT BLOCKED', h1: '—', overflow: 0, errors: 0 });
  await context.close();
}

await browser.close();
console.table(results);
if (process.env.REPORT_DIR) {
  const { writeFileSync, mkdirSync: mk } = await import('node:fs');
  mk(process.env.REPORT_DIR, { recursive: true });
  writeFileSync(`${process.env.REPORT_DIR}/web-routes.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results, failures }, null, 2));
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`\nAll ${results.length} route checks passed.`);
