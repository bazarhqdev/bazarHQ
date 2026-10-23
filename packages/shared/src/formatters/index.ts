/** Formatting helpers. Timezone is Asia/Dhaka (Bangladesh market). */

const TZ = 'Asia/Dhaka';

const moneyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** ৳ with South-Asian digit grouping, e.g. ৳8,45,230 */
export function formatBDT(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}৳${moneyFmt.format(Math.abs(amount))}`;
}

export function formatCompactBDT(amount: number): string {
  return `৳${compactFmt.format(amount)}`;
}

export function formatNumber(n: number): string {
  return moneyFmt.format(n);
}

export function formatPercent(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function formatChange(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatShortDate(isoOrDay: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(isoOrDay));
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diff < 86400 * 7) {
    const d = Math.floor(diff / 86400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return formatDate(iso);
}

/** YYYY-MM-DD in Asia/Dhaka. */
export function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mask all but the last 4 characters (FR-M-33). */
export function maskSecret(value: string): string {
  const tail = value.slice(-4);
  return `••••${tail}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** ORD-YYYYMMDD-BHQXXXXXX style identifiers (FR-C-19, FR-RET-04, FR-SUP-02). */
export function formatPublicId(prefix: 'ORD' | 'RET' | 'TKT', date: Date, sequence: number): string {
  const ymd = dayKey(date).replace(/-/g, '');
  return `${prefix}-${ymd}-BHQ${String(sequence).padStart(6, '0')}`;
}

/** Hyphen-friendly label for snake_case enums when no label map exists. */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** URL-safe slug: "Mango (Himsagar)" → "mango-himsagar". */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Storefront product URL segment (/store/<sub>/products/<slug>). The SRS defines
 * no products.slug column (see SCHEMA_GAPS), so the slug is derived from the
 * name; the resolver also accepts the product id for old links.
 */
export function productSlug(p: { name: string; id: string }): string {
  return slugify(p.name) || p.id;
}
