'use client';

import { RequireAdmin } from '@bazarhq/ui';
import { AdminShell } from '@/components/admin/AdminShell';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <AdminShell>{children}</AdminShell>
    </RequireAdmin>
  );
}
