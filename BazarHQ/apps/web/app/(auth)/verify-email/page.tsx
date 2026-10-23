'use client';

import { CustomerVerifyEmail } from '@bazarhq/ui';
import { getMockDevTools, showDemoTools } from '@/lib/services';

export default function VerifyEmailPage() {
  const dev = showDemoTools ? getMockDevTools() : null;
  return (
    <>
      <title>Verify your email · BazarHQ</title>
      <CustomerVerifyEmail onSimulateClick={dev ? (email) => dev.simulateVerificationClick(email) : undefined} />
    </>
  );
}
