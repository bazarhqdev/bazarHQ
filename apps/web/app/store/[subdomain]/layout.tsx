'use client';

import { useParams } from 'next/navigation';
import { StoreShell } from '@bazarhq/ui';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const { subdomain } = useParams<{ subdomain: string }>();
  return <StoreShell subdomain={subdomain.toLowerCase()}>{children}</StoreShell>;
}
