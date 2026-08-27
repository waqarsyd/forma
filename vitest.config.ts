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
    /**
     * Coverage, added 2026-08-27 (audit INV-004). `coverage/` was gitignored
     * from the start but no provider was ever installed, so the number could
     * not be produced at all.
     *
     * Excludes are the point of this block. Counting `App.tsx` and the twenty
     * components in the denominator produces a number dominated by code that
     * *cannot* be unit-tested until the extraction in ARC-001 is much further
     * along — which makes the figure move for reasons unrelated to whether
     * anything got safer. What is measured here is the part that is
     * *supposed* to be covered: `lib/` and `services/`.
     *
     * The excluded surface is not forgotten, it is tracked as ARC-001 and as
     * "no component tests" in the audit. Do not quiet that by deleting these
     * lines — raise the number by shrinking `App.tsx`.
     *
     * **Two zeroes in the report are not what they look like.**
     * `src/lib/accountData.ts` reads 0% because everything that exercises it
     * lives in `tests/accountDeletion.test.ts`, which runs under
     * `vitest.rules.config.ts` against the emulator and is not in this run at
     * all. `src/services/firebase.ts` reads 0% because it is the Firebase
     * singleton: importing it initialises an app, and there is nothing in it
     * to unit-test. Neither is an untested path.
     */
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/services/**'],
      exclude: [
        '**/*.test.ts',
        // Loaders whose whole job is a dynamic import; there is nothing to
        // cover but the import itself. See PERF-001.
        'src/lib/genai.ts',
        // Design tokens, not logic.
        'src/lib/motion.ts',
      ],
      reporter: ['text-summary', 'text'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
