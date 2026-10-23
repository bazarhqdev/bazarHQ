'use client';

import { AdminTotp } from '@bazarhq/ui';
import { getMockDevTools, showDemoTools } from '@/lib/services';

export default function AdminTotpPage() {
  const dev = showDemoTools ? getMockDevTools() : null;
  return (
    <>
      <title>Two-factor verification · BazarHQ Admin</title>
      <AdminTotp demoCode={dev?.demoTotpCode ?? null} />
    </>
  );
}
