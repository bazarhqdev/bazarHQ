import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Eye, EyeOff, MailCheck, X } from 'lucide-react';
import {
  DEMO_ACCOUNTS,
  errorMessage,
  forgotPasswordSchema,
  isServiceError,
  loginSchema,
  passwordRuleChecks,
  registerSchema,
  resetPasswordSchema,
  toFieldErrors,
  type FieldErrors,
  type Session,
} from '@bazarhq/shared';
import { Alert, BazarLogo, Button, cn, IconButton, TextField, useServices, useSession, useToast, type TextFieldProps } from '@bazarhq/ui';
import { paths } from '@/navigation/paths';
import { devTools, showDemoTools } from '@/services/services';
import { FullScreenLoader } from '@/navigation/Shell';

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <BazarLogo subtitle="Merchant App" />
      <div className="mx-auto mt-8 w-full max-w-md">{children}</div>
    </main>
  );
}

function PasswordField(props: Omit<TextFieldProps, 'type' | 'suffix'>) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      className="h-12 text-base"
      suffix={
        <IconButton label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} className="size-10">
          {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </IconButton>
      }
    />
  );
}

function GoogleButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <Button variant="secondary" size="lg" block onClick={onClick} loading={loading}>
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.8 3.3-8Z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8Z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4Z" />
      </svg>
      Continue with Google
    </Button>
  );
}

const Divider = () => (
  <div className="flex items-center gap-3 text-[12px] font-semibold uppercase text-ink-subtle" role="separator">
    <span className="h-px flex-1 bg-line-strong" />
    or
    <span className="h-px flex-1 bg-line-strong" />
  </div>
);

function nextRoute(s: Session, from?: string) {
  if (!s.user.emailVerified) return paths.verifyEmail;
  if (!s.store) return paths.onboarding;
  return from && from !== paths.login ? from : paths.dashboard;
}

