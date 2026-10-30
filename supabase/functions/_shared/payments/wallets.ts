/**
 * Mobile-wallet transaction verification (FR-C-16, Payment Lifecycle Option B).
 *
 * A customer-submitted transaction ID is untrusted: it only moves the payment
 * to pending_verification. This module asks the provider, server-side, using
 * the store's decrypted credentials (never sent to any client). Outcomes:
 *   - 'paid'        provider confirms a completed payment of the exact amount
 *   - 'failed'      provider answered definitively (unknown ID, wrong amount)
 *   - 'unavailable' no answer / no API → stays pending_verification for the
 *                   merchant's audited manual review (API-43)
 */
import type { PaymentProviderMode } from '../env.ts';

export type WalletMethod = 'bkash' | 'nagad' | 'rocket';
export type VerificationOutcome =
  | { result: 'paid'; verifiedAmount: number; providerReference: string }
  | { result: 'failed'; reason: string; providerReference: string }
  | { result: 'unavailable'; reason: string };

export interface VerifyInput {
  method: WalletMethod;
  reference: string;
  amount: number;
  credentials: Record<string, string> | null;
  environment: 'sandbox' | 'live';
  mode: PaymentProviderMode;
  fetchImpl?: typeof fetch;
}

/**
 * Development/test simulator (refused in production by env.ts):
 * references starting with FAIL are rejected, Rocket always needs manual review,
 * anything else is confirmed for the exact amount — the same rules as the
 * frontend mock, so both data sources behave alike.
 */
function simulate(input: VerifyInput): VerificationOutcome {
  if (input.reference.startsWith('FAIL')) {
    return { result: 'failed', reason: 'Simulator: provider rejected the transaction ID', providerReference: input.reference };
  }
  if (input.method === 'rocket') {
    return { result: 'unavailable', reason: 'Simulator: Rocket has no verification API; manual review required' };
  }
  return { result: 'paid', verifiedAmount: input.amount, providerReference: input.reference };
}

const BKASH_BASE = {
  sandbox: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
  live: 'https://tokenized.pay.bka.sh/v1.2.0-beta',
} as const;

/** bKash Tokenized Checkout: grant token, then searchTransaction(trxID). */
async function verifyBkash(input: VerifyInput): Promise<VerificationOutcome> {
  const c = input.credentials;
  if (!c?.appKey || !c.appSecret || !c.username || !c.password) {
    return { result: 'unavailable', reason: 'bKash credentials are incomplete' };
  }
  const f = input.fetchImpl ?? fetch;
  const base = BKASH_BASE[input.environment];
  try {
    const grant = await f(`${base}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', username: c.username, password: c.password },
      body: JSON.stringify({ app_key: c.appKey, app_secret: c.appSecret }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = (await grant.json().catch(() => ({}))) as { id_token?: string };
    if (!grant.ok || !token.id_token) return { result: 'unavailable', reason: 'bKash token grant failed' };

    const search = await f(`${base}/tokenized/checkout/general/searchTransaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: token.id_token, 'x-app-key': c.appKey },
      body: JSON.stringify({ trxID: input.reference }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!search.ok) return { result: 'unavailable', reason: `bKash search returned HTTP ${search.status}` };
    const tx = (await search.json()) as { statusCode?: string; transactionStatus?: string; amount?: string; currency?: string; trxID?: string };
    if (tx.statusCode && tx.statusCode !== '0000') {
      return { result: 'failed', reason: `bKash status ${tx.statusCode}`, providerReference: input.reference };
    }
    if (tx.transactionStatus !== 'Completed') {
      return { result: 'failed', reason: `bKash transaction is ${tx.transactionStatus ?? 'unknown'}`, providerReference: input.reference };
    }
    const paid = Number(tx.amount);
    if (!Number.isFinite(paid) || Math.abs(paid - input.amount) > 0.001 || (tx.currency && tx.currency !== 'BDT')) {
      return { result: 'failed', reason: 'bKash amount does not match the order total', providerReference: input.reference };
    }
    return { result: 'paid', verifiedAmount: input.amount, providerReference: tx.trxID ?? input.reference };
  } catch {
    return { result: 'unavailable', reason: 'bKash did not respond' };
  }
}

export async function verifyWalletReference(input: VerifyInput): Promise<VerificationOutcome> {
  if (input.mode === 'simulator') return simulate(input);
  switch (input.method) {
    case 'bkash':
      return await verifyBkash(input);
    // Nagad and Rocket expose no merchant API to look up a customer-entered
    // transaction ID, so these always go to the merchant's audited manual review.
    case 'nagad':
      return { result: 'unavailable', reason: 'Nagad references are verified by the merchant (manual review)' };
    case 'rocket':
      return { result: 'unavailable', reason: 'Rocket references are verified by the merchant (manual review)' };
  }
}
