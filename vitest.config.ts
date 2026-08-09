import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Kept separate from vite.config.ts on purpose: that file carries the HMR block
 * marked "Do not modify", and the dev server imports it. Nothing here touches
 * the app's own build.
 *
 * jsdom is required rather than optional — `checkRepx` uses DOMParser, which is
 * a browser API the app genuinely depends on.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    reporters: 'default',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
