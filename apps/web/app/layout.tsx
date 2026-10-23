import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';
import { Providers } from '@/components/shared/Providers';

export const metadata: Metadata = {
  title: { default: 'BazarHQ — shop Bangladeshi stores', template: '%s · BazarHQ' },
  description: 'Find a BazarHQ store, shop its catalogue, pay with bKash, Nagad, Rocket, card or cash on delivery, and track your order.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1f3a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
