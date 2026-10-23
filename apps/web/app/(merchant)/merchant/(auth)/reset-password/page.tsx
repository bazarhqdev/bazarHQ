'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { errorMessage, resetPasswordSchema, toFieldErrors, type FieldErrors } from '@bazarhq/shared';
import { Alert, Button, useServices, useToast } from '@bazarhq/ui';
import { PasswordField } from '@/components/shared/auth';
import { paths } from '@/lib/paths';

function ResetForm() {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = resetPasswordSchema.safeParse(form);
    if (!v.success) return setErrors(toFieldErrors(v.error));
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await services.auth.resetPassword(token, form.password);
      toast.success('Password updated', 'Sign in with your new password. Other sessions were signed out.');
      router.replace(paths.login);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Alert tone="danger" title="Invalid reset link">
        This link is missing its token.{' '}
        <Link href={paths.forgotPassword} className="font-semibold underline">
          Request a new one
        </Link>
        .
      </Alert>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-ink">Set a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">At least 8 characters, including a number.</p>
      <form onSubmit={submit} noValidate className="mt-7 space-y-4">
        {error && (
          <Alert tone="danger">
            {error}{' '}
            <Link href={paths.forgotPassword} className="font-semibold underline">
              Request a new link
            </Link>
          </Alert>
        )}
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          error={errors.password}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
          error={errors.confirmPassword}
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Update password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <title>Set new password · BazarHQ Merchant</title>
      <ResetForm />
    </Suspense>
  );
}
