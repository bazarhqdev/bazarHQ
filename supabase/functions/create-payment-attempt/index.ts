/**
 * create-payment-attempt — API-20/24/25 (FR-C-16/17, Payment Lifecycle Option B).
 *
 * kind = "wallet_reference": the customer submits the bKash/Nagad/Rocket
 *   transaction ID. It is untrusted: the payment only becomes
 *   pending_verification. The server then asks the provider; only a confirmed
 *   provider answer marks it paid (otherwise the merchant reviews it manually).
 * kind = "sslcommerz": creates (or reuses) a payment attempt and an SSLCommerz
 *   session, and returns the gateway URL. Only the signed, re-validated IPN
 *   (payment-webhook) can mark the payment paid.
 *
 * Auth: the order's customer, or a guest who proves the order phone number.
 * Duplicate attempts are blocked in the database (one open attempt per order,
 * unique provider references, idempotency keys).
 */
import { getActor } from '../_shared/auth.ts';
import { rateLimit, rpc, serviceClient } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { forbidden, HttpError } from '../_shared/errors.ts';
import { handler, logError } from '../_shared/http.ts';
import { initSession } from '../_shared/payments/sslcommerz.ts';
import { signSimulatorSession, storeCredentials, verifyPendingWallet } from '../_shared/payments/verify.ts';
import { paymentSnapshot } from '../_shared/snapshot.ts';
import { bdPhone, idempotencyKey, parse, uuid, z } from '../_shared/validation.ts';

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wallet_reference'),
    orderId: uuid,
    reference: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6,40}$/, { error: 'Enter the transaction ID exactly as shown in your wallet app.' }),
    phone: bdPhone.optional(),
    idempotencyKey,
  }),
  z.object({ kind: z.literal('sslcommerz'), orderId: uuid, phone: bdPhone.optional(), idempotencyKey }),
]);

interface PreparedSession {
  transaction_id: string;
  amount: number;
  currency: string;
  order_id: string;
  order_number: string;
  store_id: string;
  customer: { name: string; phone: string; email: string | null; address: string; district: string };
}

export const serve = handler({}, async ({ req, body, requestId }) => {
  const input = parse(schema, body);
  const actor = await getActor(req);
  if (actor && actor.role !== 'customer') throw forbidden('Only the customer who placed the order can pay for it.');
  if (!actor && !input.phone) throw new HttpError(422, 'VALIDATION', 'Enter the phone number used for this order.', { phone: 'Required for guest checkout.' });
  await rateLimit(`payment-attempt:${input.orderId}`, 10, 600);

  if (input.kind === 'wallet_reference') {
    await rpc(serviceClient(), 'submit_wallet_reference', {
      p_order_id: input.orderId,
      p_reference: input.reference,
      p_actor_id: actor?.id ?? null,
      p_phone: input.phone ?? null,
    });
    // Ask the provider now; if it cannot answer, the payment stays pending_verification.
    try {
      await verifyPendingWallet(input.orderId, actor?.id ?? null);
    } catch (e) {
      logError(requestId, 'verifyPendingWallet', e);
    }
    return await paymentSnapshot(input.orderId);
  }

  const prepared = await rpc<PreparedSession>(serviceClient(), 'prepare_sslcommerz_payment', {
    p_order_id: input.orderId,
    p_actor_id: actor?.id ?? null,
    p_phone: input.phone ?? null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (env.paymentProviderMode === 'simulator') {
    const sessionToken = await signSimulatorSession(prepared.transaction_id, prepared.order_id);
    return { redirectUrl: `${env.publicAppUrl}/payment/sslcommerz-sandbox?session=${encodeURIComponent(sessionToken)}`, sessionToken };
  }

  const creds = await storeCredentials(prepared.store_id, 'sslcommerz');
  if (!creds?.values?.storeId || !creds.values.storePassword) {
    throw new HttpError(409, 'CONFLICT', 'Card payment is not available for this store right now.', undefined, 'BQ005');
  }
  const base = env.functionsUrl;
  try {
    const session = await initSession({
      credentials: { storeId: creds.values.storeId, storePassword: creds.values.storePassword },
      environment: creds.environment,
      transactionId: prepared.transaction_id,
      orderId: prepared.order_id,
      orderNumber: prepared.order_number,
      amount: Number(prepared.amount),
      customer: prepared.customer,
      urls: {
        success: `${base}/payment-webhook?kind=return&result=success`,
        fail: `${base}/payment-webhook?kind=return&result=failed`,
        cancel: `${base}/payment-webhook?kind=return&result=cancelled`,
        ipn: `${base}/payment-webhook?kind=ipn`,
      },
    });
    return { redirectUrl: session.redirectUrl, sessionToken: session.sessionKey };
  } catch (e) {
    logError(requestId, 'sslcommerz.initSession', e);
    throw new HttpError(503, 'UNKNOWN', 'The card payment page is not reachable right now. Please try again in a moment.');
  }
});

if (import.meta.main) Deno.serve(serve);
