'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { errorMessage } from '@bazarhq/shared';
import { Alert, Button, Spinner, useServices, useSession, useToast } from '@bazarhq/ui';
import { paths } from '@/lib/paths';
import { getMockDevTools, showDemoTools } from '@/lib/services';

export default function VerifyEmailPage() {
  const services = useServices();
  const toast = useToast();
  const { session, status, setSession, signOut } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<'check' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const dev = getMockDevTools();

  useEffect(() => {
    if (status !== 'ready') return;
    if (!session) router.replace(paths.login);
    else if (session.user.emailVerified) router.replace(session.store ? paths.dashboard : paths.onboarding);
  }, [status, session, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (status === 'loading' || !session || session.user.emailVerified) {
    return <Spinner label="Loading" />;
  }
  const email = session.user.email;

  const check = async () => {
    setBusy('check');
    setError(null);
    try {
      const s = await services.auth.refreshVerification();
      setSession(s);
      toast.success('Email verified', 'Welcome to BazarHQ! Let’s set up your store.');
      router.replace(s.store ? paths.dashboard : paths.onboarding);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy('resend');
    try {
      await services.auth.resendVerification(email);
      setCooldown(30);
      toast.success('Verification email sent', `Check ${email}.`);
    } catch (e) {
      toast.error('Couldn’t resend', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="text-center">
      <title>Verify your email · BazarHQ Merchant</title>
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <MailCheck className="size-8" aria-hidden />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">Check your email</h1>
      <p className="mt-2 text-sm text-ink-muted">
        We sent a verification link to <strong className="text-ink">{email}</strong>. Open it to activate your merchant account. The dashboard stays locked
        until your email is verified.
      </p>
      <div className="mt-6 space-y-3 text-left">
        {error && <Alert tone="warning">{error}</Alert>}
        <Button variant="primary" size="lg" block loading={busy === 'check'} onClick={() => void check()}>
          I’ve verified my email
        </Button>
        <Button variant="secondary" size="lg" block loading={busy === 'resend'} disabled={cooldown > 0} onClick={() => void resend()}>
          {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend verification email'}
        </Button>
      </div>
      <p className="mt-4 text-[13px] text-ink-muted">Can’t find it? Check your spam or promotions folder.</p>
      {dev && showDemoTools && (
        <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-white p-3 text-left text-[13px]">
          <p className="font-semibold text-ink">Demo mode</p>
          <p className="text-ink-muted">No real email is sent. Simulate clicking the link, then press “I’ve verified my email”.</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              dev.simulateVerificationClick(email);
              toast.info('Verification link “clicked”', 'Now press “I’ve verified my email”.');
            }}
          >
            Simulate clicking the email link
          </Button>
        </div>
      )}
      <p className="mt-6 text-sm text-ink-muted">
        Wrong account?{' '}
        <Link
          href={paths.login}
          className="font-semibold text-brand-700 hover:underline"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Link>
      </p>
    </div>
  );
}
