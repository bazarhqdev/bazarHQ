import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import {
  changePasswordSchema,
  errorMessage,
  isServiceError,
  profileSchema,
  shippingSchema,
  storeProfileSchema,
  toFieldErrors,
  type FieldErrors,
  type NotificationPreferences,
  type Store,
} from '@bazarhq/shared';
import { Avatar, Button, Card, Checkbox, ImageUploadField, StoreStatusBadge, TextField, useServices, useSession, useToast } from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';
import { paths } from '@/navigation/paths';
import { nativeSignOutCleanup } from '@/services/native';

export function SettingsScreen() {
  const { session } = useSession();
  if (!session?.store) return null;
  return <SettingsBody key={session.store.id} store={session.store} />;
}

function SettingsBody({ store }: { store: Store }) {
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const { session, setSession, signOut } = useSession();
  const user = session!.user;
  const [me, setMe] = useState({ fullName: user.fullName, phone: user.phone ?? '' });
  const [meErr, setMeErr] = useState<FieldErrors>({});
  const [sp, setSp] = useState({ name: store.name, tagline: store.tagline ?? '', returnWindowDays: String(store.returnWindowDays) });
  const [spErr, setSpErr] = useState<FieldErrors>({});
  const [ship, setShip] = useState({
    insideDhakaCharge: String(store.extensions.shipping.insideDhakaCharge),
    outsideDhakaCharge: String(store.extensions.shipping.outsideDhakaCharge),
    estimatedDaysInsideDhaka: String(store.extensions.shipping.estimatedDaysInsideDhaka),
    estimatedDaysOutsideDhaka: String(store.extensions.shipping.estimatedDaysOutsideDhaka),
  });
  const [shipErr, setShipErr] = useState<FieldErrors>({});
  const [prefs, setPrefs] = useState<NotificationPreferences>(store.extensions.notificationPreferences);
  const [pw, setPw] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [pwErr, setPwErr] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (key: string, fn: () => Promise<void>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(msg);
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const setStore = (s: Store) => setSession({ ...session!, store: s });

  return (
    <Screen title="Profile & settings" back>
      <SectionTitle>Your profile</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} src={user.avatarUrl} size={52} />
          <div>
            <p className="font-bold">{user.email}</p>
            <p className="text-[12.5px] text-ink-muted">{user.twoFactorEnabled ? '2FA on' : '2FA off — manage on the web portal'}</p>
          </div>
        </div>
        <TextField
          label="Full name"
          className="h-12 text-base"
          value={me.fullName}
          onChange={(e) => setMe((m) => ({ ...m, fullName: e.target.value }))}
          error={meErr.fullName}
        />
        <TextField
          label="Mobile number"
          inputMode="numeric"
          className="h-12 text-base"
          value={me.phone}
          onChange={(e) => setMe((m) => ({ ...m, phone: e.target.value }))}
          error={meErr.phone}
          placeholder="01XXXXXXXXX"
        />
        <Button
          block
          loading={busy === 'me'}
          onClick={() => {
            const v = profileSchema.safeParse(me);
            if (!v.success) return setMeErr(toFieldErrors(v.error));
            setMeErr({});
            void save(
              'me',
              async () => setSession({ ...session!, user: await services.auth.updateProfile({ fullName: me.fullName, phone: me.phone || null }) }),
              'Profile saved',
            );
          }}
        >
          Save profile
        </Button>
      </Card>

      <SectionTitle action={<StoreStatusBadge status={store.status} />}>Store profile</SectionTitle>
      <Card className="space-y-4 p-4">
        <ImageUploadField label="Store logo" value={store.logoUrl} onUpload={async (f) => setStore(await services.store.uploadLogo(f))} />
        <TextField
          label="Store name"
          className="h-12 text-base"
          value={sp.name}
          onChange={(e) => setSp((s) => ({ ...s, name: e.target.value }))}
          error={spErr.name}
        />
        <TextField
          label="Tagline"
          className="h-12 text-base"
          value={sp.tagline}
          onChange={(e) => setSp((s) => ({ ...s, tagline: e.target.value }))}
          error={spErr.tagline}
        />
        <TextField
          label="Return window (days)"
          type="number"
          inputMode="numeric"
          className="h-12 text-base"
          value={sp.returnWindowDays}
          onChange={(e) => setSp((s) => ({ ...s, returnWindowDays: e.target.value }))}
          error={spErr.returnWindowDays}
          hint="Default 7 days from delivery."
        />
        <Button
          block
          loading={busy === 'store'}
          onClick={() => {
            const v = storeProfileSchema.safeParse({ ...sp, returnWindowDays: Number(sp.returnWindowDays) });
            if (!v.success) return setSpErr(toFieldErrors(v.error));
            setSpErr({});
            void save('store', async () => setStore(await services.store.updateStore(v.data)), 'Store saved');
          }}
        >
          Save store
        </Button>
        {store.status === 'published' ? (
          <Button
            variant="danger-outline"
            block
            loading={busy === 'vis'}
            onClick={() => void save('vis', async () => setStore(await services.store.unpublish()), 'Store unpublished')}
          >
            Unpublish store
          </Button>
        ) : (
          store.status === 'draft' && (
            <Button variant="brand" block onClick={() => navigate(paths.onboarding)}>
              Review checklist & publish
            </Button>
          )
        )}
      </Card>

      <SectionTitle>Shipping</SectionTitle>
      <Card className="grid grid-cols-2 gap-3 p-4">
        <TextField
          label="Inside Dhaka (৳)"
          type="number"
          inputMode="decimal"
          value={ship.insideDhakaCharge}
          onChange={(e) => setShip((s) => ({ ...s, insideDhakaCharge: e.target.value }))}
          error={shipErr.insideDhakaCharge}
        />
        <TextField
          label="Outside Dhaka (৳)"
          type="number"
          inputMode="decimal"
          value={ship.outsideDhakaCharge}
          onChange={(e) => setShip((s) => ({ ...s, outsideDhakaCharge: e.target.value }))}
          error={shipErr.outsideDhakaCharge}
        />
        <TextField
          label="Days inside"
          type="number"
          inputMode="numeric"
          value={ship.estimatedDaysInsideDhaka}
          onChange={(e) => setShip((s) => ({ ...s, estimatedDaysInsideDhaka: e.target.value }))}
          error={shipErr.estimatedDaysInsideDhaka}
        />
        <TextField
          label="Days outside"
          type="number"
          inputMode="numeric"
          value={ship.estimatedDaysOutsideDhaka}
          onChange={(e) => setShip((s) => ({ ...s, estimatedDaysOutsideDhaka: e.target.value }))}
          error={shipErr.estimatedDaysOutsideDhaka}
        />
        <Button
          className="col-span-2"
          block
          loading={busy === 'ship'}
          onClick={() => {
            const v = shippingSchema.safeParse(Object.fromEntries(Object.entries(ship).map(([k, val]) => [k, val.trim() === '' ? Number.NaN : Number(val)])));
            if (!v.success) return setShipErr(toFieldErrors(v.error));
            setShipErr({});
            void save('ship', async () => setStore(await services.store.updateExtensions({ shipping: v.data })), 'Shipping saved');
          }}
        >
          Save shipping
        </Button>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="space-y-3 p-4">
        <Checkbox label="New order — email" checked={prefs.newOrderEmail} onChange={(v) => setPrefs((p) => ({ ...p, newOrderEmail: v }))} />
        <Checkbox label="New order — SMS" checked={prefs.newOrderSms} onChange={(v) => setPrefs((p) => ({ ...p, newOrderSms: v }))} />
        <Checkbox label="Low stock — email" checked={prefs.lowStockEmail} onChange={(v) => setPrefs((p) => ({ ...p, lowStockEmail: v }))} />
        <Checkbox label="Support tickets — email" checked={prefs.supportTicketEmail} onChange={(v) => setPrefs((p) => ({ ...p, supportTicketEmail: v }))} />
        <Button
          block
          loading={busy === 'prefs'}
          onClick={() =>
            void save('prefs', async () => setStore(await services.store.updateExtensions({ notificationPreferences: prefs })), 'Preferences saved')
          }
        >
          Save preferences
        </Button>
      </Card>

      <SectionTitle>Change password</SectionTitle>
      <Card className="space-y-3 p-4">
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={pw.currentPassword}
          onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
          error={pwErr.currentPassword}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={pw.password}
          onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))}
          error={pwErr.password}
          hint="8+ characters with a number. Other devices will be signed out."
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={pw.confirmPassword}
          onChange={(e) => setPw((p) => ({ ...p, confirmPassword: e.target.value }))}
          error={pwErr.confirmPassword}
        />
        <Button
          block
          loading={busy === 'pw'}
          onClick={async () => {
            const v = changePasswordSchema.safeParse(pw);
            if (!v.success) return setPwErr(toFieldErrors(v.error));
            setPwErr({});
            setBusy('pw');
            try {
              await services.auth.changePassword(pw.currentPassword, pw.password);
              setPw({ currentPassword: '', password: '', confirmPassword: '' });
              toast.success('Password changed', 'Other sessions were signed out.');
            } catch (e) {
              if (isServiceError(e) && e.fieldErrors) setPwErr(e.fieldErrors);
              else toast.error('Couldn’t change password', errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          Update password
        </Button>
      </Card>

      <Button
        className="mt-5"
        variant="danger-outline"
        size="lg"
        block
        icon={<LogOut className="size-4" aria-hidden />}
        onClick={async () => {
          await nativeSignOutCleanup();
          await signOut();
          navigate(paths.login, { replace: true });
        }}
      >
        Sign out
      </Button>
    </Screen>
  );
}
