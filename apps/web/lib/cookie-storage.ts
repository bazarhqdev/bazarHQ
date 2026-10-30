'use client';

/**
 * Supabase auth storage for the web app, kept in first-party cookies.
 *
 * supabase-js keeps the session in localStorage by default, which the edge
 * middleware cannot see. Storing it in `sb-<ref>-auth-token` cookies (the same
 * chunked, `base64-` prefixed format @supabase/ssr uses) lets middleware.ts
 * route by the session's role before a protected page renders.
 *
 * The middleware only routes; it never authorises. Every data call is still
 * checked by RLS and the Edge Functions with the verified JWT.
 */
const CHUNK = 3000;
const MAX_AGE = 60 * 60 * 24 * 400; // browsers cap cookie lifetime at 400 days

function readAll(): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof document === 'undefined') return out;
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    try {
      out.set(name, decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      /* ignore malformed cookies */
    }
  }
  return out;
}

function write(name: string, value: string, maxAge: number) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function chunkNames(all: Map<string, string>, key: string): string[] {
  return [...all.keys()].filter((n) => n === key || (n.startsWith(`${key}.`) && /^\d+$/.test(n.slice(key.length + 1))));
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const cookieAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const all = readAll();
    const names = chunkNames(all, key).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
    if (!names.length) return null;
    const raw = names.map((n) => all.get(n) ?? '').join('');
    try {
      return raw.startsWith('base64-') ? fromBase64(raw.slice(7)) : raw;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const all = readAll();
    const encoded = `base64-${toBase64(value)}`;
    const parts: string[] = [];
    for (let i = 0; i < encoded.length; i += CHUNK) parts.push(encoded.slice(i, i + CHUNK));
    for (const old of chunkNames(all, key)) write(old, '', 0);
    if (parts.length === 1) write(key, parts[0]!, MAX_AGE);
    else parts.forEach((p, i) => write(`${key}.${i}`, p, MAX_AGE));
  },
  async removeItem(key: string): Promise<void> {
    for (const name of chunkNames(readAll(), key)) write(name, '', 0);
  },
};
