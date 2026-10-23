/** Client-generated idempotency key for order/payment/stock operations (§5.4). */
export function newIdempotencyKey(scope: string): string {
  let rand = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') rand = crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  if (!rand) rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${scope}:${rand}`;
}
