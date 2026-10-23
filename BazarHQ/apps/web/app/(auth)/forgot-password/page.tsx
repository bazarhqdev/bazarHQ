'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomerForgotPassword } from '@bazarhq/ui';
import { getMockDevTools, showDemoTools } from '@/lib/services';

function Forgot() {
  const token = useSearchParams().get('token');
  const dev = showDemoTools ? getMockDevTools() : null;
  return <CustomerForgotPassword token={token} demoLatestToken={dev ? () => dev.latestResetToken() : undefined} />;
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
