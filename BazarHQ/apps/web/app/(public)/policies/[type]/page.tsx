'use client';

import { useParams } from 'next/navigation';
import { PolicyView } from '@bazarhq/ui';
import NotFound from '@/app/not-found';

export default function PolicyPage() {
  const { type } = useParams<{ type: string }>();
  if (type !== 'tos' && type !== 'privacy') return <NotFound />;
  return (
    <>
      <title>{type === 'tos' ? 'Terms of Service · BazarHQ' : 'Privacy Policy · BazarHQ'}</title>
      <PolicyView type={type} />
    </>
  );
}
