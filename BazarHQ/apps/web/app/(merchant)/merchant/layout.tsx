import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'BazarHQ Merchant', template: '%s · BazarHQ Merchant' },
  robots: { index: false, follow: false },
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
