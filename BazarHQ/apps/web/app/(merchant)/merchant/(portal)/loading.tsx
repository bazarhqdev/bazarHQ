import { Skeleton } from '@bazarhq/ui';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
