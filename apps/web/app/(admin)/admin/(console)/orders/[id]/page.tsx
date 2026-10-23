'use client';

import { useParams } from 'next/navigation';
import { AdminOrderDetailView } from '@bazarhq/ui';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Order · BazarHQ Admin</title>
      <AdminOrderDetailView id={id} />
    </>
  );
}
