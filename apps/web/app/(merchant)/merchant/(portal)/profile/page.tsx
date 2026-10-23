'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Laptop, LogOut, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import {
  changePasswordSchema,
  emailSchema,
  errorMessage,
  formatRelative,
  isServiceError,
  profileSchema,
  toFieldErrors,
  totpCodeSchema,
  type FieldErrors,
} from '@bazarhq/shared';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Modal,
  PageHeader,
  readImageFile,
  SkeletonRows,
  TextField,
  useAsync,
  useServices,
  useSession,
  useToast,
} from '@bazarhq/ui';
import { PasswordField } from '@/components/shared/auth';
import { paths } from '@/lib/paths';
import { getMockDevTools, showDemoTools } from '@/lib/services';

export default function ProfilePage() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const { session, setSession, signOut, refresh } = useSession();
  const user = session?.user;
  const [info, setInfo] = useState({ fullName: user?.fullName ?? '', phone: user?.phone ?? '' });
  const [infoErrors, setInfoErrors] = useState<FieldErrors>({});
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [pw, setPw] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [pwErrors, setPwErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = useAsync(() => services.auth.listSessions(), []);
  const [totp, setTotp] = useState<{ step: 'idle' | 'enroll' | 'codes' | 'disable'; secret?: string; code: string; codes?: string[]; error?: string }>({
    step: 'idle',
    code: '',
  });
  const [del, setDel] = useState<{ open: boolean; pending?: number; confirmation: string; error?: string }>({ open: false, confirmation: '' });
  const dev = getMockDevTools();

  if (!session || !user) return null;

  const saveInfo = async () => {
    const v = profileSchema.safeParse(info);
    if (!v.success) return setInfoErrors(toFieldErrors(v.error));
    setInfoErrors({});
    setBusy('info');
    try {
      const u = await services.auth.updateProfile({ fullName: info.fullName, phone: info.phone || null });
      setSession({ ...session, user: u });
      toast.success('Profile saved');
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    const { upload, error } = await readImageFile(file, 300);
    if (error || !upload) return toast.error('Image not accepted', error);
    try {
      const u = await services.auth.updateProfile({ fullName: user.fullName, phone: user.phone, avatar: upload });
      setSession({ ...session, user: u });
      toast.success('Profile picture updated');
    } catch (e) {
      toast.error('Upload failed', errorMessage(e));
    }
  };

  const changeEmail = async () => {
    const v = emailSchema.safeParse(newEmail);
    if (!v.success) return setEmailError(toFieldErrors(v.error)._form);
    setEmailError(undefined);
    setBusy('email');
    try {
      await services.auth.requestEmailChange(newEmail);
      await refresh();
      toast.success('Check your new inbox', `Verify ${newEmail} to make it active.`);
      setNewEmail('');
    } catch (e) {
      setEmailError(isServiceError(e) ? (e.fieldErrors?.email ?? e.message) : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    const v = changePasswordSchema.safeParse(pw);
    if (!v.success) return setPwErrors(toFieldErrors(v.error));
    setPwErrors({});
    setBusy('pw');
    try {
      await services.auth.changePassword(pw.currentPassword, pw.password);
      setPw({ currentPassword: '', password: '', confirmPassword: '' });
      await sessions.reload();
      toast.success('Password changed', 'All other sessions were signed out.');
    } catch (e) {
      if (isServiceError(e) && e.fieldErrors) setPwErrors(e.fieldErrors);
      else toast.error('Couldn’t change password', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <title>Profile & security · BazarHQ Merchant</title>
      <PageHeader title="Profile & security" description="Your personal details and how you sign in." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Personal information" />
          <div className="space-y-4 px-5 pb-5">
            <div className="flex items-center gap-4">
              <Avatar name={user.fullName} src={user.avatarUrl} size={64} />
              <label className="cursor-pointer rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-semibold text-navy-900 hover:bg-navy-50 focus-within:ring-2 focus-within:ring-brand-600/40">
                Change photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void changeAvatar(e.target.files?.[0])} />
              </label>
            </div>
            <TextField
              label="Full name"
              value={info.fullName}
              onChange={(e) => setInfo((i) => ({ ...i, fullName: e.target.value }))}
              error={infoErrors.fullName}
            />
            <TextField
              label="Mobile number"
              inputMode="numeric"
              placeholder="01XXXXXXXXX"
              value={info.phone}
              onChange={(e) => setInfo((i) => ({ ...i, phone: e.target.value }))}
              error={infoErrors.phone}
              hint="Used for order SMS alerts."
            />
            <div className="flex justify-end">
              <Button variant="primary" loading={busy === 'info'} onClick={() => void saveInfo()}>
                Save
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Email address" description={`Signed in with ${user.authProvider === 'google' ? 'Google' : 'email and password'}.`} />
          <div className="space-y-4 px-5 pb-5">
            <p className="text-sm">
              Current: <strong>{user.email}</strong> <Badge tone="success">Verified</Badge>
            </p>
            {user.pendingEmail && (
              <Alert
                tone="info"
                title="Verification pending"
                action={
                  dev && showDemoTools ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => (dev.simulateVerificationClick(user.pendingEmail!), await refresh(), toast.success('Email verified (demo)'))}
                    >
                      Simulate verify
                    </Button>
                  ) : undefined
                }
              >
                {user.pendingEmail} becomes active after you click the link we sent to it.
              </Alert>
            )}
            <TextField label="New email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} error={emailError} />
            <div className="flex justify-end">
              <Button variant="secondary" loading={busy === 'email'} disabled={!newEmail} onClick={() => void changeEmail()}>
                Send verification
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Change password" description="Changing your password signs out every other device." />
          <div className="space-y-4 px-5 pb-5">
            <PasswordField
              label="Current password"
              autoComplete="current-password"
              value={pw.currentPassword}
              onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
              error={pwErrors.currentPassword}
            />
            <PasswordField
              label="New password"
              autoComplete="new-password"
              value={pw.password}
              onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))}
              error={pwErrors.password}
              hint="At least 8 characters including a number."
            />
            <PasswordField
              label="Confirm new password"
              autoComplete="new-password"
              value={pw.confirmPassword}
              onChange={(e) => setPw((p) => ({ ...p, confirmPassword: e.target.value }))}
              error={pwErrors.confirmPassword}
            />
            <div className="flex justify-end">
              <Button variant="primary" loading={busy === 'pw'} onClick={() => void changePassword()}>
                Update password
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="Optional. Adds a 6-digit code from an authenticator app at sign-in."
            action={user.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          />
          <div className="px-5 pb-5">
            {user.twoFactorEnabled ? (
              <Button variant="danger-outline" onClick={() => setTotp({ step: 'disable', code: '' })}>
                Turn off 2FA
              </Button>
            ) : (
              <Button
                variant="brand"
                icon={<ShieldCheck className="size-4" aria-hidden />}
                loading={busy === 'totp'}
                onClick={async () => {
                  setBusy('totp');
                  try {
                    const r = await services.auth.beginTotpEnrollment();
                    setTotp({ step: 'enroll', secret: r.secret, code: '' });
                  } catch (e) {
                    toast.error('Couldn’t start setup', errorMessage(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Set up 2FA
              </Button>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Active sessions" description="Devices signed in to your account. End any session you don’t recognise." />
          {sessions.loading ? (
            <SkeletonRows rows={3} />
          ) : sessions.error ? (
            <ErrorState message={sessions.error} onRetry={sessions.reload} />
          ) : (
            <ul className="divide-y divide-line">
              {sessions.data!.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
                    {s.platform === 'android' ? <Smartphone className="size-4" aria-hidden /> : <Laptop className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {s.device} {s.current && <Badge tone="success">This device</Badge>}
                    </p>
                    <p className="text-[12.5px] text-ink-muted">
                      {s.location ?? 'Unknown location'} · active {formatRelative(s.lastActiveAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await services.auth.terminateSession(s.id);
                          sessions.setData((l) => (l ?? []).filter((x) => x.id !== s.id));
                          toast.success('Session ended');
                        } catch (e) {
                          toast.error('Couldn’t end session', errorMessage(e));
                        }
                      }}
                    >
                      End session
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button
              variant="ghost"
              icon={<LogOut className="size-4" aria-hidden />}
              onClick={async () => {
                await signOut();
                router.replace(paths.login);
              }}
            >
              Sign out of this device
            </Button>
          </div>
        </Card>

        <Card className="border-red-200 xl:col-span-2">
          <CardHeader
            title="Delete account"
            description="Your store is unpublished immediately. Order and payment records are kept for 7 years as required by law."
          />
          <div className="px-5 pb-5">
            <Button
              variant="danger-outline"
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={async () => {
                const r = await services.auth.getDeletionPrecheck().catch(() => ({ pendingOrders: 0 }));
                setDel({ open: true, pending: r.pendingOrders, confirmation: '' });
              }}
            >
              Delete my account
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={totp.step === 'enroll' || totp.step === 'codes' || totp.step === 'disable'}
        onClose={() => setTotp({ step: 'idle', code: '' })}
        busy={busy === 'totp-confirm'}
        title={
          totp.step === 'disable'
            ? 'Turn off two-factor authentication'
            : totp.step === 'codes'
              ? 'Save your recovery codes'
              : 'Set up two-factor authentication'
        }
        footer={
          totp.step === 'codes' ? (
            <Button variant="primary" onClick={() => setTotp({ step: 'idle', code: '' })}>
              I’ve saved them
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setTotp({ step: 'idle', code: '' })}>
                Cancel
              </Button>
              <Button
                variant={totp.step === 'disable' ? 'danger' : 'brand'}
                loading={busy === 'totp-confirm'}
                onClick={async () => {
                  const v = totpCodeSchema.safeParse(totp.code);
                  if (!v.success) return setTotp((t) => ({ ...t, error: toFieldErrors(v.error)._form }));
                  setBusy('totp-confirm');
                  try {
                    if (totp.step === 'disable') {
                      await services.auth.disableTotp(totp.code);
                      setTotp({ step: 'idle', code: '' });
                      toast.success('Two-factor authentication turned off');
                    } else {
                      const r = await services.auth.confirmTotpEnrollment(totp.code);
                      setTotp({ step: 'codes', code: '', codes: r.recoveryCodes });
                    }
                    await refresh();
                  } catch (e) {
                    setTotp((t) => ({ ...t, error: errorMessage(e) }));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {totp.step === 'disable' ? 'Turn off' : 'Verify & turn on'}
              </Button>
            </>
          )
        }
      >
        {totp.step === 'codes' ? (
          <div className="space-y-3">
            <Alert tone="warning">These codes are shown only once. Store them somewhere safe — each can be used once if you lose your phone.</Alert>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-3 font-mono text-sm">
              {totp.codes?.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            {totp.step === 'enroll' && (
              <div className="rounded-xl bg-canvas p-3 text-sm">
                <p className="text-ink-muted">Add BazarHQ to your authenticator app using this setup key:</p>
                <p className="mt-1 break-all font-mono font-semibold tracking-wider">{totp.secret}</p>
              </div>
            )}
            <TextField
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp.code}
              onChange={(e) => setTotp((t) => ({ ...t, code: e.target.value.replace(/\D/g, ''), error: undefined }))}
              error={totp.error}
              data-autofocus
            />
          </div>
        )}
      </Modal>

      <Modal
        open={del.open}
        onClose={() => setDel({ open: false, confirmation: '' })}
        busy={busy === 'delete'}
        title="Delete your merchant account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel({ open: false, confirmation: '' })}>
              Keep account
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              disabled={del.confirmation !== 'DELETE'}
              onClick={async () => {
                setBusy('delete');
                try {
                  await services.auth.deleteAccount(del.confirmation);
                  await refresh();
                  router.replace(paths.login);
                } catch (e) {
                  setDel((d) => ({ ...d, error: errorMessage(e) }));
                  setBusy(null);
                }
              }}
            >
              Delete account
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {(del.pending ?? 0) > 0 && (
            <Alert tone="warning" title={`You have ${del.pending} open order${del.pending === 1 ? '' : 's'}`}>
              Fulfil or cancel them first so customers aren’t left waiting.
            </Alert>
          )}
          {del.error && <Alert tone="danger">{del.error}</Alert>}
          <p className="text-sm text-ink-muted">
            Your store will be unpublished immediately. Profile data is removed within 30 days; transaction records are retained for 7 years.
          </p>
          <TextField
            label='Type "DELETE" to confirm'
            value={del.confirmation}
            onChange={(e) => setDel((d) => ({ ...d, confirmation: e.target.value }))}
            autoComplete="off"
          />
        </div>
      </Modal>
    </>
  );
}
