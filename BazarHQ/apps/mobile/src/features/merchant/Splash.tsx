import { BarChart3, Package, Users } from 'lucide-react';
import { BazarMark } from '@bazarhq/ui';

export function SplashScreen() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-between bg-gradient-to-b from-white to-brand-50 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))]"
      aria-label="BazarHQ Merchant is starting"
    >
      <div />
      <div className="flex flex-col items-center text-center">
        <BazarMark size={88} />
        <p className="mt-5 text-3xl font-extrabold tracking-tight text-navy-900">
          Bazar<span className="text-brand-600">HQ</span>
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-muted">Merchant App</p>
        <p className="mt-6 text-[15px] font-semibold text-navy-800">
          Your business. <span className="text-brand-700">Your own online store.</span>
        </p>
      </div>
      <ul className="grid w-full max-w-sm grid-cols-3 gap-2 text-center text-[12px] font-semibold text-ink-muted">
        {[
          [Package, 'List products easily'],
          [Users, 'Reach more customers'],
          [BarChart3, 'Grow your business'],
        ].map(([Icon, label]) => {
          const I = Icon as typeof Package;
          return (
            <li key={label as string} className="flex flex-col items-center gap-1.5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white text-brand-700 shadow-[var(--shadow-card)]">
                <I className="size-5" aria-hidden />
              </span>
              {label as string}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
