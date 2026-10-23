import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Rocket, Store } from 'lucide-react';
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
  BrandColourPicker,
  Button,
  buttonClass,
  Card,
  ErrorState,
  ImageUploadField,
  OnboardingChecklist,
  SelectField,
  Skeleton,
  SkeletonRows,
  Stepper,
  StorePreview,
  SubdomainField,
  TextField,
  ThemePicker,
  useAsync,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { Screen } from '@/components/Screen';
import { paths } from '@/navigation/paths';

const STEPS = ['Store', 'Branding', 'Go live'];

export function OnboardingScreen() {
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const { session, refresh, signOut } = useSession();
  const store = session?.store ?? null;
  const progress = useAsync(() => services.store.getOnboarding(), [store?.id, store?.status]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!store) {
    return (
      <Screen
        title="Welcome"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      >
        <div className="pt-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Store className="size-8" aria-hidden />
          </div>
          <h2 className="mt-4 text-2xl font-bold">Let’s create your store</h2>
          <p className="mt-2 text-sm text-ink-muted">About 10 minutes. Progress is saved after each step.</p>
          <Link to={paths.onboardingStore} className={buttonClass('brand', 'lg', 'mt-8 w-full')}>
            Create my store
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Store setup"
      subtitle={`${store.subdomain}.bazarhq.com`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      }
    >
      <Stepper steps={STEPS} current={2} />
      <Card className="mt-5 p-4">
        {progress.loading ? (
          <SkeletonRows rows={4} className="p-0" />
        ) : progress.error ? (
          <ErrorState message={progress.error} onRetry={progress.reload} />
        ) : (
          progress.data && <OnboardingChecklist progress={progress.data} />
        )}
      </Card>
      {error && (
        <Alert tone="warning" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-5 space-y-2">
        {store.status !== 'published' && (
          <Button
            variant="brand"
            size="lg"
            block
            icon={<Rocket className="size-4" aria-hidden />}
            loading={busy}
            disabled={!progress.data?.publishable}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await services.store.publish();
                await refresh();
                toast.success('Your store is live!');
                navigate(paths.dashboard);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish store
          </Button>
        )}
        <Link to={paths.dashboard} className={buttonClass('secondary', 'lg', 'w-full')}>
          Go to dashboard
        </Link>
      </div>
    </Screen>
  );
}

export function OnboardingStoreScreen() {
  const services = useServices();
  const navigate = useNavigate();
  const { session, refresh } = useSession();
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [touched, setTouched] = useState(false);
  const [category, setCategory] = useState('');
  const [tagline, setTagline] = useState('');
  const [check, setCheck] = useState<SubdomainCheck | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session?.store) return <Navigate to={paths.onboardingTheme} replace />;

  return (
    <Screen title="Create your store" back={paths.onboarding}>
      <Stepper steps={STEPS} current={0} />
      <form
        className="mt-5 space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const v = storeBasicsSchema.safeParse({ name, subdomain, category, tagline });
          const fe = v.success ? {} : toFieldErrors(v.error);
          if (check && !check.available && check.subdomain === subdomain) fe.subdomain = check.message;
          if (Object.keys(fe).length) return setErrors(fe);
          setBusy(true);
          setError(null);
          try {
            await services.store.createStore({ name, subdomain, category: category as StoreCategory, tagline });
            await refresh();
            navigate(paths.onboardingTheme);
          } catch (err) {
            if (isServiceError(err) && err.fieldErrors) setErrors(err.fieldErrors);
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label="Store name"
          required
          className="h-12 text-base"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!touched) setSubdomain(slugifySubdomain(e.target.value));
          }}
          error={errors.name}
          placeholder="e.g. Green Basket"
        />
        <SubdomainField
          value={subdomain}
          onChange={(v) => {
            setTouched(true);
            setSubdomain(v);
          }}
          onResult={setCheck}
          error={errors.subdomain}
        />
        <SelectField
          label="Store category"
          required
          className="h-12 text-base"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          error={errors.category}
          placeholder="Choose a category"
          options={Object.entries(STORE_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextField
          label="Tagline (optional)"
          className="h-12 text-base"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          error={errors.tagline}
          maxLength={120}
        />
        <p className="text-[12px] font-bold uppercase tracking-wider text-ink-subtle">Preview</p>
        <StorePreview name={name} tagline={tagline || null} brandColour="#059669" logoUrl={null} bannerUrl={null} subdomain={subdomain} />
        <Button type="submit" size="lg" block loading={busy}>
          Continue
        </Button>
      </form>
    </Screen>
  );
}

export function OnboardingThemeScreen() {
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const { session, setSession } = useSession();
  const store = session?.store ?? null;
  const themes = useAsync(() => services.store.listThemes(), []);
  const [themeId, setThemeId] = useState(store?.themeId ?? null);
  const [brandColour, setBrandColour] = useState(store?.brandColour ?? '#059669');
  const [busy, setBusy] = useState(false);

  if (!session || !store) return <Navigate to={paths.onboardingStore} replace />;

  return (
    <Screen title="Theme & branding" back={paths.onboarding}>
      <Stepper steps={STEPS} current={1} />
      <div className="mt-5 space-y-5">
        <ImageUploadField
          label="Store logo"
          value={store.logoUrl}
          onUpload={async (f) => {
            const s = await services.store.uploadLogo(f);
            setSession({ ...session, store: s });
          }}
        />
        <ImageUploadField
          label="Store banner"
          aspect="banner"
          value={store.extensions.bannerUrl}
          onUpload={async (f) => {
            const s = await services.store.uploadBanner(f);
            setSession({ ...session, store: s });
          }}
        />
        <div>
          <p className="mb-2 text-[13px] font-semibold">Choose a theme</p>
          {themes.data ? <ThemePicker themes={themes.data} value={themeId} onChange={setThemeId} /> : <Skeleton className="h-48" />}
        </div>
        <BrandColourPicker value={brandColour} onChange={setBrandColour} />
        <StorePreview
          name={store.name}
          tagline={store.tagline}
          brandColour={brandColour}
          logoUrl={store.logoUrl}
          bannerUrl={store.extensions.bannerUrl}
          subdomain={store.subdomain}
        />
        <Button
          size="lg"
          block
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const s = await services.store.updateStore({ themeId, brandColour });
              setSession({ ...session, store: s });
              toast.success('Branding saved');
              navigate(paths.onboarding);
            } catch (e) {
              toast.error('Couldn’t save', errorMessage(e));
              setBusy(false);
            }
          }}
        >
          Save & continue
        </Button>
      </div>
    </Screen>
  );
}
