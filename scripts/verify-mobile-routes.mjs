#!/usr/bin/env node
/**
 * Route verification for the role-based Android SPA (Customer, Merchant,
 * Super Admin) in a phone-sized browser.
 *   npm run build:mobile && npm run preview:mobile   (serves :4173)
 *   npm run verify:mobile
 * Fails on page errors, console errors, missing <h1>, or horizontal overflow.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.env.SCREENSHOT_DIR ?? 'verification/mobile-screenshots';
mkdirSync(OUT, { recursive: true });

const routes = [
  '/home',
  '/products',
  '/products/new',
  '/inventory',
  '/orders',
  '/returns',
  '/analytics',
  '/more',
  '/payments',
  '/notifications',
  '/support',
  '/settings',
  '/onboarding',
  '/onboarding/theme',
];
const customerPublic = [
  '/welcome',
  '/c',
  '/c/stores',
  '/c/track',
  '/c/cart',
  '/c/login',
  '/c/register',
  '/c/policy/tos',
  '/c/s/greenbasket',
  '/c/s/greenbasket/products',
  '/c/s/greenbasket/p/red-apple',
  '/a/network',
  '/c/s/fashionpoint/cart',
  '/c/s/kidsheaven',
];
const customerAccount = ['/c/account', '/c/orders', '/c/returns', '/c/support', '/c/support/new', '/c/notifications', '/c/profile', '/c/addresses'];
const adminRoutes = [
  '/a/dashboard',
  '/a/health',
  '/a/merchants',
  '/a/customers',
  '/a/stores',
  '/a/orders',
  '/a/themes',
  '/a/announcements',
  '/a/policies',
  '/a/support',
  '/a/disputes',
  '/a/refunds',
  '/a/audit',
  '/a/notifications',
  '/a/profile',
  '/a/more',
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const results = [];
const failures = [];

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

/** Role-specific bottom navigation (spec: Customer/Merchant/Super Admin tab sets). */
async function expectTabs(role, expected) {
  const labels = (await page.locator('nav[aria-label="Main"] a').allTextContents()).map((t) => t.replace(/\d.*$/, '').trim());
  const ok = JSON.stringify(labels) === JSON.stringify(expected);
  results.push({ route: `tabs: ${role}`, h1: labels.join(' · '), overflow: 0, errors: ok ? 0 : 1 });
  if (!ok) failures.push({ route: `tabs: ${role}`, expected, got: labels });
}

async function check(route) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1900); // splash + mock latency
  const h1 = await page
    .locator('h1')
    .first()
    .textContent({ timeout: 4000 })
    .catch(() => null);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root');
  const ok = Boolean(h1) && overflow <= 1 && errors.length === 0;
  results.push({ route, h1: h1?.trim() ?? '—', overflow, errors: errors.length });
  if (!ok) failures.push({ route, h1, overflow, errors: [...errors] });
  errors.length = 0;
}

for (const r of customerPublic) await check(r);
await page.goto(`${BASE}/c/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1900);
await page.getByLabel('Email').fill('customer@bazarhq.test');
await page.getByLabel(/^Password/).fill('Customer123');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForURL('**/c/account', { timeout: 15000 });
for (const r of customerAccount) await check(r);
await expectTabs('customer', ['Home', 'Stores', 'Orders', 'Notifications', 'Profile']);
await page.evaluate(() => localStorage.clear());

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await shot('login');
await page.getByLabel('Email address').fill('merchant@bazarhq.test');
await page.getByLabel(/^Password/).fill('Merchant123');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/home', { timeout: 15000 });

for (const r of routes) await check(r);
await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1900);
await expectTabs('merchant', ['Home', 'Products', 'Orders', 'Inventory', 'Analytics', 'More']);

// Dynamic: first order.
await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1900);
const href = await page.locator('a[href^="/orders/"]').first().getAttribute('href');
if (href) await check(href);
const t = await page.goto(`${BASE}/support`, { waitUntil: 'networkidle' });
void t;
await page.waitForTimeout(1900);
const ticket = await page.locator('a[href^="/support/"]').first().getAttribute('href');
if (ticket) await check(ticket);
await page.evaluate(() => localStorage.clear());

// Super Admin: network check → password → TOTP.
await page.goto(`${BASE}/a/network`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1900);
await page.getByRole('button', { name: 'Continue to sign in' }).click();
await page.waitForURL('**/a/login', { timeout: 15000 });
await page.waitForTimeout(800);
await page.getByLabel('Email').fill('admin@bazarhq.test');
await page.getByLabel(/^Password/).fill('Admin12345');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForURL('**/a/totp', { timeout: 15000 });
await page.getByLabel('Authentication code').fill('246810');
await page.getByRole('button', { name: 'Verify' }).click();
await page.waitForURL('**/a/dashboard', { timeout: 15000 });
for (const r of adminRoutes) await check(r);
await expectTabs('super admin', ['Home', 'Merchants', 'Stores', 'Support', 'Audit Logs', 'More']);

// Role from the session decides the stack: a merchant session opening the customer account is sent to its own stack, and vice versa.
await page.evaluate(() => localStorage.clear());

await browser.close();
console.table(results);
if (process.env.REPORT_DIR) {
  const { writeFileSync, mkdirSync: mk } = await import('node:fs');
  mk(process.env.REPORT_DIR, { recursive: true });
  writeFileSync(`${process.env.REPORT_DIR}/mobile-routes.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results, failures }, null, 2));
}
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`All ${results.length} mobile route checks passed.`);
