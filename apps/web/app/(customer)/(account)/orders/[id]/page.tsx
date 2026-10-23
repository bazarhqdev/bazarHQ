'use client';

import { useParams } from 'next/navigation';
import { CustomerOrderView } from '@bazarhq/ui';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Order · BazarHQ</title>
      <CustomerOrderView id={id} />
    </>
  );
}
