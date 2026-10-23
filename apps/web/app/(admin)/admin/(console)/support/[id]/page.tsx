'use client';

import { useParams } from 'next/navigation';
import { AdminTicketView } from '@bazarhq/ui';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <title>Ticket · BazarHQ Admin</title>
      <AdminTicketView id={id} />
    </>
  );
}
