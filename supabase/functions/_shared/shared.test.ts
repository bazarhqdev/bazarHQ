/**
 * Unit tests for the Edge Function security helpers.
 * Run: deno test --allow-env supabase/functions/_shared/
 * Vectors for MD5 and the SSLCommerz signature were computed independently
 * with Python's hashlib.
 */
import { assert, assertEquals, assertFalse } from './testing.ts';
import { bearerToken, clientIp, requireCronSecret } from './auth.ts';
import { decodeBase64UrlToString, encodeBase64Url, md5Hex } from './encoding.ts';
import { fromDbError, HttpError, isAuthoredMessage } from './errors.ts';
import { handler, json, redact } from './http.ts';
import { verifyIpnSignature } from './payments/sslcommerz.ts';
import { readSimulatorSession, signSimulatorSession } from './payments/verify.ts';
import { verifyWalletReference } from './payments/wallets.ts';
import { bdPhone, idempotencyKey, parse, z } from './validation.ts';

Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
Deno.env.set('ALLOWED_ORIGINS', 'https://app.bazarhq.test,https://localhost');

const jwt = (payload: Record<string, unknown>) =>
  `${encodeBase64Url(new TextEncoder().encode('{"alg":"HS256"}'))}.${encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}.sig`;

Deno.test('md5 matches RFC 1321 / hashlib vectors', () => {
  assertEquals(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assertEquals(md5Hex('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
  assertEquals(md5Hex('a'.repeat(1000)), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
});

Deno.test('base64url round-trips unicode', () => {
  const text = 'বাজার ✓ {"a":1}';
  assertEquals(decodeBase64UrlToString(encodeBase64Url(new TextEncoder().encode(text))), text);
});

const ipn = {
  tran_id: 'c0ffee00-0000-4000-8000-000000000001',
  val_id: '2610271234abc',
  amount: '1250.00',
  card_type: 'VISA-Dutch Bangla',
  store_amount: '1218.75',
  bank_tran_id: '2610271234bank',
  status: 'VALID',
  currency: 'BDT',
  verify_key: 'amount,bank_tran_id,card_type,currency,status,store_amount,tran_id,val_id',
  verify_sign: '0f0c9d2e7016b2185d991bbbe62c607a',
};

Deno.test('SSLCommerz IPN signature: valid signature accepted', () => {
  assert(verifyIpnSignature(ipn, 'bazar@ssl'));
});

Deno.test('SSLCommerz IPN signature: tampering is rejected', () => {
  assertFalse(verifyIpnSignature({ ...ipn, amount: '1.00' }, 'bazar@ssl'), 'changed amount');
  assertFalse(verifyIpnSignature({ ...ipn, status: 'VALIDATED' }, 'bazar@ssl'), 'changed status');
  assertFalse(verifyIpnSignature(ipn, 'wrong-password'), 'wrong store password');
  assertFalse(verifyIpnSignature({ ...ipn, verify_sign: '' }, 'bazar@ssl'), 'missing signature');
  assertFalse(verifyIpnSignature({ ...ipn, verify_key: 'status' }, 'bazar@ssl'), 'narrowed verify_key');
});

Deno.test('database errors: authored messages pass, system messages are replaced', () => {
  const stock = fromDbError({ code: 'BQ001', message: 'Only 2 of Red Apple left in stock' });
  assertEquals([stock.status, stock.code, stock.message, stock.reason], [409, 'CONFLICT', 'Only 2 of Red Apple left in stock', 'BQ001']);
  const leak = fromDbError({ code: '23505', message: 'duplicate key value violates unique constraint "orders_store_idem_key"' });
  assertEquals(leak.status, 409);
  assertFalse(leak.message.includes('orders_store_idem_key'));
  const perm = fromDbError({ code: '42501', message: 'permission denied for function create_order' });
  assertEquals(perm.status, 403);
  assertFalse(perm.message.includes('create_order'));
  const unknown = fromDbError({ code: 'XX000', message: 'internal: could not open file base/1/2' });
  assertEquals([unknown.status, unknown.code], [500, 'UNKNOWN']);
  assertFalse(isAuthoredMessage('relation "public.orders" does not exist'));
});

Deno.test('bearer token: anon/publishable keys and junk count as signed out', () => {
  const req = (auth?: string) => new Request('http://x', { headers: auth ? { authorization: auth } : {} });
  assertEquals(bearerToken(req()), null);
  assertEquals(bearerToken(req(`Bearer ${jwt({ role: 'anon' })}`)), null);
  assertEquals(bearerToken(req(`Bearer ${jwt({ role: 'service_role' })}`)), null);
  assertEquals(bearerToken(req('Bearer sb_publishable_abc123')), null);
  const user = jwt({ role: 'authenticated', sub: 'u1' });
  assertEquals(bearerToken(req(`Bearer ${user}`)), user);
});

Deno.test('client IP: first entry by default, malformed values ignored', () => {
  const req = (v: string) => new Request('http://x', { headers: { 'x-forwarded-for': v } });
  assertEquals(clientIp(req('203.0.113.9, 10.0.0.1')), '203.0.113.9');
  assertEquals(clientIp(req('2001:db8::1')), '2001:db8::1');
  assertEquals(clientIp(req('not-an-ip')), null);
  assertEquals(clientIp(req('999.1.1.1')), null);
});

Deno.test('cron secret: required, constant-time compared', () => {
  Deno.env.set('CRON_SECRET', 'c'.repeat(40));
  requireCronSecret(new Request('http://x', { headers: { 'x-cron-secret': 'c'.repeat(40) } }));
  let threw = 0;
  for (const given of ['', 'c'.repeat(39), 'd'.repeat(40)]) {
    try {
      requireCronSecret(new Request('http://x', { headers: { 'x-cron-secret': given } }));
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) threw++;
    }
  }
  assertEquals(threw, 3);
  Deno.env.set('CRON_SECRET', 'short');
  try {
    requireCronSecret(new Request('http://x', { headers: { 'x-cron-secret': 'short' } }));
    throw new Error('short secret accepted');
  } catch (e) {
    assert(e instanceof HttpError && e.status === 403);
  }
});

Deno.test('validation: phone normalisation, idempotency keys, field errors', () => {
  assertEquals(parse(bdPhone, '+880 1712-345678'), '01712345678');
  assertEquals(parse(bdPhone, '8801812345678'), '01812345678');
  try {
    parse(z.object({ phone: bdPhone, key: idempotencyKey }), { phone: '0123', key: 'short' });
    throw new Error('should fail');
  } catch (e) {
    assert(e instanceof HttpError);
    assertEquals(e.status, 422);
    assert(e.fieldErrors?.phone && e.fieldErrors?.key);
  }
});

Deno.test('payment simulator sessions are signed and expire', async () => {
  const token = await signSimulatorSession('tx-1', 'order-1');
  assertEquals(await readSimulatorSession(token), { transactionId: 'tx-1', orderId: 'order-1' });
  const [payload, sig] = token.split('.');
  const forged = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ t: 'tx-2', o: 'order-1', exp: Date.now() + 1e6 })));
  assertEquals(await readSimulatorSession(`${forged}.${sig}`), null);
  assertEquals(await readSimulatorSession(`${payload}.AAAA`), null);
});

