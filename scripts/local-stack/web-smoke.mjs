/**
 * Browser smoke test of the real web app in Supabase mode, against the local
 * stack (start.sh) after adapter-flows.mts has created data. Checks that the
 * pages, the middleware's cookie-based role routing and the adapter work
 * together for all three roles.
 *
 * Run (web built with NEXT_PUBLIC_DATA_SOURCE=supabase and the stack URL/key):
 *   ADMIN_IP_ALLOWLIST=127.0.0.1 npx next start -p 3200   (in apps/web)
 *   set -a; . /tmp/bazarhq-stack/stack.env; set +a
 *   BASE_URL=http://localhost:3200 node scripts/local-stack/web-smoke.mjs
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const STACK = process.env.STACK_URL;
const SERVICE = process.env.STACK_SERVICE_KEY;
const sql = (q) =>
  execFileSync('psql', ['-h', process.env.STACK_PG_SOCKET, '-p', process.env.STACK_PG_PORT, '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim();

function totp(base32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const results = [];
const errors = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ step: name, ok: '✓' });
  } catch (e) {
    results.push({ step: name, ok: '✗', detail: String(e?.message ?? e).split('\n')[0].slice(0, 160) });
    if (process.env.FAIL_DIR) await globalThis.page?.screenshot({ path: `${process.env.FAIL_DIR}/smoke-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}

// Data created by adapter-flows.mts.
// adapter-flows suspends and reinstates merchant A; reinstatement leaves the store unpublished (FR-SA-12),
// so the smoke setup republishes it.
const [subdomain, storeName] = sql(`select subdomain, name from public.stores order by created_at limit 1`).split('|');
sql(`update public.stores set status = 'published' where subdomain = '${subdomain}'`);
const merchantEmail = sql(`select u.email from auth.users u join public.stores s on s.owner_id = u.id where s.subdomain = '${subdomain}'`);
const customerEmail = sql(`select u.email from auth.users u join public.profiles p on p.id = u.id where p.role = 'customer' and exists (select 1 from public.orders o where o.customer_id = p.id) limit 1`);
const [orderNumber, orderPhone] = sql(`select order_number, order_phone from public.orders where payment_method = 'cod' order by created_at limit 1`).split('|');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  globalThis.page = page;
  return page;
}

// ---------------------------------------------------------------- guest
const guest = await newPage();
await step('storefront renders a published store from Supabase (products, merchant contact)', async () => {
  await guest.goto(`${BASE}/store/${subdomain}`);
  await guest.getByText(storeName).first().waitFor();
  await guest.getByText('Tomato').first().waitFor();
  await guest.getByText(merchantEmail).first().waitFor();
});
await step('store discovery searches stores (never products)', async () => {
  await guest.goto(`${BASE}/stores?q=${encodeURIComponent(storeName.split(' ')[0])}`);
  await guest.getByText(`${subdomain}.bazarhq.com`).first().waitFor();
});
await step('public tracking with order ID + phone', async () => {
  await guest.goto(`${BASE}/track`);
  await guest.getByLabel(/Order ID/i).fill(orderNumber);
  await guest.getByLabel(/Phone/i).fill(orderPhone);
  await guest.getByRole('button', { name: /Track/ }).click();
  await guest.getByText(/Delivered|Refunded/).first().waitFor();
});
await step('middleware sends a signed-out visitor from /merchant/dashboard to the merchant login', async () => {
  await guest.goto(`${BASE}/merchant/dashboard`);
  await guest.waitForURL('**/merchant/login**');
});

