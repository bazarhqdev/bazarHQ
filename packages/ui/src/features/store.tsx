'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Globe, ImagePlus, LoaderCircle, Search, ShoppingCart, Trash2, XCircle } from 'lucide-react';
import {
  BRAND_COLOUR_PRESETS,
  checkSubdomainSyntax,
  errorMessage,
  LIMITS,
  type OnboardingProgress,
  type SubdomainCheck,
  type Theme,
  type UploadFile,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { useDebounced, useNavigation, useServices } from '../context';
import { readImageFile } from '../files';
import { useNative } from '../native';
import { Button, FieldShell, ProgressBar } from '../components';

/* -------------------------- Subdomain field --------------------------- */

export function SubdomainField({
  value,
  onChange,
  onResult,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onResult?: (r: SubdomainCheck | null) => void;
  error?: string;
}) {
  const services = useServices();
  const debounced = useDebounced(value.trim().toLowerCase(), 350);
  const [remote, setRemote] = useState<SubdomainCheck | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  // Empty or syntactically invalid input is answered locally, without a request.
  const local = useMemo<SubdomainCheck | null | undefined>(() => {
    if (!debounced) return null;
    const syntax = checkSubdomainSyntax(debounced);
    if (!syntax.ok && syntax.reason === 'invalid') {
      return { subdomain: debounced, available: false, reason: 'invalid', message: syntax.message, suggestions: [] };
    }
    return undefined;
  }, [debounced]);

  useEffect(() => {
    if (local !== undefined) return;
    let alive = true;
    services.store
      .checkSubdomain(debounced)
      .then((r) => alive && setRemote(r))
      .catch((e) => alive && setRemote({ subdomain: debounced, available: false, reason: 'invalid', message: errorMessage(e), suggestions: [] }));
    return () => {
      alive = false;
    };
  }, [debounced, local, services]);

  const result = local !== undefined ? local : remote?.subdomain === debounced ? remote : null;
  const checking = local === undefined && remote?.subdomain !== debounced;

  useEffect(() => {
    onResultRef.current?.(result);
  }, [result]);

  const stale = debounced !== value.trim().toLowerCase();
  const showResult = result && !stale && !checking;
  const statusId = 'subdomain-status';

  return (
    <FieldShell id="subdomain" label="Store address" required error={error}>
      <div
        className={cn(
          'flex h-10 items-stretch overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-brand-600/30',
          error || (showResult && !result.available) ? 'border-red-400' : showResult && result.available ? 'border-brand-600' : 'border-line-strong',
        )}
      >
        <span className="flex items-center pl-3 text-ink-subtle">
          <Globe className="size-4" aria-hidden />
        </span>
        <span className="flex items-center pl-2 text-[12px] text-ink-muted">/store/</span>
        <input
          id="subdomain"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, ''))}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-ink outline-none"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={statusId}
          aria-invalid={error || (showResult && !result.available) ? true : undefined}
          placeholder="yourstore"
          maxLength={63}
        />
      </div>
      <div id={statusId} aria-live="polite" className="min-h-5 text-[12.5px]">
        {(checking || stale) && value && (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Checking availability…
          </span>
        )}
        {showResult && (
          <span className={cn('inline-flex items-start gap-1.5 font-medium', result.available ? 'text-brand-700' : 'text-red-700')}>
            {result.available ? <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />}
            {result.message}
          </span>
        )}
        {showResult && result.suggestions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">Try:</span>
            {result.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                className="rounded-full border border-line-strong bg-white px-2.5 py-0.5 font-semibold text-navy-800 hover:border-brand-600 hover:text-brand-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </FieldShell>
  );
}

/* --------------------------- Image upload ----------------------------- */