Deno.test('simulator mode getter throws in production', async () => {
  const { env } = await import('./env.ts');
  Deno.env.set('PAYMENT_PROVIDER_MODE', 'simulator');
  Deno.env.set('APP_ENV', 'production');
  let threw = false;
  try {
    void env.paymentProviderMode;
  } catch {
    threw = true;
  }
  Deno.env.delete('APP_ENV');
  Deno.env.delete('PAYMENT_PROVIDER_MODE');
  assert(threw);
});

Deno.test('wallet verification: simulator rules and live fallbacks', async () => {
  const base = { amount: 500, credentials: null, environment: 'sandbox' as const };
  assertEquals((await verifyWalletReference({ ...base, method: 'bkash', reference: 'ABC12345', mode: 'simulator' })).result, 'paid');
  assertEquals((await verifyWalletReference({ ...base, method: 'nagad', reference: 'FAIL1234', mode: 'simulator' })).result, 'failed');
  assertEquals((await verifyWalletReference({ ...base, method: 'rocket', reference: 'ROCK1234', mode: 'simulator' })).result, 'unavailable');
  assertEquals((await verifyWalletReference({ ...base, method: 'nagad', reference: 'NAG12345', mode: 'live' })).result, 'unavailable');
  assertEquals((await verifyWalletReference({ ...base, method: 'bkash', reference: 'BK123456', mode: 'live' })).result, 'unavailable', 'no credentials');
});

