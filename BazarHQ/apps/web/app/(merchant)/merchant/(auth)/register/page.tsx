'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { errorMessage, isServiceError, passwordRuleChecks, registerSchema, toFieldErrors, type FieldErrors } from '@bazarhq/shared';
import { Alert, Button, cn, TextField, useServices, useSession } from '@bazarhq/ui';
import { Divider, GoogleButton, PasswordField } from '@/components/shared/auth';
import { paths } from '@/lib/paths';

export default function RegisterPage() {
  const services = useServices();
  const { refresh, setSession } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [touchedPassword, setTouchedPassword] = useState(false);

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = registerSchema.safeParse(form);
    if (!v.success) {
      setErrors(toFieldErrors(v.error));
      setTouchedPassword(true);
      return;
    }
    setBusy('email');
    try {
      await services.auth.register({ fullName: form.fullName, email: form.email, password: form.password });
      await refresh();
      router.replace(paths.verifyEmail);
    } catch (err) {
      if (isServiceError(err) && err.fieldErrors) setErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    try {
      const s = await services.auth.signInWithGoogle();
      setSession(s);
      router.replace(s.store ? paths.dashboard : paths.onboarding);
    } catch (err) {
      setError(`${errorMessage(err)} You can still register with email and password.`);
      setBusy(null);
    }
  };

  const rules = passwordRuleChecks(form.password);

  return (
    <>
      <title>Create account · BazarHQ Merchant</title>
      <h1 className="text-2xl font-bold tracking-tight text-ink">Create your merchant account</h1>
      <p className="mt-1 text-sm text-ink-muted">Start selling online with your own BazarHQ store.</p>

      <form onSubmit={submit} noValidate className="mt-7 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label="Full name"
          autoComplete="name"
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          error={errors.fullName}
          required
        />
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          required
        />
        <div>
          <PasswordField
            label="Password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => {
              set('password', e.target.value);
              setTouchedPassword(true);
            }}
            error={errors.password}
            required
            aria-describedby="password-rules"
          />
          {/* FR-M-01: highlight violated rules before submission */}
          <ul id="password-rules" className="mt-2 space-y-1" aria-label="Password requirements">
            {rules.map((r) => (
              <li
                key={r.label}
                className={cn('flex items-center gap-1.5 text-[12.5px]', r.ok ? 'text-brand-700' : touchedPassword ? 'text-red-700' : 'text-ink-subtle')}
              >
                {r.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                {r.label}
                <span className="sr-only">{r.ok ? '(met)' : '(not met)'}</span>
              </li>
            ))}
          </ul>
        </div>
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => set('confirmPassword', e.target.value)}
          error={errors.confirmPassword}
          required
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy === 'email'} disabled={busy === 'google'}>
          Create account
        </Button>
        <Divider />
        <GoogleButton onClick={() => void google()} loading={busy === 'google'} label="Sign up with Google" />
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href={paths.login} className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