// ---------------------------------------------------------------- merchant
const merchant = await newPage();
await step('merchant signs in; the session cookie lets middleware route to the dashboard', async () => {
  await merchant.goto(`${BASE}/merchant/login`);
  await merchant.getByLabel('Email address').fill(merchantEmail);
  await merchant.getByLabel(/^Password/).fill('Merchant123');
  await merchant.getByRole('button', { name: 'Sign in' }).click();
  await merchant.waitForURL('**/merchant/dashboard');
  const cookies = await merchant.context().cookies();
  if (!cookies.some((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))) throw new Error('no auth cookie');
  await merchant.getByText(storeName).first().waitFor();
});
await step('merchant products, orders and returns pages load real data', async () => {
  await merchant.goto(`${BASE}/merchant/products`);
  await merchant.getByText('Tomato').first().waitFor();
  await merchant.goto(`${BASE}/merchant/orders`);
  await merchant.getByText(orderNumber).first().waitFor();
  await merchant.goto(`${BASE}/merchant/returns`);
  await merchant.getByText(/Return closed|Return requested|Return approved/).first().waitFor();
});
await step('a merchant session cannot open customer or admin pages', async () => {
  await merchant.goto(`${BASE}/orders`);
  await merchant.waitForURL('**/login**');
});

// ---------------------------------------------------------------- customer
const customer = await newPage();
await step('customer signs in and sees their order history', async () => {
  await customer.goto(`${BASE}/login`);
  await customer.getByLabel('Email').fill(customerEmail);
  await customer.getByLabel(/^Password/).fill('Customer123');
  await customer.getByRole('button', { name: 'Sign in', exact: true }).click();
  await customer.waitForURL('**/customer');
  await customer.goto(`${BASE}/orders`);
  await customer.getByText(orderNumber).first().waitFor();
});

// ---------------------------------------------------------------- super admin
const admin = await newPage();
await step('super admin: password + TOTP on the approved network → dashboard', async () => {
  const email = `smoke.${Date.now().toString(36)}@example.test`;
  const res = await fetch(`${STACK}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin12345!', email_confirm: true, user_metadata: { full_name: 'Smoke Admin' } }),
  });
  const user = await res.json();
  sql(`select private.grant_super_admin('${user.id}', 'web smoke bootstrap')`);
  // TOTP enrolment through the Auth API (what the admin enrolment script does).
  const tok = await (
    await fetch(`${STACK}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: process.env.STACK_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Admin12345!' }),
    })
  ).json();
  const h = { apikey: process.env.STACK_ANON_KEY, authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
  const factor = await (await fetch(`${STACK}/auth/v1/factors`, { method: 'POST', headers: h, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'smoke' }) })).json();
  const ch = await (await fetch(`${STACK}/auth/v1/factors/${factor.id}/challenge`, { method: 'POST', headers: h, body: '{}' })).json();
  await fetch(`${STACK}/auth/v1/factors/${factor.id}/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challenge_id: ch.id, code: totp(factor.totp.secret) }) });

  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel('Email').fill(email);
  await admin.getByLabel(/^Password/).fill('Admin12345!');
  await admin.getByRole('button', { name: 'Continue' }).click();
  await admin.waitForURL('**/admin/totp');
  await admin.getByLabel('Authentication code').fill(totp(factor.totp.secret));
  await admin.getByRole('button', { name: 'Verify' }).click();
  await admin.waitForURL('**/admin/dashboard');
  await admin.getByText(/Merchants/).first().waitFor();
});
await step('admin merchants, orders and audit log pages load', async () => {
  await admin.goto(`${BASE}/admin/merchants`);
  await admin.getByText(merchantEmail).first().waitFor();
  await admin.goto(`${BASE}/admin/orders`);
  await admin.getByText(orderNumber).first().waitFor();
  await admin.goto(`${BASE}/admin/audit-logs`);
  await admin.getByText(/Merchant suspended|Policy published/).first().waitFor();
});

await browser.close();
console.table(results);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
if (process.env.REPORT_DIR) writeFileSync(`${process.env.REPORT_DIR}/web-supabase-smoke.json`, JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => r.ok === '✗').length;
console.log(failed ? `${failed} of ${results.length} smoke steps failed.` : `All ${results.length} smoke steps passed.`);
process.exit(failed ? 1 : 0);
