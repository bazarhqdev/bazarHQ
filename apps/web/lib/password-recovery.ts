/**
 * Interpret Supabase password-reset redirect formats without exposing tokens.
 * - Direct/custom template: ?token_hash=... or ?token=...
 * - PKCE: ?code=...
 * - Default Supabase email: #access_token=...&refresh_token=...&type=recovery
 * - Default email after supabase-js consumed the fragment: ?recovery=1
 *
 * The last marker is NOT authorization; the auth service also demands a fresh
 * PASSWORD_RECOVERY event bound to the same user/session.
 */
export function parsePasswordRecoveryUrl(search: string, hash: string): { credential: string | null; error: string | null } {
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  if (q.has('error') || h.has('error') || q.has('error_description') || h.has('error_description')) {
    return { credential: null, error: 'This recovery link was rejected or has expired. Request a new one.' };
  }
  const token = q.get('token_hash') || q.get('token');
  if (token) return { credential: token, error: null };
  const accessToken = h.get('access_token');
  const refreshToken = h.get('refresh_token');
  if (h.get('type') === 'recovery' && accessToken && refreshToken) {
    return { credential: `recovery:tokens:${h.toString()}`, error: null };
  }
  const code = q.get('code');
  if (code) return { credential: `recovery:code:${code}`, error: null };
  if (q.get('recovery') === '1' || q.get('type') === 'recovery') {
    return { credential: 'recovery:session', error: null };
  }
  return { credential: null, error: 'This link is missing its recovery token. Request a new reset email.' };
}
