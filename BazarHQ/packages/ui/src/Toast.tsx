'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from './cn';

/* -------------------------------- Toasts ------------------------------ */

type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  show(t: Omit<ToastItem, 'id'>): void;
  success(title: string, description?: string): void;
  error(title: string, description?: string): void;
  info(title: string, description?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children, placement = 'bottom-right' }: { children: ReactNode; placement?: 'bottom-right' | 'top-center' }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ tone: 'success', title, description }),
      error: (title, description) => show({ tone: 'error', title, description }),
      info: (title, description) => show({ tone: 'info', title, description }),
    }),
    [show],
  );
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: 'text-brand-600', error: 'text-red-600', info: 'text-sky-600', warning: 'text-amber-600' };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed z-[60] flex w-full max-w-sm flex-col gap-2 px-4',
          placement === 'bottom-right' ? 'bottom-4 right-0 sm:right-4' : 'left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] -translate-x-1/2',
        )}
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex animate-slide-up gap-3 rounded-xl border border-line bg-white p-3.5 shadow-[var(--shadow-pop)]"
            >
              <Icon className={cn('mt-0.5 size-5 shrink-0', colors[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-ink-muted">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="self-start rounded p-0.5 text-ink-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
