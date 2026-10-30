/**
 * SSLCommerz hosted payment (FR-C-17, API-25/26).
 *
 *  - initSession(): server-to-server session creation; the browser is sent to
 *    the returned GatewayPageURL. tran_id is our payment_transactions.id.
 *  - verifyIpnSignature(): checks verify_sign over the fields listed in
 *    verify_key using md5(store_passwd), as documented by SSLCommerz.
 *  - validateWithGateway(): calls the order validation API with val_id. Only a
 *    VALID/VALIDATED answer whose tran_id, amount and currency match marks a
 *    payment paid. A browser redirect alone never does (brief: "A client
 *    redirect cannot set payment_status to paid").
 */
import { md5Hex } from '../encoding.ts';

export { md5Hex };

export interface SslcommerzCredentials {
  storeId: string;
  storePassword: string;
}

const BASE = {
  sandbox: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
} as const;

export interface SessionRequest {
  credentials: SslcommerzCredentials;
  environment: 'sandbox' | 'live';
  transactionId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  customer: { name: string; email: string | null; phone: string; address: string; district: string };
  urls: { success: string; fail: string; cancel: string; ipn: string };
  fetchImpl?: typeof fetch;
}

export async function initSession(req: SessionRequest): Promise<{ redirectUrl: string; sessionKey: string }> {
  const form = new URLSearchParams({
    store_id: req.credentials.storeId,
    store_passwd: req.credentials.storePassword,
    total_amount: req.amount.toFixed(2),
    currency: 'BDT',
    tran_id: req.transactionId,
    success_url: req.urls.success,
    fail_url: req.urls.fail,
    cancel_url: req.urls.cancel,
    ipn_url: req.urls.ipn,
    cus_name: req.customer.name.slice(0, 50),
    cus_email: req.customer.email ?? 'no-reply@bazarhq.com',
    cus_add1: req.customer.address.slice(0, 50),
    cus_city: req.customer.district,
    cus_country: 'Bangladesh',
    cus_phone: req.customer.phone,
    shipping_method: 'NO',
    product_name: `Order ${req.orderNumber}`,
    product_category: 'general',
    product_profile: 'general',
    value_a: req.orderId,
  });
  const res = await (req.fetchImpl ?? fetch)(`${BASE[req.environment]}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: string; GatewayPageURL?: string; sessionkey?: string };
  if (!res.ok || data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new Error('SSLCommerz session could not be created');
  }
  return { redirectUrl: data.GatewayPageURL, sessionKey: data.sessionkey ?? '' };
}

/** verify_sign = md5 of "k1=v1&k2=v2…" over verify_key fields plus store_passwd=md5(password), keys sorted. */
export function verifyIpnSignature(fields: Record<string, string>, storePassword: string): boolean {
  const verifySign = fields.verify_sign;
  const verifyKey = fields.verify_key;
  if (!verifySign || !verifyKey) return false;
  const keys = verifyKey.split(',').filter(Boolean);
  const data: Record<string, string> = {};
  for (const k of keys) data[k] = fields[k] ?? '';
  data.store_passwd = md5Hex(storePassword);
  const payload = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('&');
  const expected = md5Hex(payload);
  if (expected.length !== verifySign.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ verifySign.toLowerCase().charCodeAt(i);
  return diff === 0;
}

export interface GatewayValidation {
  valid: boolean;
  tranId: string | null;
  amount: number | null;
  currency: string | null;
  bankTranId: string | null;
}

export async function validateWithGateway(
  valId: string,
  credentials: SslcommerzCredentials,
  environment: 'sandbox' | 'live',
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayValidation> {
  const url = new URL(`${BASE[environment]}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', credentials.storeId);
  url.searchParams.set('store_passwd', credentials.storePassword);
  url.searchParams.set('v', '1');
  url.searchParams.set('format', 'json');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error('SSLCommerz validation API unavailable');
  const data = (await res.json()) as { status?: string; tran_id?: string; amount?: string; currency?: string; bank_tran_id?: string };
  return {
    valid: data.status === 'VALID' || data.status === 'VALIDATED',
    tranId: data.tran_id ?? null,
    amount: data.amount !== undefined ? Number(data.amount) : null,
    currency: data.currency ?? null,
    bankTranId: data.bank_tran_id ?? null,
  };
}
