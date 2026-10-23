'use client';

import { useParams } from 'next/navigation';
import { CustomerReturnView } from '@bazarhq/ui';

export default function ReturnPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Return · BazarHQ</title>
      <CustomerReturnView id={id} />
    </>
  );
}