export function ImageUploadField({
  label,
  hint,
  value,
  onUpload,
  onRemove,
  aspect = 'square',
}: {
  label: string;
  hint?: string;
  value: string | null;
  onUpload: (file: UploadFile) => Promise<void>;
  onRemove?: () => Promise<void>;
  aspect?: 'square' | 'banner';
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const id = `upload-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const native = useNative();
  const choose = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(undefined);
    // Oversized images are blocked before upload (FR-M-13/16).
    const { upload, error: err } = await readImageFile(file, aspect === 'banner' ? 1400 : 600);
    if (err || !upload) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      await onUpload(upload);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <FieldShell id={id} label={label} hint={hint ?? 'JPG, PNG or WebP, under 2 MB.'} error={error}>
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-canvas',
            aspect === 'banner' ? 'h-20 w-40' : 'size-20',
          )}
        >
          {value ? (
            <img src={value} alt={`${label} preview`} className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-ink-subtle" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id={id}
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => (native.pickImage ? void native.pickImage().then((f) => f && choose([f])) : ref.current?.click())}
          >
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && onRemove && (
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => void onRemove()} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept={LIMITS.imageMimeTypes.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void choose(e.target.files)}
        />
      </div>
    </FieldShell>
  );
}

/* ------------------------- Theme & colour ----------------------------- */

export function ThemePicker({ themes, value, onChange }: { themes: Theme[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Storefront theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {themes.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'group overflow-hidden rounded-xl border text-left transition-shadow',
              active ? 'border-brand-600 ring-2 ring-brand-600/30' : 'border-line hover:shadow-[var(--shadow-card)]',
            )}
          >
            <ThemeThumb accent={t.accent} name={t.name} />
            <div className="flex items-start justify-between gap-2 p-2.5">
              <div>
                <p className="text-sm font-bold text-ink">{t.name}</p>
                <p className="line-clamp-2 text-[12px] text-ink-muted">{t.description}</p>
              </div>
              {active ? (
                <CheckCircle2 className="size-5 shrink-0 text-brand-600" aria-hidden />
              ) : (
                <Circle className="size-5 shrink-0 text-line-strong" aria-hidden />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ThemeThumb({ accent, name }: { accent: string; name: string }) {
  const minimal = name === 'Minimal';
  return (
    <div className="aspect-[16/9] bg-canvas p-2" aria-hidden>
      <div className="flex h-full flex-col gap-1 rounded-md bg-white p-1.5 shadow-sm">
        <div className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: accent }} />
          <span className="h-1 w-8 rounded bg-slate-200" />
          <span className="ml-auto h-1 w-4 rounded bg-slate-200" />
        </div>
        <div className={cn('flex-1 rounded', minimal ? 'bg-slate-100' : '')} style={minimal ? undefined : { background: `${accent}22` }} />
        <div className="grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-2.5 rounded-sm bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function BrandColourPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink">Brand colour</legend>
      <div className="flex flex-wrap items-center gap-2.5">
        {BRAND_COLOUR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Use colour ${c}`}
            aria-pressed={value.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)}
            className={cn('size-9 rounded-full ring-offset-2 transition', value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-navy-900' : 'hover:scale-105')}
            style={{ background: c }}
          />
        ))}
        <label className="relative inline-flex items-center gap-2 rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] font-semibold text-ink-muted">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Custom brand colour"
          />
          {value.toUpperCase()}
        </label>
      </div>
    </fieldset>
  );
}

/* ---------------------------- Store preview --------------------------- */

export function StorePreview({
  name,
  tagline,
  brandColour,
  logoUrl,
  bannerUrl,
  subdomain,
  themeName,
}: {
  name: string;
  tagline: string | null;
  brandColour: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  subdomain: string;
  themeName?: string;
}) {
  return (
    <div className="min-w-0 w-full max-w-full overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-card)]" aria-label="Storefront preview">
      <div className="flex items-center gap-1.5 border-b border-line bg-canvas px-3 py-2">
        <span className="size-2 rounded-full bg-red-300" aria-hidden />
        <span className="size-2 rounded-full bg-amber-300" aria-hidden />
        <span className="size-2 rounded-full bg-brand-300" aria-hidden />
        <span className="ml-2 truncate rounded bg-white px-2 py-0.5 text-[11px] text-ink-muted">
          /store/{subdomain || 'yourstore'}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-8 rounded-lg object-cover" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: brandColour }} aria-hidden>
            {(name || 'S').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{name || 'Your store'}</p>
          {tagline && <p className="truncate text-[11px] text-ink-muted">{tagline}</p>}
        </div>
        <Search className="ml-auto size-4 text-ink-subtle" aria-hidden />
        <ShoppingCart className="size-4 text-ink-subtle" aria-hidden />
      </div>
      <div
        className="relative mx-3 h-24 overflow-hidden rounded-lg"
        style={{ background: bannerUrl ? undefined : `linear-gradient(120deg, ${brandColour}, ${brandColour}cc)` }}
      >
        {bannerUrl && (
          <>
            <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/60 to-slate-950/20" aria-hidden />
          </>
        )}
        <div className="relative flex h-full flex-col items-start justify-center px-3 text-white">
          <p className="max-w-full truncate text-sm font-bold leading-tight">{name || 'Your store'}</p>
          <span className="mt-2 inline-block rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold" style={{ color: brandColour }}>
            Shop now
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-line p-1.5">
            <div className="aspect-square rounded bg-slate-100" />
            <div className="mt-1 h-1.5 w-3/4 rounded bg-slate-200" />
            <div className="mt-1.5 h-4 rounded text-center text-[9px] font-semibold leading-4 text-white" style={{ background: brandColour }}>
              Add
            </div>
          </div>
        ))}
      </div>
      {themeName && <p className="border-t border-line px-3 py-1.5 text-[11px] text-ink-subtle">Theme: {themeName}</p>}
    </div>
  );
}

/* --------------------------- Checklist -------------------------------- */

export function OnboardingChecklist({ progress, action }: { progress: OnboardingProgress; action?: ReactNode }) {
  const { Link, paths } = useNavigation();
  const target: Record<string, string> = {
    subdomain: paths.onboardingStore,
    logo: paths.onboardingTheme,
    payment_method: paths.paymentSettings,
    first_product: paths.productNew,
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{progress.percent}% complete</p>
        {action}
      </div>
      <ProgressBar value={progress.percent} label="Store setup progress" />
      <ul className="mt-4 space-y-1">
        {progress.steps.map((s) => (
          <li key={s.key}>
            <Link href={target[s.key] ?? paths.dashboard} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-canvas">
              {s.done ? <CheckCircle2 className="size-5 text-brand-600" aria-hidden /> : <Circle className="size-5 text-line-strong" aria-hidden />}
              <span className={cn(s.done ? 'text-ink-muted line-through decoration-ink-subtle/50' : 'font-semibold text-ink')}>{s.label}</span>
              <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
