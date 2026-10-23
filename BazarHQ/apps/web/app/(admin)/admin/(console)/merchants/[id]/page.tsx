'use client';

import { useParams } from 'next/navigation';
import { MerchantDetailView } from '@bazarhq/ui';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Merchant · BazarHQ Admin</title>
      <MerchantDetailView id={id} />
    </>
  );
}
