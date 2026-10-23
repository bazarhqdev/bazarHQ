'use client';

import { useEffect } from 'react';
import { Card, ErrorState } from '@bazarhq/ui';

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Technical details go to the console/monitoring, never to the merchant (NFR-U-01).
    console.error(error);
  }, [error]);
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <ErrorState message="Something went wrong while showing this page. Your data is safe — try again." onRetry={reset} />
    </Card>
  );
}
