'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrackOrder } from '@bazarhq/ui';

function Track() {
  return <TrackOrder initialOrderNumber={useSearchParams().get('order') ?? ''} />;
}

export default function TrackPage() {
  return (
    <>
      <title>Track your order · BazarHQ</title>
      <Suspense>
        <Track />
      </Suspense>
    </>
  );
}