export function LoginScreen() {
  const services = useServices();
  const { session, status, setSession } = useSession();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pw' | 'google' | null>(null);

  if (status === 'ready' && session?.user.role === 'merchant' && session.user.emailVerified) return <Navigate to={nextRoute(session, from)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = loginSchema.safeParse({ email, password });
    if (!v.success) return setErrors(toFieldErrors(v.error));
    setErrors({});
    setError(null);
    setBusy('pw');
    try {
      const s = await services.auth.signIn(email, password);
      setSession(s);
      navigate(nextRoute(s, from), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold tracking-tight">Welcome back!</h1>
      <p className="mt-1 text-sm text-ink-muted">Sign in to your merchant account to manage your store.</p>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {error && <Alert tone={error.includes('locked') || error.includes('suspended') ? 'warning' : 'danger'}>{error}</Alert>}
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-12 text-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="you@yourstore.com"
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="text-right">
          <Link to={paths.forgotPassword} className="text-sm font-semibold text-brand-700">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" block loading={busy === 'pw'} disabled={busy === 'google'}>
          Sign in
        </Button>
        <Divider />
        <GoogleButton
          loading={busy === 'google'}
          onClick={async () => {
            setBusy('google');
            try {
              const s = await services.auth.signInWithGoogle();
              setSession(s);
              navigate(nextRoute(s), { replace: true });
            } catch (err) {
              setError(`${errorMessage(err)} Email sign-in still works.`);
              setBusy(null);
            }
          }}
        />
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        New to BazarHQ?{' '}
        <Link to={paths.register} className="font-semibold text-brand-700">
          Create an account
        </Link>
      </p>
      {showDemoTools && (
        <details className="mt-6 rounded-xl border border-dashed border-line-strong p-3 text-sm">
          <summary className="font-semibold">Demo accounts (mock data)</summary>
          <ul className="mt-2 space-y-1">
            {DEMO_ACCOUNTS.filter((a) => a.role !== 'super_admin').map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left active:bg-canvas"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(a.password);
                  }}
                >
                  <span className="block font-semibold text-navy-800">{a.email}</span>
                  <span className="block text-[12px] text-ink-muted">{a.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </AuthFrame>
  );
}

export function RegisterScreen() {
  const services = useServices();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = registerSchema.safeParse(form);
    if (!v.success) return setErrors(toFieldErrors(v.error));
    setErrors({});
    setBusy(true);
    try {
      await services.auth.register({ fullName: form.fullName, email: form.email, password: form.password });
      await refresh();
      navigate(paths.verifyEmail, { replace: true });
    } catch (err) {
      if (isServiceError(err) && err.fieldErrors) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold tracking-tight">Create your merchant account</h1>
      <p className="mt-1 text-sm text-ink-muted">Join BazarHQ and start your online business today.</p>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label="Full name" autoComplete="name" className="h-12 text-base" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <TextField
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-12 text-base"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <div>
          <PasswordField label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
          <ul className="mt-2 space-y-1">
            {passwordRuleChecks(form.password).map((r) => (
              <li key={r.label} className={cn('flex items-center gap-1.5 text-[12.5px]', r.ok ? 'text-brand-700' : 'text-ink-subtle')}>
                {r.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />} {r.label}
              </li>
            ))}
          </ul>
        </div>
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={errors.confirmPassword}
        />
        <Button type="submit" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to={paths.login} className="font-semibold text-brand-700">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function VerifyEmailScreen() {
  const services = useServices();
  const toast = useToast();
  const { session, status, setSession, signOut } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'check' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (status === 'loading') return <FullScreenLoader />;
  if (!session) return <Navigate to={paths.login} replace />;
  if (session.user.emailVerified) return <Navigate to={session.store ? paths.dashboard : paths.onboarding} replace />;
  const email = session.user.email;

  return (
    <AuthFrame>
      <div className="text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-brand-50 text-brand-700">
          <MailCheck className="size-10" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-bold">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          We’ve sent a verification link to <strong className="text-ink">{email}</strong>. Open it to verify your merchant account.
        </p>
      </div>
      <div className="mt-6 space-y-3">
        {error && <Alert tone="warning">{error}</Alert>}
        <Button
          size="lg"
          block
          loading={busy === 'check'}
          onClick={async () => {
            setBusy('check');
            setError(null);
            try {
              const s = await services.auth.refreshVerification();
              setSession(s);
              navigate(s.store ? paths.dashboard : paths.onboarding, { replace: true });
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          I’ve verified my email
        </Button>
        <Button
          variant="secondary"
          size="lg"
          block
          disabled={cooldown > 0}
          loading={busy === 'resend'}
          onClick={async () => {
            setBusy('resend');
            await services.auth.resendVerification(email).catch(() => undefined);
            setBusy(null);
            setCooldown(30);
            toast.success('Verification email sent');
          }}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
        </Button>
        {devTools && showDemoTools && (
          <Button
            variant="ghost"
            block
            onClick={() => {
              devTools?.simulateVerificationClick(email);
              toast.info('Link “clicked” (demo)', 'Now tap “I’ve verified my email”.');
            }}
          >
            Demo: simulate clicking the link
          </Button>
        )}
        <p className="text-center text-[13px] text-ink-muted">Didn’t receive it? Check your spam folder.</p>
        <Button variant="ghost" block onClick={() => void signOut().then(() => navigate(paths.login, { replace: true }))}>
          Use a different account
        </Button>
      </div>
    </AuthFrame>
  );
}

export function ForgotPasswordScreen() {
  const services = useServices();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = sent ? devTools?.latestResetToken() : null;
  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      {sent ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">If an account exists for {email}, a reset link is on its way. It expires in 1 hour and works once.</p>
          {showDemoTools && token && (
            <Link to={`/reset-password?token=${token}`} className="mt-4 block text-sm font-semibold text-brand-700">
              Demo: open the reset link
            </Link>
          )}
        </>
      ) : (
        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const v = forgotPasswordSchema.safeParse({ email });
            if (!v.success) return setError(toFieldErrors(v.error).email);
            setBusy(true);
            await services.auth.requestPasswordReset(email).catch(() => undefined);
            setBusy(false);
            setSent(true);
          }}
        >
          <TextField
            label="Email address"
            type="email"
            inputMode="email"
            className="h-12 text-base"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" size="lg" block loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to={paths.login} className="mt-6 block text-center text-sm font-semibold text-navy-800">
        Back to sign in
      </Link>
    </AuthFrame>
  );
}

export function ResetPasswordScreen() {
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame>
      <h1 className="text-2xl font-bold">Set a new password</h1>
      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const v = resetPasswordSchema.safeParse(form);
          if (!v.success) return setErrors(toFieldErrors(v.error));
          setBusy(true);
          try {
            await services.auth.resetPassword(token, form.password);
            toast.success('Password updated');
            navigate(paths.login, { replace: true });
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <PasswordField
          label="New password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          error={errors.password}
        />
        <PasswordField
          label="Confirm new password"
          value={form.confirmPassword}
          onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
          error={errors.confirmPassword}
        />
        <Button type="submit" size="lg" block loading={busy}>
          Update password
        </Button>
      </form>
    </AuthFrame>
  );
}
