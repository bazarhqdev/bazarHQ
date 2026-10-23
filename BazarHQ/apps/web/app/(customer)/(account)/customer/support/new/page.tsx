'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { NewTicketForm } from '@bazarhq/ui';

function Form() {
  return <NewTicketForm orderId={useSearchParams().get('order') ?? undefined} />;
}

export default function NewTicketPage() {
  return (
    <>
      <title>New ticket · BazarHQ</title>
      <Suspense>
        <Form />
      </Suspense>
    </>
  );
}
