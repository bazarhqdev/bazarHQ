/**
 * admin-health — FR-SA-06 platform health. Probes the database, Auth, Storage
 * and the push configuration from inside the platform and reports latency.
 * Super Admin only. No secrets or connection strings are returned.
 */
import { requireSuperAdmin } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { handler } from '../_shared/http.ts';

type Status = 'operational' | 'degraded' | 'outage';

async function probe(fn: () => Promise<boolean>): Promise<{ status: Status; responseMs: number }> {
  const started = performance.now();
  try {
    const ok = await fn();
    const ms = Math.round(performance.now() - started);
    return { status: ok ? (ms > 1500 ? 'degraded' : 'operational') : 'outage', responseMs: ms };
  } catch {
    return { status: 'outage', responseMs: Math.round(performance.now() - started) };
  }
}

export const serve = handler({ methods: ['POST', 'GET'], body: 'none' }, async ({ req }) => {
  await requireSuperAdmin(req);
  const db = serviceClient();
  const now = new Date().toISOString();
  const [database, auth, storage] = await Promise.all([
    probe(async () => !(await db.from('themes').select('id', { head: true, count: 'exact' })).error),
    probe(async () => (await fetch(`${env.supabaseUrl}/auth/v1/health`, { headers: { apikey: env.anonKey }, signal: AbortSignal.timeout(5000) })).ok),
    probe(async () => !(await db.storage.listBuckets()).error),
  ]);
  const components = [
    { key: 'database', name: 'Database', ...database },
    { key: 'auth', name: 'Authentication', ...auth },
    { key: 'storage', name: 'Storage', ...storage },
    { key: 'edge_functions', name: 'Edge Functions', status: 'operational' as Status, responseMs: 0 },
    {
      key: 'push',
      name: 'Push notifications',
      status: (env.fcm ? 'operational' : 'degraded') as Status,
      responseMs: 0,
      note: env.fcm ? null : 'FCM credentials are not configured',
    },
  ].map((c) => ({ errorRatePct: c.status === 'outage' ? 100 : 0, lastCheckedAt: now, note: null, ...c }));
  const overall: Status = components.some((c) => c.status === 'outage')
    ? 'outage'
    : components.some((c) => c.status === 'degraded')
    ? 'degraded'
    : 'operational';
  return { overall, components, recentLogs: [] };
});

if (import.meta.main) Deno.serve(serve);
