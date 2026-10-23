'use client';

/**
 * Super Admin access (SRS §12.1, FR-SA-01..03): approved network → email +
 * password → TOTP, with a 30-minute idle timeout. The network and idle checks
 * are enforced server-side (edge allowlist + AAL2 session); this UI mirrors
 * them so the admin understands what is happening.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, ShieldX, Wifi, WifiOff } from 'lucide-react';
import { ADMIN_LIMITS, adminLoginSchema, errorMessage, isServiceError, totpCodeSchema } from '@bazarhq/shared';
import { BazarLogo } from '../../brand';
import { Alert, Button, Modal, TextField } from '../../components';
import { useAdminPaths, useAsync, useNavigation, useServices, useSession } from '../../context';
import { useZodForm } from '../../form';
import { PasswordInput } from '../customer/auth';

function AdminAuthFrame({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-navy-950 px-4 py-10">
      <BazarLogo tone="light" subtitle="Super Admin" />
      <div className="mt-8 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 max-w-md text-center text-[13px] text-navy-200">{footer}</div>}
    </main>
  );
}

export interface AdminDemoTools {
  accounts: { email: string; password: string; note: string }[];
  totpCode: string;
  network: () => 'allowlisted' | 'blocked';
  setNetwork: (n: 'allowlisted' | 'blocked') => void;
  expireSession: () => void;
}

export function AdminLogin({ demo, expired }: { demo?: AdminDemoTools | null; expired?: boolean }) {
  const services = useServices();
  const { navigate } = useNavigation();
  const a = useAdminPaths();
  const { session, status } = useSession();
  const [tick, setTick] = useState(0);
  const net = useAsync(() => services.adminAuth.checkNetwork(), [tick]);
  const [error, setError] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const form = useZodForm(adminLoginSchema, { email: '', password: '' });

  useEffect(() => {
    if (status === 'ready' && session?.user.role === 'super_admin' && session.admin?.mfaVerified) navigate(a.dashboard, { replace: true });
  }, [status, session, navigate, a.dashboard]);

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await services.adminAuth.signIn(email, password);
      navigate(a.totp);
    } catch (err) {
      setError({ tone: isServiceError(err) && (err.code === 'LOCKED' || err.code === 'FORBIDDEN') ? 'warning' : 'danger', text: errorMessage(err) });
    }
  });

  const blocked = net.data && !net.data.allowed;
  return (
    <AdminAuthFrame
      title="Super Admin sign in"
      description="Restricted to BazarHQ platform administrators."
      footer={<>Every action in the admin console is recorded in the audit log with your account and IP address.</>}
    >
      {expired && (
        <Alert tone="warning" className="mb-4" title="Session ended">
          You were signed out after {ADMIN_LIMITS.idleTimeoutMinutes} minutes of inactivity.
        </Alert>
      )}
      <div
        className={`mb-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] ${net.loading ? 'bg-canvas text-ink-muted' : blocked ? 'bg-red-50 text-red-800' : 'bg-brand-50 text-brand-900'}`}
        role="status"
      >
        {net.loading ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : blocked ? (
          <WifiOff className="size-4" aria-hidden />
        ) : (
          <Wifi className="size-4" aria-hidden />
        )}
        {net.loading
          ? 'Checking network…'
          : blocked
            ? `Connection from ${net.data!.ip} is not on the approved network. Connect to the office VPN.`
            : `Approved network · ${net.data?.ip}`}
      </div>
      {error && (
        <Alert tone={error.tone} className="mb-4">
          {error.text}
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Email" type="email" autoComplete="username" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <Button
          type="submit"
          block
          size="lg"
          loading={form.formState.isSubmitting}
          disabled={Boolean(blocked)}
          icon={<LockKeyhole className="size-4" aria-hidden />}
        >
          Continue
        </Button>
      </form>
      {demo && (
        <details className="mt-6 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Demo controls (mock only)</summary>
          <ul className="mt-2 space-y-1">
            {demo.accounts.map((acc) => (
              <li key={acc.email}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas"
                  onClick={() => {
                    form.setValue('email', acc.email);
                    form.setValue('password', acc.password);
                  }}
                >
                  <span className="block font-semibold text-navy-800">{acc.email}</span>
                  <span className="block text-[12px] text-ink-muted">
                    {acc.note} · <code className="rounded bg-canvas px-1">{acc.password}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-muted">
            TOTP code: <code className="rounded bg-canvas px-1">{demo.totpCode}</code>
          </p>
          <button
            type="button"
            className="mt-2 text-[12.5px] font-semibold text-brand-700"
            onClick={() => {
              demo.setNetwork(demo.network() === 'allowlisted' ? 'blocked' : 'allowlisted');
              setTick((t) => t + 1);
            }}
          >
            Simulate {blocked ? 'approved VPN' : 'unapproved network'}
          </button>
        </details>
      )}
    </AdminAuthFrame>
  );
}

export function AdminTotp({ demoCode }: { demoCode?: string | null }) {
  const services = useServices();
  const { setSession } = useSession();
  const { navigate, Link } = useNavigation();
  const a = useAdminPaths();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const v = totpCodeSchema.safeParse(code);
    if (!v.success) return setError(v.error.issues[0]!.message);
    setBusy(true);
    setError(null);
    try {
      const s = await services.adminAuth.verifyTotp(code);
      setSession(s);
      navigate(a.dashboard, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
    }
  };
  return (
    <AdminAuthFrame
      title="Two-factor verification"
      description="Enter the 6-digit code from your authenticator app."
      footer={
        <Link href={a.login} className="font-semibold text-white underline">
          Start over
        </Link>
      }
    >
      <div className="mb-5 flex justify-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-navy-50 text-navy-800">
          <KeyRound className="size-7" aria-hidden />
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
        className="space-y-4"
      >
        <TextField
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="text-center font-mono text-2xl tracking-[0.5em]"
          error={error ?? undefined}
        />
        <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" aria-hidden />}>
          Verify
        </Button>
      </form>
      {demoCode && (
        <p className="mt-4 text-center text-[12.5px] text-ink-muted">
          Demo code: <code className="rounded bg-canvas px-1.5 py-0.5 font-semibold">{demoCode}</code>
        </p>
      )}
    </AdminAuthFrame>
  );
}

/**
 * UX guard + idle timer. The server rejects any admin call after 30 idle
 * minutes regardless of this timer; the warning just avoids surprise.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const services = useServices();
  const { session, status, setSession, refresh } = useSession();
  const { navigate } = useNavigation();
  const a = useAdminPaths();
  const ok = session?.user.role === 'super_admin' && session.admin?.mfaVerified;
  const last = useRef(0);
  const lastTouch = useRef(0);
  const [warn, setWarn] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (status === 'ready' && !ok) navigate(a.login, { replace: true });
  }, [status, ok, navigate, a.login]);

  const expire = useCallback(async () => {
    await services.adminAuth.signOut().catch(() => undefined);
    setSession(null);
    navigate(`${a.login}?expired=1`, { replace: true });
  }, [services, setSession, navigate, a.login]);

  useEffect(() => {
    if (!ok) return;
    last.current = Date.now();
    const limit = ADMIN_LIMITS.idleTimeoutMinutes * 60_000;
    const onActivity = () => {
      last.current = Date.now();
      // Keep the server-side idle window in sync, at most once a minute.
      if (Date.now() - lastTouch.current > 60_000) {
        lastTouch.current = Date.now();
        services.adminAuth.touch().catch(() => void refresh());
      }
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= limit) void expire();
      else if (idle >= limit - 2 * 60_000) {
        setWarn(true);
        setLeft(Math.ceil((limit - idle) / 1000));
      } else setWarn(false);
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      clearInterval(t);
    };
  }, [ok, services, expire, refresh]);

  if (status === 'loading' || !ok) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas" role="status">
        {status === 'loading' ? (
          <LoaderCircle className="size-7 animate-spin text-navy-700" aria-hidden />
        ) : (
          <ShieldX className="size-8 text-red-600" aria-hidden />
        )}
        <span className="text-sm text-ink-muted">{status === 'loading' ? 'Checking admin session…' : 'Admin sign-in required'}</span>
      </div>
    );
  }
  return (
    <>
      {children}
      <Modal
        open={warn}
        onClose={() => {
          last.current = Date.now();
          setWarn(false);
        }}
        title="Still there?"
        description={`For security you’ll be signed out in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => void expire()}>
              Sign out now
            </Button>
            <Button
              onClick={() => {
                last.current = Date.now();
                lastTouch.current = Date.now();
                setWarn(false);
                services.adminAuth.touch().catch(() => void expire());
              }}
            >
              Stay signed in
            </Button>
          </>
        }
      />
    </>
  );
}
