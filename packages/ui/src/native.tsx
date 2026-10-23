'use client';

/**
 * Optional native capabilities injected by the Android shell (Capacitor
 * Camera / Filesystem / Share). On the web every hook falls back to the
 * browser equivalent, so shared screens work in both apps unchanged.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { downloadText } from './files';

export interface NativeCapabilities {
  /** Opens the camera or photo library (the OS asks for permission at this moment). Resolves null when cancelled. */
  pickImage?: () => Promise<File | null>;
  /** Writes a text file (e.g. a CSV export) to app documents and opens the share sheet. */
  saveText?: (filename: string, text: string, mime: string) => Promise<void>;
  /** Opens an external page (e.g. the SSLCommerz gateway) in an in-app browser tab (Custom Tab on Android). */
  openUrl?: (url: string) => Promise<void>;
}

const NativeContext = createContext<NativeCapabilities>({});

export function NativeProvider({ value, children }: { value: NativeCapabilities; children: ReactNode }) {
  return <NativeContext.Provider value={value}>{children}</NativeContext.Provider>;
}

export function useNative(): NativeCapabilities {
  return useContext(NativeContext);
}

export function useSaveText() {
  const native = useNative();
  return useCallback(
    async (filename: string, text: string, mime = 'text/csv;charset=utf-8') => {
      if (native.saveText) await native.saveText(filename, text, mime);
      else downloadText(filename, text, mime);
    },
    [native],
  );
}
