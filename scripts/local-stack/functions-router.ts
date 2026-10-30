/**
 * Serves every Edge Function in supabase/functions from one Deno process, the
 * way `supabase functions serve` does: POST /<name>?... → that function's
 * handler with the original method, headers, query and body.
 * Local verification only (scripts/local-stack/start.sh).
 */
const NAMES = [
  'adjust-inventory',
  'admin-delete-merchant',
  'admin-governance',
  'admin-health',
  'admin-network-check',
  'admin-refund-intervention',
  'admin-resolve-dispute',
  'admin-suspend-store',
  'create-order',
  'create-payment-attempt',
  'create-support-ticket',
  'device-tokens',
  'escalate-support-ticket',
  'manage-return',
  'payment-credentials',
  'payment-webhook',
  'process-refund',
  'record-cod-collection',
  'request-return',
  'send-notification',
  'track-order',
  'update-order-status',
  'verify-payment',
];

type Serve = (req: Request) => Promise<Response>;
const handlers = new Map<string, Serve>();
for (const name of NAMES) {
  const mod = (await import(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url).href)) as { serve: Serve };
  handlers.set(name, mod.serve);
}

const port = Number(Deno.env.get('FN_PORT') ?? '54342');
Deno.serve({ port, hostname: '127.0.0.1', onListen: () => console.log(`functions on :${port} (${handlers.size})`) }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/__health') return new Response('ok');
  const name = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  const fn = handlers.get(name);
  if (!fn) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Function not found' } }), { status: 404 });
  return fn(req);
});
