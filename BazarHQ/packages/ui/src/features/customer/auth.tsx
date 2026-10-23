'use client';

/**
 * Customer sign-in / sign-up / verification / password reset (FR-C-30,
 * AUTH-*). Roles are always assigned by the server; this UI only says which
 * signup flow is being used.
 */
import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { customerRegisterSchema, errorMessage, forgotPasswordSchema, isServiceError, loginSchema, resetPasswordSchema, type Session } from '@bazarhq/shared';
import { BazarLogo } from '../../brand';
import { Alert, Button, IconButton, TextField, useToast, type TextFieldProps } from '../../components';
import { useCustomerPaths, useNavigation, useServices, useSession } from '../../context';
import { applyServerErrors, useZodForm } from '../../form';

export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'suffix'>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      ref={ref}
      {...props}
      type={show ? 'text' : 'password'}
      suffix={
        <IconButton label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} className="size-8">
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </IconButton>
      }
    />
  );
});

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.8 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

function Or() {
  return (
    <div className="flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle" role="separator">
      <span className="h-px flex-1 bg-line-strong" />
      or
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  );
}

export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  return (
    <main className="flex min-h-dvh flex-col items-center bg-canvas px-4 py-10">
      <Link href={p.home} aria-label="BazarHQ home">
        <BazarLogo />
      </Link>
      <div className="mt-8 w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 w-full max-w-md text-center text-sm text-ink-muted">{footer}</div>}
    </main>
  );
}

export interface DemoAccount {
  email: string;
  password: string;
  note: string;
}