Deno.test('bKash live verification: amount mismatch fails, completed exact amount pays', async () => {
  const creds = { appKey: 'k', appSecret: 's', username: 'u', password: 'p', merchantNumber: '01700000000' };
  const fake = (tx: Record<string, string>): typeof fetch => (input) => {
    const url = String(input);
    if (url.endsWith('/token/grant')) return Promise.resolve(new Response(JSON.stringify({ id_token: 'tok' })));
    return Promise.resolve(new Response(JSON.stringify(tx)));
  };
  const run = (tx: Record<string, string>) =>
    verifyWalletReference({ method: 'bkash', reference: 'TRX123', amount: 500, credentials: creds, environment: 'sandbox', mode: 'live', fetchImpl: fake(tx) });
  assertEquals((await run({ statusCode: '0000', transactionStatus: 'Completed', amount: '500.00', currency: 'BDT', trxID: 'TRX123' })).result, 'paid');
  assertEquals((await run({ statusCode: '0000', transactionStatus: 'Completed', amount: '50.00', currency: 'BDT' })).result, 'failed');
  assertEquals((await run({ statusCode: '2117' })).result, 'failed');
  assertEquals((await run({ statusCode: '0000', transactionStatus: 'Initiated', amount: '500.00' })).result, 'failed');
});

Deno.test('http handler: CORS allowlist, method, size and safe errors', async () => {
  const h = handler({ maxBytes: 100 }, ({ body }) => {
    if (body.boom) return Promise.reject(new Error('secret internal detail: password=hunter2'));
    if (body.bad) return Promise.reject(new HttpError(422, 'VALIDATION', 'Nope', { field: 'x' }));
    return Promise.resolve({ ok: true });
  });
  const post = (body: string, headers: Record<string, string> = {}) =>
    h(new Request('http://x', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } }));

  const allowed = await post('{}', { origin: 'https://app.bazarhq.test' });
  assertEquals(allowed.status, 200);
  assertEquals(allowed.headers.get('access-control-allow-origin'), 'https://app.bazarhq.test');
  const foreign = await post('{}', { origin: 'https://evil.example' });
  assertEquals(foreign.headers.get('access-control-allow-origin'), null);

  const preflight = await h(new Request('http://x', { method: 'OPTIONS', headers: { origin: 'https://localhost' } }));
  assertEquals(preflight.status, 204);
  assert(preflight.headers.get('access-control-allow-headers')?.includes('authorization'));

  assertEquals((await h(new Request('http://x', { method: 'GET' }))).status, 405);
  assertEquals((await post('x'.repeat(200))).status, 413);
  assertEquals((await post('not json')).status, 400);
  assertEquals((await post('[]')).status, 400);
  assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }))).status, 415);

  const boom = await post('{"boom":true}');
  assertEquals(boom.status, 500);
  const text = await boom.text();
  assertFalse(text.includes('hunter2'));
  assertEquals(JSON.parse(text).error.code, 'UNKNOWN');

  const bad = await post('{"bad":true}');
  assertEquals((await bad.json()).error, { code: 'VALIDATION', message: 'Nope', fieldErrors: { field: 'x' } });
  assertEquals(json({}).headers.get('cache-control'), 'no-store');
});

Deno.test('log redaction removes gateway passwords, JWTs and secrets', () => {
  const line = redact(
    'error sending request for url (https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=1&store_passwd=Sup3r) ' +
      'auth Bearer abc.def.ghi token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln password=hunter2 app_key: "k123"',
  );
  for (const secret of ['Sup3r', 'abc.def.ghi', 'eyJhbGciOiJIUzI1NiJ9', 'hunter2', 'k123']) {
    assertFalse(line.includes(secret), `leaked ${secret}`);
  }
  assert(line.includes('sandbox.sslcommerz.com/validator'));
});
