import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Separate SPA build for Capacitor (SRS §7.3 / MOB-02): output goes to dist/,
// which capacitor.config.ts uses as webDir.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    // The bundle ships inside the APK and loads from local storage, not the network.
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173 },
});
