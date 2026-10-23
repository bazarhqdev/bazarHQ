'use client';

import { useParams } from 'next/navigation';
import { CustomerDetailView } from '@bazarhq/ui';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Customer · BazarHQ Admin</title>
      <CustomerDetailView id={id} />
    </>
  );
}
