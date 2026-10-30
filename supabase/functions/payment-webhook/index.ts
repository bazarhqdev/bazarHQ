/**
 * payment-webhook — API-26 SSLCommerz IPN and browser returns.
 *
 *   POST ?kind=ipn       server-to-server IPN. verify_sign is checked with the
 *                        store's password, then the transaction is re-validated
 *                        with SSLCommerz' validation API (tran_id, amount and
 *                        currency must match). Only then is it applied, through
 *                        apply_payment_result (idempotent, audited). Replays are
 *                        harmless: the payment state is monotonic.
 *   POST ?kind=return    the customer's browser coming back from the gateway.
 *                        Never changes payment state; it only redirects to the
 *                        order page, which shows the server-confirmed status.
 *   POST ?kind=simulator development only (PAYMENT_PROVIDER_MODE=simulator):
 *                        completes an HMAC-signed simulator session.
 *
 * No user JWT is involved (verify_jwt = false in config.toml); authenticity
 * comes from the gateway signature + validation API.
 */
import { rpc, serviceClient } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { forbidden, HttpError, notFound } from '../_shared/errors.ts';
import { handler, json, logError, redirect } from '../_shared/http.ts';
import { validateWithGateway, verifyIpnSignature } from '../_shared/payments/sslcommerz.ts';
import { readSimulatorSession, storeCredentials } from '../_shared/payments/verify.ts';
import { parse, z } from '../_shared/validation.ts';

interface AttemptContext {
  id: string;
  amount: number;
  status: string;
  order: { id: string; order_number: string; order_phone: string; payment_status: string; store: { id: string; subdomain: string } };
}

async function loadAttempt(transactionId: string): Promise<AttemptContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return null;
  // Trusted reader (migration 014): service_role has no direct access to payment_transactions.
  return await rpc<AttemptContext | null>(serviceClient(), 'sslcommerz_attempt_context', { p_transaction_id: transactionId });
}

/** Payment attempt states that can never change again (Option B). */
const FINAL = new Set(['paid', 'failed']);

async function applyResult(attempt: AttemptContext, result: 'paid' | 'failed', providerReference: string | null, reason: string | null) {
  return await rpc(serviceClient(), 'apply_payment_result', {
    p_transaction_id: attempt.id,
    p_result: result,
    p_source: 'sslcommerz_webhook',
    p_provider_reference: providerReference,
    p_actor_id: null,
    p_reason: reason,
    p_verified_amount: result === 'paid' ? Number(attempt.amount) : null,
  });
}

async function handleIpn(fields: Record<string, string>, requestId: string): Promise<Response> {
  const attempt = await loadAttempt(fields.tran_id ?? '');
  if (!attempt) throw notFound('Unknown transaction');
  const creds = await storeCredentials(attempt.order.store.id, 'sslcommerz');
  if (!creds?.values?.storeId || !creds.values.storePassword) throw forbidden('Store gateway is not configured');
  if (!verifyIpnSignature(fields, creds.values.storePassword)) {
    logError(requestId, 'ipn.signature', new Error('invalid verify_sign'));
    throw forbidden('Invalid signature');
  }
  // Terminal attempts never change again (Option B). Acknowledge replays and
  // late contradictory callbacks with 200 so the gateway stops retrying.
  if (FINAL.has(attempt.status)) return json({ received: true, status: 'ignored', current: attempt.status });

  const status = (fields.status ?? '').toUpperCase();
  if (status === 'VALID' || status === 'VALIDATED') {
    let check;
    try {
      check = await validateWithGateway(fields.val_id ?? '', { storeId: creds.values.storeId, storePassword: creds.values.storePassword }, creds.environment);
    } catch (e) {
      // Gateway unreachable: answer 5xx so SSLCommerz retries the IPN later.
      logError(requestId, 'ipn.validation', e);
      throw new HttpError(503, 'UNKNOWN', 'Validation service unavailable');
    }
    const amountMatches = check.amount !== null && Math.abs(check.amount - Number(attempt.amount)) < 0.001;
    if (check.valid && check.tranId === attempt.id && amountMatches && (check.currency ?? 'BDT') === 'BDT') {
      await applyResult(attempt, 'paid', check.bankTranId ?? fields.val_id ?? null, null);
      return json({ received: true, status: 'paid' });
    }
    await applyResult(attempt, 'failed', fields.val_id ?? null, 'Gateway validation did not confirm the payment');
    return json({ received: true, status: 'failed' });
  }
  if (['FAILED', 'CANCELLED', 'UNATTEMPTED', 'EXPIRED'].includes(status)) {
    await applyResult(attempt, 'failed', fields.val_id ?? null, `Gateway reported ${status.toLowerCase()}`);
    return json({ received: true, status: 'failed' });
  }
  return json({ received: true, status: 'ignored' });
}

async function handleReturn(fields: Record<string, string>, result: string): Promise<Response> {
  const attempt = await loadAttempt(fields.tran_id ?? '');
  if (!attempt) return redirect(`${env.publicAppUrl}/track`);
  const params = new URLSearchParams({ order: attempt.order.order_number, payment: ['success', 'failed', 'cancelled'].includes(result) ? result : 'unknown' });
  return redirect(`${env.publicAppUrl}/store/${attempt.order.store.subdomain}/order-success?${params}`);
}

const simulatorSchema = z.object({ sessionToken: z.string().min(20).max(2000), outcome: z.enum(['success', 'failed', 'cancelled']) });

async function handleSimulator(body: Record<string, unknown>): Promise<Response> {
  if (env.paymentProviderMode !== 'simulator') throw notFound();
  const input = parse(simulatorSchema, body);
  const session = await readSimulatorSession(input.sessionToken);
  if (!session) throw forbidden('This payment session has expired. Start the payment again.');
  const attempt = await loadAttempt(session.transactionId);
  if (!attempt || attempt.order.id !== session.orderId) throw notFound();
  if (FINAL.has(attempt.status)) {
    // Replay of a used session: report the current state, change nothing.
  } else if (input.outcome === 'cancelled') {
    // The customer closed the gateway page: nothing is recorded and they can try again (same as the mock).
  } else if (input.outcome === 'success') {
    await applyResult(attempt, 'paid', `SIM-${attempt.id.slice(0, 8).toUpperCase()}`, null);
  } else {
    await applyResult(attempt, 'failed', null, `Simulator: customer ${input.outcome}`);
  }
  const { data: order } = await serviceClient().from('orders').select('payment_status').eq('id', attempt.order.id).single();
  return json({
    orderNumber: attempt.order.order_number,
    subdomain: attempt.order.store.subdomain,
    phone: attempt.order.order_phone,
    paymentStatus: order?.payment_status ?? attempt.order.payment_status,
  });
}

export const serve = handler({ methods: ['POST', 'GET'], body: 'auto', maxBytes: 32 * 1024 }, async ({ url, body, requestId }) => {
  const kind = url.searchParams.get('kind');
  const fields = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]));
  if (kind === 'ipn') return await handleIpn(fields, requestId);
  if (kind === 'return') return await handleReturn(fields, url.searchParams.get('result') ?? '');
  if (kind === 'simulator') return await handleSimulator(body);
  throw notFound();
});

if (import.meta.main) Deno.serve(serve);
