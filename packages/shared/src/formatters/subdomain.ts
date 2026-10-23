import { PLATFORM_DOMAIN, RESERVED_SUBDOMAINS } from '../constants';

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/** Derive a candidate subdomain from a store name (FR-M-06). */
export function slugifySubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

export function normalizeSubdomain(input: string): string {
  return input.trim().toLowerCase();
}

export type SubdomainSyntaxResult = { ok: true } | { ok: false; reason: 'invalid' | 'reserved'; message: string };

/** Lowercase DNS-label syntax + FR-M-08 reserved words. */
export function checkSubdomainSyntax(subdomain: string): SubdomainSyntaxResult {
  const s = normalizeSubdomain(subdomain);
  if (s.length < 3) {
    return { ok: false, reason: 'invalid', message: 'Use at least 3 characters.' };
  }
  if (s.length > 63) {
    return { ok: false, reason: 'invalid', message: 'Use 63 characters or fewer.' };
  }
  if (!LABEL_RE.test(s)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Use lowercase letters, numbers and hyphens only. It cannot start or end with a hyphen.',
    };
  }
  if (RESERVED_SUBDOMAINS.includes(s)) {
    return {
      ok: false,
      reason: 'reserved',
      message: `"${s}" is reserved by BazarHQ for platform use. Please choose another name.`,
    };
  }
  return { ok: true };
}

/** FR-M-07: suggestions by appending numeric suffixes. */
export function suggestSubdomains(base: string, isTaken: (s: string) => boolean, count = 3): string[] {
  const root = normalizeSubdomain(base).replace(/-+$/, '').slice(0, 58) || 'store';
  const out: string[] = [];
  for (let n = 1; out.length < count && n < 1000; n++) {
    const candidate = `${root}${n}`;
    if (!isTaken(candidate) && checkSubdomainSyntax(candidate).ok) out.push(candidate);
  }
  return out;
}

export function storefrontUrl(subdomain: string): string {
  return `https://${subdomain}.${PLATFORM_DOMAIN}`;
}
