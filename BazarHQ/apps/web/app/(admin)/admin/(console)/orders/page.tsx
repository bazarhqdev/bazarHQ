'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminOrdersView } from '@bazarhq/ui';

function Orders() {
  return <AdminOrdersView storeId={useSearchParams().get('store') ?? undefined} />;
}

export default function Page() {
  return (
    <>
      <title>Orders · BazarHQ Admin</title>
      <Suspense>
        <Orders />
      </Suspense>
    </>
  );
}
