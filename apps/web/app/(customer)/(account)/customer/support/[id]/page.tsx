'use client';

import { useParams } from 'next/navigation';
import { CustomerTicketView } from '@bazarhq/ui';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Ticket · BazarHQ</title>
      <CustomerTicketView id={id} />
    </>
  );
}
