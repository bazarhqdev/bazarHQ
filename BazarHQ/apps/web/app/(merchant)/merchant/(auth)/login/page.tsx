'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { errorMessage, isServiceError, loginSchema, toFieldErrors, type FieldErrors, type Session } from '@bazarhq/shared';
import { Alert, Button, TextField, useServices, useSession, useToast } from '@bazarhq/ui';
import { DemoAccounts, Divider, GoogleButton, PasswordField } from '@/components/shared/auth';
import { paths } from '@/lib/paths';
import { showDemoTools } from '@/lib/services';

function routeAfterLogin(s: Session, next: string | null): string {
  if (s.user.role === 'merchant' && !s.user.emailVerified) return paths.verifyEmail;
  if (s.user.role === 'merchant' && !s.store) return paths.onboarding;
  return next && next.startsWith('/merchant/') ? next : paths.dashboard;
}

function LoginForm() {
  const services = useServices();
  const toast = useToast();
  const { session, status, setSession } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState<'password' | 'google' | 'resend' | null>(null);

  useEffect(() => {
    if (status === 'ready' && session && session.user.role === 'merchant' && session.user.emailVerified) {
      router.replace(routeAfterLogin(session, next));
    }
  }, [status, session, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = loginSchema.safeParse({ email, password });
    if (!v.success) return setErrors(toFieldErrors(v.error));
    setErrors({});
    setBusy('password');
    try {
      const s = await services.auth.signIn(email, password);
      setSession(s);
      router.replace(routeAfterLogin(s, next));
    } catch (err) {
      const tone = isServiceError(err) && (err.code === 'LOCKED' || err.code === 'SUSPENDED') ? 'warning' : 'danger';
      setError({ tone, text: errorMessage(err) });
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      const s = await services.auth.signInWithGoogle();
      setSession(s);
      router.replace(routeAfterLogin(s, next));
    } catch (err) {
      setError({ tone: 'danger', text: `${errorMessage(err)} You can still sign in with email and password.` });
      setBusy(null);
    }
  };

  const resend = async () => {
    const v = loginSchema.shape.email.safeParse(email);
    if (!v.success) return setErrors({ email: 'Enter your email above, then tap resend.' });
    setBusy('resend');
    try {
      await services.auth.resendVerification(email);
      toast.success('Verification email sent', `If ${email} has an unverified account, a new link is on its way.`);
    } catch (err) {
      toast.error('Couldn’t resend', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <title>Sign in · BazarHQ Merchant</title>
      <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-muted">Sign in to manage your BazarHQ store.</p>

      <form onSubmit={submit} noValidate className="mt-7 space-y-4">
        {error && <Alert tone={error.tone}>{error.text}</Alert>}
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
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
          labelAction={
            <Link href={paths.forgotPassword} className="text-[13px] font-semibold text-brand-700 hover:underline">
              Forgot password?
            </Link>
          }
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy === 'password'} disabled={busy !== null && busy !== 'password'}>
          Sign in
        </Button>
        <Divider />
        <GoogleButton onClick={() => void google()} loading={busy === 'google'} />
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to BazarHQ?{' '}
        <Link href={paths.register} className="font-semibold text-brand-700 hover:underline">
          Create a merchant account
        </Link>
      </p>
      <p className="mt-2 text-center text-[13px] text-ink-muted">
        Didn’t get your verification email?{' '}
        <button
          type="button"
          className="font-semibold text-navy-800 underline-offset-2 hover:underline"
          onClick={() => void resend()}
          disabled={busy === 'resend'}
        >
          Resend it
        </button>
      </p>
      {showDemoTools && (
        <DemoAccounts
          onPick={(e, p) => {
            setEmail(e);
            setPassword(p);
            setErrors({});
          }}
        />
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
