import { MerchantGuard } from '@/components/merchant/MerchantGuard';
import { PortalShell } from '@/components/merchant/PortalShell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <MerchantGuard>
      <PortalShell>{children}</PortalShell>
    </MerchantGuard>
  );
}
