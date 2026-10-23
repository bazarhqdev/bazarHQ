'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import {
  errorMessage,
  isServiceError,
  slugifySubdomain,
  STORE_CATEGORY_LABEL,
  storeBasicsSchema,
  toFieldErrors,
  type FieldErrors,
  type StoreCategory,
  type SubdomainCheck,
} from '@bazarhq/shared';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  SelectField,
  Stepper,
  StorePreview,
  SubdomainField,
  TextField,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function OnboardingStorePage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const { session, refresh } = useSession();
  const existing = session?.store ?? null;
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [subTouched, setSubTouched] = useState(false);
  const [category, setCategory] = useState<StoreCategory | ''>('');
  const [tagline, setTagline] = useState('');
  const [check, setCheck] = useState<SubdomainCheck | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (existing) {
    // FR-M-10: one store per merchant account.
    return (
      <div className="mx-auto max-w-xl">
        <Stepper steps={['Store details', 'Theme & branding', 'Go live']} current={1} />
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-ink">You already have a store</h1>
        <Alert tone="info" className="mt-4">
          Each merchant account can own one store in this version of BazarHQ. Your store <strong>{existing.name}</strong> is at {existing.subdomain}
          .bazarhq.com. You can change its details in Store settings.
        </Alert>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={paths.onboardingTheme} className={buttonClass('primary', 'md')}>
            Continue to theme & branding
          </Link>
          <Link href={paths.storeSettings} className={buttonClass('secondary', 'md')}>
            Open store settings
          </Link>
        </div>
      </div>
    );
  }

  const onName = (v: string) => {
    setName(v);
    if (!subTouched) setSubdomain(slugifySubdomain(v));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = storeBasicsSchema.safeParse({ name, subdomain, category, tagline });
    const fe = v.success ? {} : toFieldErrors(v.error);
    if (check && !check.available && check.subdomain === subdomain) fe.subdomain = check.message;
    if (Object.keys(fe).length) return setErrors(fe);
    setBusy(true);
    try {
      await services.store.createStore({ name, subdomain, category: category as StoreCategory, tagline });
      await refresh();
      toast.success('Store created as a draft', 'Next, choose how it looks.');
      router.push(paths.onboardingTheme);
    } catch (err) {
      if (isServiceError(err) && err.fieldErrors) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <title>Store details · BazarHQ Merchant</title>
      <div className="mx-auto max-w-2xl">
        <Stepper steps={['Store details', 'Theme & branding', 'Go live']} current={0} />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5 sm:p-6">
          <h1 className="text-xl font-bold text-ink">Tell us about your store</h1>
          <p className="mt-1 text-sm text-ink-muted">You can change the name, tagline and category later. The store address is permanent once published.</p>
          <form onSubmit={submit} noValidate className="mt-6 space-y-5">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextField
              label="Store name"
              required
              value={name}
              onChange={(e) => onName(e.target.value)}
              error={errors.name}
              placeholder="e.g. Green Basket"
              maxLength={60}
              hint="Shown to customers on your storefront."
            />
            <SubdomainField
              value={subdomain}
              onChange={(v) => {
                setSubTouched(true);
                setSubdomain(v);
                setErrors((e) => ({ ...e, subdomain: '' }));
              }}
              onResult={setCheck}
              error={errors.subdomain || undefined}
            />
            <p className="-mt-3 flex items-start gap-1.5 text-[12.5px] text-ink-subtle">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Lowercase letters, numbers and hyphens. Words like admin, api, www, app, mail, help, support and static are reserved.
            </p>
            <SelectField
              label="Store category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value as StoreCategory)}
              error={errors.category}
              placeholder="Choose a category"
              options={Object.entries(STORE_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <TextField
              label="Tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              error={errors.tagline}
              placeholder="e.g. Fresh Food • Healthy Life"
              maxLength={120}
              hint="Optional. A short line under your store name."
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={Boolean(check && !check.available && check.subdomain === subdomain)}>
                Create store & continue
              </Button>
            </div>
          </form>
        </Card>
        <div className="space-y-2 lg:sticky lg:top-6 lg:self-start">
          <p className="text-[12px] font-bold uppercase tracking-wider text-ink-subtle">Live preview</p>
          <StorePreview name={name} tagline={tagline || null} brandColour="#059669" logoUrl={null} bannerUrl={null} subdomain={subdomain} />
        </div>
      </div>
    </div>
  );
}