export function CustomerLogin({
  next,
  routeAfter,
  demoAccounts,
}: {
  next?: string | null;
  routeAfter: (s: Session, next?: string | null) => string;
  demoAccounts?: DemoAccount[];
}) {
  const services = useServices();
  const { session, status, setSession } = useSession();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const [error, setError] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [google, setGoogle] = useState(false);
  const form = useZodForm(loginSchema, { email: '', password: '' });

  useEffect(() => {
    if (status === 'ready' && session && session.user.emailVerified) navigate(routeAfter(session, next), { replace: true });
  }, [status, session, next, navigate, routeAfter]);

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const s = await services.auth.signIn(email, password);
      setSession(s);
      navigate(s.user.emailVerified ? routeAfter(s, next) : p.verifyEmail, { replace: true });
    } catch (err) {
      setError({ tone: isServiceError(err) && (err.code === 'LOCKED' || err.code === 'SUSPENDED') ? 'warning' : 'danger', text: errorMessage(err) });
    }
  });

  return (
    <AuthCard
      title="Sign in to BazarHQ"
      description="Track orders, request returns and check out faster with saved addresses."
      footer={
        <>
          New here?{' '}
          <Link href={p.register} className="font-semibold text-brand-700 hover:underline">
            Create an account
          </Link>{' '}
          · You can also check out as a guest.
          <p className="mt-2">
            Selling on BazarHQ?{' '}
            <Link href={p.merchantLogin} className="font-semibold text-navy-800 hover:underline">
              Merchant sign in
            </Link>
          </p>
        </>
      }
    >
      {error && (
        <Alert tone={error.tone} className="mb-4">
          {error.text}
        </Alert>
      )}
      <Button
        variant="secondary"
        block
        size="lg"
        loading={google}
        icon={<GoogleGlyph />}
        onClick={async () => {
          setGoogle(true);
          try {
            const s = await services.auth.signInWithGoogle('customer');
            setSession(s);
            navigate(routeAfter(s, next), { replace: true });
          } catch (err) {
            setError({ tone: 'danger', text: `${errorMessage(err)} You can still sign in with email and password.` });
            setGoogle(false);
          }
        }}
      >
        Continue with Google
      </Button>
      <div className="my-5">
        <Or />
      </div>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          labelAction={
            <Link href={p.forgotPassword} className="text-[13px] font-semibold text-brand-700 hover:underline">
              Forgot password?
            </Link>
          }
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      {demoAccounts && demoAccounts.length > 0 && (
        <details className="mt-6 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Demo accounts (mock data)</summary>
          <ul className="mt-2 space-y-1">
            {demoAccounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas"
                  onClick={() => {
                    form.setValue('email', a.email);
                    form.setValue('password', a.password);
                  }}
                >
                  <span className="block font-semibold text-navy-800">{a.email}</span>
                  <span className="block text-[12px] text-ink-muted">
                    {a.note} · <code className="rounded bg-canvas px-1">{a.password}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </AuthCard>
  );
}

export function CustomerRegister() {
  const services = useServices();
  const { refresh } = useSession();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(customerRegisterSchema, { fullName: '', email: '', password: '', confirmPassword: '' });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await services.auth.register({ fullName: v.fullName, email: v.email, password: v.password, accountType: 'customer' });
      await refresh();
      navigate(p.verifyEmail, { replace: true });
    } catch (err) {
      if (!applyServerErrors(form, err)) setError(errorMessage(err));
    }
  });
  return (
    <AuthCard
      title="Create your account"
      description="Free for shoppers. We’ll email you a link to verify your address."
      footer={
        <>
          Already have an account?{' '}
          <Link href={p.login()} className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Full name" autoComplete="name" required {...form.register('fullName')} error={form.formState.errors.fullName?.message} />
        <TextField label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, including a number."
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          required
          {...form.register('confirmPassword')}
          error={form.formState.errors.confirmPassword?.message}
        />
        <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-[12px] text-ink-subtle">
          By continuing you agree to the{' '}
          <Link href={p.policy('tos')} className="underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href={p.policy('privacy')} className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
}

export function CustomerVerifyEmail({ onSimulateClick }: { onSimulateClick?: (email: string) => void }) {
  const services = useServices();
  const toast = useToast();
  const { session, setSession } = useSession();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const [busy, setBusy] = useState<'check' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const email = session?.user.email ?? '';
  return (
    <AuthCard
      title="Verify your email"
      description={
        email ? (
          <>
            We sent a link to <strong>{email}</strong>. Open it to activate your account.
          </>
        ) : (
          'Open the link we emailed you to activate your account.'
        )
      }
    >
      <div className="flex justify-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <MailCheck className="size-7" aria-hidden />
        </span>
      </div>
      {error && (
        <Alert tone="warning" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-5 space-y-2">
        <Button
          block
          size="lg"
          loading={busy === 'check'}
          onClick={async () => {
            setBusy('check');
            setError(null);
            try {
              const s = await services.auth.refreshVerification();
              setSession(s);
              toast.success('Email verified', 'Welcome to BazarHQ.');
              navigate(p.account, { replace: true });
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(null);
            }
          }}
        >
          I’ve verified my email
        </Button>
        <Button
          block
          variant="secondary"
          loading={busy === 'resend'}
          disabled={!email}
          onClick={async () => {
            setBusy('resend');
            try {
              await services.auth.resendVerification(email);
              toast.success('Verification email sent');
            } catch (err) {
              toast.error('Couldn’t resend', errorMessage(err));
            } finally {
              setBusy(null);
            }
          }}
        >
          Resend email
        </Button>
        {onSimulateClick && email && (
          <button
            type="button"
            onClick={() => onSimulateClick(email)}
            className="w-full rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] font-semibold text-ink-muted hover:bg-canvas"
          >
            Demo: simulate clicking the email link
          </button>
        )}
      </div>
      <p className="mt-5 text-center text-sm">
        <Link href={p.home} className="font-semibold text-ink-muted hover:text-ink">
          Continue browsing stores
        </Link>
      </p>
    </AuthCard>
  );
}

export function CustomerForgotPassword({ token, demoLatestToken }: { token?: string | null; demoLatestToken?: () => string | null }) {
  const services = useServices();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestForm = useZodForm(forgotPasswordSchema, { email: '' });
  const resetForm = useZodForm(resetPasswordSchema, { password: '', confirmPassword: '' });

  if (token) {
    const submit = resetForm.handleSubmit(async (v) => {
      setError(null);
      try {
        await services.auth.resetPassword(token, v.password);
        navigate(p.login(), { replace: true });
      } catch (err) {
        if (!applyServerErrors(resetForm, err)) setError(errorMessage(err));
      }
    });
    return (
      <AuthCard title="Choose a new password" description="Signing in again on all your devices will be required.">
        {error && (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        )}
        <form onSubmit={submit} noValidate className="space-y-4">
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            required
            hint="At least 8 characters, including a number."
            {...resetForm.register('password')}
            error={resetForm.formState.errors.password?.message}
          />
          <PasswordInput
            label="Confirm password"
            autoComplete="new-password"
            required
            {...resetForm.register('confirmPassword')}
            error={resetForm.formState.errors.confirmPassword?.message}
          />
          <Button type="submit" block size="lg" loading={resetForm.formState.isSubmitting}>
            Set password
          </Button>
        </form>
      </AuthCard>
    );
  }

  const submit = requestForm.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await services.auth.requestPasswordReset(email);
      setSent(email);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  const demoToken = sent && demoLatestToken ? demoLatestToken() : null;
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email. If it exists, we’ll send a reset link valid for 1 hour."
      footer={
        <Link href={p.login()} className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If {sent} has an account, a reset link is on its way.
          {demoToken && (
            <span className="mt-2 block">
              Demo:{' '}
              <Link href={`${p.forgotPassword}?token=${demoToken}`} className="font-semibold underline">
                open the reset link
              </Link>
            </span>
          )}
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            {...requestForm.register('email')}
            error={requestForm.formState.errors.email?.message}
          />
          <Button type="submit" block size="lg" loading={requestForm.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
