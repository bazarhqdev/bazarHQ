'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { errorMessage, forgotPasswordSchema, toFieldErrors, type FieldErrors } from '@bazarhq/shared';
import { Alert, Button, TextField, useServices } from '@bazarhq/ui';
import { paths } from '@/lib/paths';
import { getMockDevTools, showDemoTools } from '@/lib/services';

export default function ForgotPasswordPage() {
  const services = useServices();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dev = getMockDevTools();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = forgotPasswordSchema.safeParse({ email });
    if (!v.success) return setErrors(toFieldErrors(v.error));
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await services.auth.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const token = sent ? dev?.latestResetToken() : null;

  return (
    <>
      <title>Reset password · BazarHQ Merchant</title>
      <Link href={paths.login} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </Link>
      {sent ? (
        <div>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">Check your inbox</h1>
          <p className="mt-2 text-sm text-ink-muted">
            If an account exists for <strong className="text-ink">{email}</strong>, we’ve sent a password reset link. It can be used once and expires in 1 hour.
          </p>
          {showDemoTools && token && (
            <Alert tone="info" className="mt-5" title="Demo mode">
              No email is sent.{' '}
              <Link href={`/merchant/reset-password?token=${token}`} className="font-semibold underline">
                Open the reset link
              </Link>
            </Alert>
          )}
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Forgot your password?</h1>
          <p className="mt-1 text-sm text-ink-muted">Enter your account email and we’ll send you a reset link.</p>
          <form onSubmit={submit} noValidate className="mt-7 space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextField label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              Send reset link
            </Button>
          </form>
        </>
      )}
    </>
  );
}
