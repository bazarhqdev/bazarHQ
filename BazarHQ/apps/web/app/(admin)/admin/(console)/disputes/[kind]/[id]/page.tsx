'use client';

import { useParams } from 'next/navigation';
import { AdminTicketView, ReturnDisputeView } from '@bazarhq/ui';

export default function Page() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  return (
    <>
      <title>Dispute · BazarHQ Admin</title>
      {kind === 'ticket' ? <AdminTicketView id={id} /> : <ReturnDisputeView id={id} />}
    </>
  );
}
