'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SslCommerzSandbox } from '@bazarhq/ui';

function Sandbox() {
  return <SslCommerzSandbox token={useSearchParams().get('session') ?? ''} />;
}

export default function SslCommerzSandboxPage() {
  return (
    <>
      <title>SSLCommerz sandbox</title>
      <Suspense>
        <Sandbox />
      </Suspense>
    </>
  );
}
