/**
 * Server-side payment verification shared by create-payment-attempt,
 * verify-payment and payment-webhook. Payment state only changes through
 * apply_payment_result (migration 003/004/007), which is monotonic, idempotent,
 * amount-checked and audited.
 */
import { decodeBase64UrlToString, encodeBase64Url } from '../encoding.ts';
import { rpc, serviceClient } from '../db.ts';
import { env } from '../env.ts';
import { type VerificationOutcome, verifyWalletReference, type WalletMethod } from './wallets.ts';

interface OrderRow {
  id: string;
  store_id: string;
  payment_method: string;
  payment_status: string;
  total_amount: number;
}

interface AttemptRow {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  provider_transaction_reference: string | null;
}

export async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const { data } = await serviceClient()
    .from('orders')
    .select('id, store_id, payment_method, payment_status, total_amount')
    .eq('id', orderId)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

export async function storeCredentials(
  storeId: string,
  method: string,
): Promise<{ environment: 'sandbox' | 'live'; values: Record<string, string> } | null> {
  return await rpc(serviceClient(), 'get_payment_credentials', { p_store_id: storeId, p_method: method });
}

/**
 * Re-checks the newest pending_verification wallet attempt of an order with the
 * provider and records a definitive answer. Returns the provider outcome, or
 * null when nothing is awaiting verification.
 */
export async function verifyPendingWallet(orderId: string, actorId: string | null): Promise<VerificationOutcome | null> {
  const order = await loadOrder(orderId);
  if (!order || !['bkash', 'nagad', 'rocket'].includes(order.payment_method)) return null;
  // Trusted reader (migration 014): service_role has no direct access to payment_transactions.
  const attempt = await rpc<AttemptRow | null>(serviceClient(), 'pending_verification_attempt', { p_order_id: orderId });
  if (!attempt?.provider_transaction_reference) return null;

  const creds = await storeCredentials(order.store_id, order.payment_method);
  const outcome = await verifyWalletReference({
    method: order.payment_method as WalletMethod,
    reference: attempt.provider_transaction_reference,
    amount: Number(attempt.amount),
    credentials: creds?.values ?? null,
    environment: creds?.environment ?? 'sandbox',
    mode: env.paymentProviderMode,
  });
  if (outcome.result === 'paid') {
    await rpc(serviceClient(), 'apply_payment_result', {
      p_transaction_id: attempt.id,
      p_result: 'paid',
      p_source: 'provider_verification',
      p_provider_reference: outcome.providerReference,
      p_actor_id: actorId,
      p_reason: null,
      p_verified_amount: outcome.verifiedAmount,
    });
  } else if (outcome.result === 'failed') {
    await rpc(serviceClient(), 'apply_payment_result', {
      p_transaction_id: attempt.id,
      p_result: 'failed',
      p_source: 'provider_verification',
      p_provider_reference: outcome.providerReference,
      p_actor_id: actorId,
      p_reason: outcome.reason.slice(0, 200),
      p_verified_amount: null,
    });
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Simulator sessions (development only): HMAC-signed, short-lived.    */
/* ------------------------------------------------------------------ */

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.simulatorSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

export async function signSimulatorSession(transactionId: string, orderId: string): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ t: transactionId, o: orderId, exp: Date.now() + 30 * 60_000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function readSimulatorSession(token: string): Promise<{ transactionId: string; orderId: string } | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || (await hmac(payload)) !== sig) return null;
  try {
    const data = JSON.parse(decodeBase64UrlToString(payload)) as { t: string; o: string; exp: number };
    if (data.exp < Date.now()) return null;
    return { transactionId: data.t, orderId: data.o };
  } catch {
    return null;
  }
}
