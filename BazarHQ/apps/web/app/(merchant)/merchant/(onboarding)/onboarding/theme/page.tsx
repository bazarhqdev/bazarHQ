'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@bazarhq/shared';
import {
  Alert,
  BrandColourPicker,
  Button,
  Card,
  CardHeader,
  ErrorState,
  ImageUploadField,
  Skeleton,
  Stepper,
  StorePreview,
  TextField,
  ThemePicker,
  useAsync,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function OnboardingThemePage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const { session, setSession } = useSession();
  const store = session?.store ?? null;
  const themes = useAsync(() => services.store.listThemes(), []);
  const [themeId, setThemeId] = useState<string | null>(store?.themeId ?? null);
  const [brandColour, setBrandColour] = useState(store?.brandColour ?? '#059669');
  const [tagline, setTagline] = useState(store?.tagline ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session && !store) router.replace(paths.onboardingStore);
  }, [session, store, router]);

  if (!store || !session) return null;
  const themeName = themes.data?.find((t) => t.id === themeId)?.name;

  const save = async () => {
    if (!themeId) return setError('Choose a theme to continue.');
    setBusy(true);
    setError(null);
    try {
      const updated = await services.store.updateStore({ themeId, brandColour, tagline });
      setSession({ ...session, store: updated });
      toast.success('Branding saved', 'Changes appear on your storefront within seconds.');
      router.push(paths.onboarding);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <title>Theme & branding · BazarHQ Merchant</title>
      <div className="mx-auto max-w-2xl">
        <Stepper steps={['Store details', 'Theme & branding', 'Go live']} current={1} />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Make {store.name} yours</h1>
            <p className="mt-1 text-sm text-ink-muted">Add your logo, pick a theme and choose your brand colour. You can change these any time.</p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <Card>
            <CardHeader title="Logo & banner" description="Without a logo, your store name is shown as text." />
            <div className="grid grid-cols-1 gap-5 px-5 pb-5 sm:grid-cols-2">
              <ImageUploadField
                label="Store logo"
                value={store.logoUrl}
                onUpload={async (f) => {
                  const s = await services.store.uploadLogo(f);
                  setSession({ ...session, store: s });
                  toast.success('Logo uploaded');
                }}
                onRemove={async () => {
                  const s = await services.store.removeLogo();
                  setSession({ ...session, store: s });
                }}
              />
              <ImageUploadField
                label="Store banner"
                aspect="banner"
                hint="Wide image, about 1200 × 400. Under 2 MB."
                value={store.extensions.bannerUrl}
                onUpload={async (f) => {
                  const s = await services.store.uploadBanner(f);
                  setSession({ ...session, store: s });
                  toast.success('Banner uploaded');
                }}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Choose a theme" description="Themes are curated by BazarHQ. Switching applies instantly without downtime." />
            <div className="px-5 pb-5">
              {themes.loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
                  ))}
                </div>
              ) : themes.error ? (
                <ErrorState message={themes.error} onRetry={themes.reload} />
              ) : (
                <ThemePicker themes={themes.data ?? []} value={themeId} onChange={setThemeId} />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Brand" />
            <div className="space-y-5 px-5 pb-5">
              <BrandColourPicker value={brandColour} onChange={setBrandColour} />
              <TextField label="Tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} hint="Optional." />
            </div>
          </Card>
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => router.push(paths.onboarding)}>
              Skip for now
            </Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>
              Save & continue
            </Button>
          </div>
        </div>
        <div className="space-y-2 lg:sticky lg:top-6 lg:self-start">
          <p className="text-[12px] font-bold uppercase tracking-wider text-ink-subtle">Live preview</p>
          <StorePreview
            name={store.name}
            tagline={tagline || null}
            brandColour={brandColour}
            logoUrl={store.logoUrl}
            bannerUrl={store.extensions.bannerUrl}
            subdomain={store.subdomain}
            themeName={themeName}
          />
        </div>
      </div>
    </div>
  );
}
