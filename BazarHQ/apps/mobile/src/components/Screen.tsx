import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import { cn } from '@bazarhq/ui';

const THRESHOLD = 70;

/** Pull-to-refresh for window-scrolled screens (touch only; a refresh button covers mouse/keyboard). */
export function PullToRefresh({ onRefresh, children }: { onRefresh?: () => Promise<unknown>; children: ReactNode }) {
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  if (!onRefresh) return <>{children}</>;

  const onStart = (e: TouchEvent) => {
    if (window.scrollY <= 0 && !refreshing) start.current = e.touches[0]?.clientY ?? null;
  };
  const onMove = (e: TouchEvent) => {
    if (start.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - start.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, 110) : 0);
  };
  const onEnd = async () => {
    const ready = pull >= THRESHOLD;
    start.current = null;
    setPull(ready ? 56 : 0);
    if (ready) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    }
  };

  return (
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={() => void onEnd()}>
      <div className="flex items-end justify-center overflow-hidden transition-[height] duration-150" style={{ height: pull }} aria-hidden={!refreshing}>
        <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-white shadow-[var(--shadow-card)]">
          {refreshing ? (
            <LoaderCircle className="size-4 animate-spin text-brand-600" aria-label="Refreshing" />
          ) : (
            <RefreshCw className="size-4 text-brand-600 transition-transform" style={{ transform: `rotate(${pull * 3}deg)` }} aria-hidden />
          )}
        </span>
      </div>
      {children}
    </div>
  );
}

export function TopBar({ title, back, actions, subtitle }: { title: ReactNode; back?: boolean | string; actions?: ReactNode; subtitle?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-14 items-center gap-1 px-2">
        {back ? (
          <button
            type="button"
            aria-label="Back"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            className="flex size-11 items-center justify-center rounded-full text-ink active:bg-navy-50"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-ink">{title}</h1>
          {subtitle && <p className="-mt-0.5 truncate text-[12px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-0.5 pr-1">{actions}</div>}
      </div>
    </header>
  );
}

export function Screen({
  title,
  subtitle,
  back,
  actions,
  onRefresh,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean | string;
  actions?: ReactNode;
  onRefresh?: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <TopBar title={title} subtitle={subtitle} back={back} actions={actions} />
      <PullToRefresh onRefresh={onRefresh}>
        <div className={cn('mx-auto w-full max-w-2xl px-4 py-4', className)}>{children}</div>
      </PullToRefresh>
    </>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
      <h2 className="text-[15px] font-bold text-ink">{children}</h2>
      {action}
    </div>
  );
}
