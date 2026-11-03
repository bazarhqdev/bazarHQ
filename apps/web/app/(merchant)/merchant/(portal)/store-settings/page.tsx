'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EyeOff, LogOut, Rocket, ShieldCheck } from 'lucide-react';
import {
  errorMessage,
  shippingSchema,
  STORE_CATEGORY_LABEL,
  storeProfileSchema,
  storefrontUrl,
  toFieldErrors,
  type FieldErrors,
  type NotificationPreferences,
  type Store,
  type StoreCategory,
} from '@bazarhq/shared';
import {
  Alert,
  BrandColourPicker,
  Button,
  buttonClass,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  ImageUploadField,
  OnboardingChecklist,
  PageHeader,
  SelectField,
  Skeleton,
  StorePreview,
  StoreStatusBadge,
  TextField,
  ThemePicker,
  useAsync,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

const sections = [
  ['profile', 'Store profile'],
  ['branding', 'Logo & branding'],
  ['shipping', 'Shipping'],
  ['notifications', 'Notifications'],
  ['visibility', 'Store visibility'],
  ['account', 'Account & security'],
] as const;

export default function StoreSettingsPage() {
  const { session, setSession, signOut } = useSession();
  const store = session?.store;
  if (!session || !store) return <Skeleton className="h-96" />;
  return <SettingsBody key={store.id} store={store} onStore={(s) => setSession({ ...session, store: s })} signOut={signOut} />;
}

function SettingsBody({ store, onStore, signOut }: { store: Store; onStore: (s: Store) => void; signOut: () => Promise<void> }) {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const themes = useAsync(() => services.store.listThemes(), []);
  const onboarding = useAsync(() => services.store.getOnboarding(), [store.status, store.logoUrl]);

  const [profile, setProfile] = useState({
    name: store.name,
    tagline: store.tagline ?? '',
    returnWindowDays: String(store.returnWindowDays),
    category: store.extensions.category ?? 'other',
  });
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});
  const [branding, setBranding] = useState({ themeId: store.themeId, brandColour: store.brandColour });
  const [shipping, setShipping] = useState({
    insideDhakaCharge: String(store.extensions.shipping.insideDhakaCharge),
    outsideDhakaCharge: String(store.extensions.shipping.outsideDhakaCharge),
    estimatedDaysInsideDhaka: String(store.extensions.shipping.estimatedDaysInsideDhaka),
    estimatedDaysOutsideDhaka: String(store.extensions.shipping.estimatedDaysOutsideDhaka),
  });
  const [shippingErrors, setShippingErrors] = useState<FieldErrors>({});
  const [prefs, setPrefs] = useState<NotificationPreferences>(store.extensions.notificationPreferences);
  const [busy, setBusy] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  async function run(key: string, fn: () => Promise<Store>, msg: string) {
    setBusy(key);
    try {
      const s = await fn();
      onStore(s);
      toast.success(msg);
      return true;
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const saveProfile = () => {
    const v = storeProfileSchema.safeParse({ name: profile.name, tagline: profile.tagline, returnWindowDays: Number(profile.returnWindowDays) });
    if (!v.success) return setProfileErrors(toFieldErrors(v.error));
    setProfileErrors({});
    void run(
      'profile',
      async () => {
        await services.store.updateStore({ name: v.data.name, tagline: v.data.tagline, returnWindowDays: v.data.returnWindowDays });
        return services.store.updateExtensions({ category: profile.category as StoreCategory });
      },
      'Store profile saved',
    );
  };

  const saveShipping = () => {
    const parsed = Object.fromEntries(Object.entries(shipping).map(([k, v]) => [k, v.trim() === '' ? Number.NaN : Number(v)]));
    const v = shippingSchema.safeParse(parsed);
    if (!v.success) return setShippingErrors(toFieldErrors(v.error));
    setShippingErrors({});
    void run('shipping', () => services.store.updateExtensions({ shipping: v.data }), 'Shipping settings saved');
  };

  const publish = async () => {
    setVisibilityError(null);
    setBusy('publish');
    try {
      const s = await services.store.publish();
      onStore(s);
      toast.success('Your store is live', storefrontUrl(s.subdomain));
    } catch (e) {
      setVisibilityError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const themeName = themes.data?.find((t) => t.id === branding.themeId)?.name;

  return (
    <>
      <title>Store settings · BazarHQ Merchant</title>
      <PageHeader title="Store settings" description={`Storefront: ${storefrontUrl(store.subdomain)}`} actions={<StoreStatusBadge status={store.status} />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-24 space-y-0.5">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-white hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          <Card aria-labelledby="profile-h">
            <div id="profile" className="scroll-mt-24" />
            <CardHeader id="profile-h" title="Store profile" />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
              <TextField
                label="Store name"
                required
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                error={profileErrors.name}
                maxLength={60}
              />
              <TextField
                label="Store address"
                value={storefrontUrl(store.subdomain)}
                disabled
                hint="This path-based URL works on your current BazarHQ host. A custom domain can be connected later."
              />
              <TextField
                label="Tagline"
                value={profile.tagline}
                onChange={(e) => setProfile((p) => ({ ...p, tagline: e.target.value }))}
                error={profileErrors.tagline}
                maxLength={120}
              />
              <SelectField
                label="Category"
                value={profile.category}
                onChange={(e) => setProfile((p) => ({ ...p, category: e.target.value as StoreCategory }))}
                options={Object.entries(STORE_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <TextField
                label="Return window (days)"
                type="number"
                min={1}
                inputMode="numeric"
                value={profile.returnWindowDays}
                onChange={(e) => setProfile((p) => ({ ...p, returnWindowDays: e.target.value }))}
                error={profileErrors.returnWindowDays}
                hint="Calendar days after delivery. Default is 7. One return request per order."
              />
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button variant="primary" loading={busy === 'profile'} onClick={saveProfile}>
                Save profile
              </Button>
            </div>
          </Card>

          <Card aria-labelledby="branding-h">
            <div id="branding" className="scroll-mt-24" />
            <CardHeader id="branding-h" title="Logo & branding" description="Theme and colour changes reach your live storefront within seconds." />
            <div className="grid grid-cols-1 gap-6 px-5 pb-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <ImageUploadField
                    label="Store logo"
                    value={store.logoUrl}
                    onUpload={async (f) => void (await run('logo', () => services.store.uploadLogo(f), 'Logo updated'))}
                    onRemove={async () => void (await run('logo', () => services.store.removeLogo(), 'Logo removed'))}
                  />
                  <ImageUploadField
                    label="Store banner"
                    aspect="banner"
                    hint="About 1200 × 400, under 2 MB."
                    value={store.extensions.bannerUrl}
                    onUpload={async (f) => void (await run('banner', () => services.store.uploadBanner(f), 'Banner updated'))}
                  />
                </div>
                {themes.data ? (
                  <ThemePicker themes={themes.data} value={branding.themeId} onChange={(id) => setBranding((b) => ({ ...b, themeId: id }))} />
                ) : (
                  <Skeleton className="h-48" />
                )}
                <BrandColourPicker value={branding.brandColour} onChange={(c) => setBranding((b) => ({ ...b, brandColour: c }))} />
              </div>
              <div className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-wider text-ink-subtle">Preview</p>
                <StorePreview
                  name={profile.name}
                  tagline={profile.tagline || null}
                  brandColour={branding.brandColour}
                  logoUrl={store.logoUrl}
                  bannerUrl={store.extensions.bannerUrl}
                  subdomain={store.subdomain}
                  themeName={themeName}
                />
              </div>
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button
                variant="primary"
                loading={busy === 'branding'}
                onClick={() =>
                  void run('branding', () => services.store.updateStore({ themeId: branding.themeId, brandColour: branding.brandColour }), 'Branding saved')
                }
              >
                Save branding
              </Button>
            </div>
          </Card>

          <Card aria-labelledby="shipping-h">
            <div id="shipping" className="scroll-mt-24" />
            <CardHeader
              id="shipping-h"
              title="Shipping"
              description="Delivery charges shown to customers at checkout. You deliver orders yourself or through your courier."
            />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
              <TextField
                label="Delivery charge — inside Dhaka"
                type="number"
                min={0}
                prefix="৳"
                inputMode="decimal"
                value={shipping.insideDhakaCharge}
                onChange={(e) => setShipping((s) => ({ ...s, insideDhakaCharge: e.target.value }))}
                error={shippingErrors.insideDhakaCharge}
              />
              <TextField
                label="Delivery charge — outside Dhaka"
                type="number"
                min={0}
                prefix="৳"
                inputMode="decimal"
                value={shipping.outsideDhakaCharge}
                onChange={(e) => setShipping((s) => ({ ...s, outsideDhakaCharge: e.target.value }))}
                error={shippingErrors.outsideDhakaCharge}
              />
              <TextField
                label="Estimated days — inside Dhaka"
                type="number"
                min={1}
                inputMode="numeric"
                value={shipping.estimatedDaysInsideDhaka}
                onChange={(e) => setShipping((s) => ({ ...s, estimatedDaysInsideDhaka: e.target.value }))}
                error={shippingErrors.estimatedDaysInsideDhaka}
              />
              <TextField
                label="Estimated days — outside Dhaka"
                type="number"
                min={1}
                inputMode="numeric"
                value={shipping.estimatedDaysOutsideDhaka}
                onChange={(e) => setShipping((s) => ({ ...s, estimatedDaysOutsideDhaka: e.target.value }))}
                error={shippingErrors.estimatedDaysOutsideDhaka}
              />
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button variant="primary" loading={busy === 'shipping'} onClick={saveShipping}>
                Save shipping
              </Button>
            </div>
          </Card>

          <Card aria-labelledby="notifications-h">
            <div id="notifications" className="scroll-mt-24" />
            <CardHeader id="notifications-h" title="Notification preferences" description="In-app notifications are always on. Choose extra channels." />
            <div className="space-y-3 px-5 pb-5">
              <Checkbox label="New order — email" checked={prefs.newOrderEmail} onChange={(v) => setPrefs((p) => ({ ...p, newOrderEmail: v }))} />
              <Checkbox
                label="New order — SMS"
                description="Sent to your profile phone number. Falls back to email if SMS fails."
                checked={prefs.newOrderSms}
                onChange={(v) => setPrefs((p) => ({ ...p, newOrderSms: v }))}
              />
              <Checkbox label="Low-stock alerts — email" checked={prefs.lowStockEmail} onChange={(v) => setPrefs((p) => ({ ...p, lowStockEmail: v }))} />
              <Checkbox
                label="Support ticket updates — email"
                checked={prefs.supportTicketEmail}
                onChange={(v) => setPrefs((p) => ({ ...p, supportTicketEmail: v }))}
              />
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button
                variant="primary"
                loading={busy === 'prefs'}
                onClick={() => void run('prefs', () => services.store.updateExtensions({ notificationPreferences: prefs }), 'Notification preferences saved')}
              >
                Save preferences
              </Button>
            </div>
          </Card>

          <Card aria-labelledby="visibility-h">
            <div id="visibility" className="scroll-mt-24" />
            <CardHeader
              id="visibility-h"
              title="Store visibility"
              description="Published stores are visible to customers. Draft stores are hidden."
              action={<StoreStatusBadge status={store.status} />}
            />
            <div className="space-y-4 px-5 pb-5">
              {store.status === 'suspended' && <Alert tone="danger">This store has been suspended by BazarHQ and can’t be published.</Alert>}
              {visibilityError && <Alert tone="warning">{visibilityError}</Alert>}
              {onboarding.data && store.status !== 'published' && <OnboardingChecklist progress={onboarding.data} />}
              <div className="flex flex-wrap gap-2">
                {store.status === 'published' ? (
                  <>
                    <a href={storefrontUrl(store.subdomain)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md')}>
                      View storefront
                    </a>
                    <Button variant="danger-outline" icon={<EyeOff className="size-4" aria-hidden />} onClick={() => setConfirmUnpublish(true)}>
                      Unpublish store
                    </Button>
                  </>
                ) : (
                  store.status === 'draft' && (
                    <Button
                      variant="brand"
                      icon={<Rocket className="size-4" aria-hidden />}
                      loading={busy === 'publish'}
                      disabled={!onboarding.data?.publishable}
                      onClick={() => void publish()}
                    >
                      Publish store
                    </Button>
                  )
                )}
              </div>
            </div>
          </Card>

          <Card aria-labelledby="account-h">
            <div id="account" className="scroll-mt-24" />
            <CardHeader id="account-h" title="Account & security" />
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              <Link href={paths.profile} className={buttonClass('secondary', 'md')}>
                <ShieldCheck className="size-4" aria-hidden /> Password, 2FA & sessions
              </Link>
              <Button
                variant="ghost"
                icon={<LogOut className="size-4" aria-hidden />}
                onClick={async () => {
                  await signOut();
                  router.replace(paths.login);
                }}
              >
                Sign out
              </Button>
            </div>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirmUnpublish}
        onClose={() => setConfirmUnpublish(false)}
        busy={busy === 'unpublish'}
        tone="danger"
        title="Unpublish your store?"
        description="Customers won’t be able to find or order from your store until you publish again. Existing orders remain trackable."
        confirmLabel="Unpublish"
        onConfirm={async () => {
          const ok = await run('unpublish', () => services.store.unpublish(), 'Store unpublished');
          if (ok) setConfirmUnpublish(false);
        }}
      />
    </>
  );
}
