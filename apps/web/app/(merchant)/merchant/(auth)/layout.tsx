import { CheckCircle2 } from 'lucide-react';
import { BazarLogo } from '@bazarhq/ui';

const points = ['Your own store at yourname.bazarhq.com', 'bKash, Nagad, Rocket, SSLCommerz and COD', 'Orders, inventory and analytics in one place'];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-10 text-white lg:flex lg:flex-col">
        <BazarLogo tone="light" subtitle="Sell local · Grow together" />
        <div className="mt-auto max-w-md">
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight">Run your online store with confidence.</h2>
          <ul className="mt-6 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[15px] text-white/85">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-400" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 left-10 size-80 rounded-full bg-brand-400/10 blur-3xl" aria-hidden />
        <p className="mt-10 text-[12px] text-white/50">© {new Date().getFullYear()} BazarHQ · Merchant portal</p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <BazarLogo subtitle="Merchant portal" />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">{children}</div>
      </main>
    </div>
  );
}
