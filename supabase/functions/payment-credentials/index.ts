/**
 * payment-credentials — FR-M-33/34 (DB-05). The merchant sends wallet/gateway
 * credentials once; they are validated here, encrypted inside Postgres with a
 * Vault-held key (pgp_sym_encrypt, aes256) and never returned. Only a masked
 * projection (last 4 characters) comes back. Invalid credentials disable the
 * method (FR-M-34). Credentials are never logged.
 */
import { requireMerchant } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { handler } from '../_shared/http.ts';
import { parse, z } from '../_shared/validation.ts';

const s = (label: string, min = 3, max = 200) => z.string().trim().min(min, { error: `Enter the ${label}.` }).max(max, { error: `${label} is too long.` });
const wallet = z.string().trim().regex(/^01[3-9]\d{8}$/, { error: 'Enter the 11-digit merchant wallet number.' });

const schema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('bkash'),
    environment: z.enum(['sandbox', 'live']).default('sandbox'),
    values: z.object({ merchantNumber: wallet, appKey: s('app key'), appSecret: s('app secret'), username: s('username'), password: s('password') }),
  }),
  z.object({
    method: z.literal('nagad'),
    environment: z.enum(['sandbox', 'live']).default('sandbox'),
    values: z.object({ merchantId: s('merchant ID'), merchantNumber: wallet, publicKey: s('public key', 20, 4000), privateKey: s('private key', 20, 4000) }),
  }),
  z.object({
    method: z.literal('rocket'),
    environment: z.enum(['sandbox', 'live']).default('sandbox'),
    values: z.object({
      merchantNumber: z.string().trim().regex(/^01[3-9]\d{8,9}$/, { error: 'Enter the Rocket account number.' }),
      billerId: s('biller ID'),
      apiKey: s('API key'),
    }),
  }),
  z.object({
    method: z.literal('sslcommerz'),
    environment: z.enum(['sandbox', 'live']).default('sandbox'),
    values: z.object({ storeId: s('store ID'), storePassword: s('store password', 6) }),
  }),
]);

type Input = z.output<typeof schema>;

/** Live check where the provider offers one; otherwise "unverified" until the first real payment. */
async function check(input: Input): Promise<'valid' | 'invalid' | 'unverified'> {
  if (env.paymentProviderMode === 'simulator') return 'valid';
  if (input.method === 'bkash') {
    const base = input.environment === 'live' ? 'https://tokenized.pay.bka.sh/v1.2.0-beta' : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
    try {
      const res = await fetch(`${base}/tokenized/checkout/token/grant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', username: input.values.username, password: input.values.password },
        body: JSON.stringify({ app_key: input.values.appKey, app_secret: input.values.appSecret }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { id_token?: string };
      return res.ok && data.id_token ? 'valid' : 'invalid';
    } catch {
      return 'unverified';
    }
  }
  return 'unverified';
}

export const serve = handler({ maxBytes: 16 * 1024 }, async ({ req, body }) => {
  const input = parse(schema, body);
  const actor = await requireMerchant(req);
  await rateLimit(`credentials:${actor.id}`, 10, 3600);
  const validation = await check(input);
  const hintSource = input.method === 'sslcommerz'
    ? input.values.storeId
    : input.method === 'nagad'
    ? input.values.merchantNumber
    : input.values.merchantNumber;
  return await rpc(serviceClient(), 'store_payment_credentials', {
    p_actor_id: actor.id,
    p_method: input.method,
    p_credentials: input.values,
    p_hint: hintSource.slice(-4),
    p_environment: input.environment,
    p_validation_status: validation,
  });
});

if (import.meta.main) Deno.serve(serve);
