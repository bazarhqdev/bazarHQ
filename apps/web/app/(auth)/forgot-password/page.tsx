'use client';

import { Suspense } from 'react';
import { Alert, CustomerForgotPassword } from '@bazarhq/ui';
import { getMockDevTools, showDemoTools } from '@/lib/services';
import { usePasswordRecoveryLink } from '@/lib/use-password-recovery-link';

function Forgot() {
  const { ready, credential: token, error, attempted } = usePasswordRecoveryLink();
  const invalid = attempted ? error : null;
  const dev = showDemoTools ? getMockDevTools() : null;
  if (!ready) return <p role="status" className="text-sm text-ink-muted">Loading…</p>;
  return (
    <>
      {invalid && <Alert tone="danger" className="mb-4" title="Invalid reset link">{invalid}</Alert>}
      <CustomerForgotPassword token={token} demoLatestToken={dev ? () => dev.latestResetToken() : undefined} />
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <>
      <title>Reset password · BazarHQ</title>
      <Suspense>
        <Forgot />
      </Suspense>
    </>
  );
}
