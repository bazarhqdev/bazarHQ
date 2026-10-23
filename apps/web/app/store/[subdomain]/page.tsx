'use client';

import { StoreHome, useStore } from '@bazarhq/ui';

export default function StoreHomePage() {
  const store = useStore();
  return (
    <>
      <title>{`${store.name} · BazarHQ`}</title>
      <StoreHome />
    </>
  );
}
