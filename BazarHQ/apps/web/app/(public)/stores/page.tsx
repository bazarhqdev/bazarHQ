'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoreSearch } from '@bazarhq/ui';

function Search() {
  const q = useSearchParams().get('q') ?? '';
  return <StoreSearch key={q} initial={q} />;
}

export default function StoresPage() {
  return (
    <>
      <title>Find a store · BazarHQ</title>
      <Suspense>
        <Search />
      </Suspense>
    </>
  );
}
