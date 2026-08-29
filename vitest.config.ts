import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Kept separate from vite.config.ts on purpose: that file carries the HMR block
 * marked "Do not modify", and the dev server imports it. Nothing here touches
 * the app's own build.
 *
 * **The default environment is `node`, and that is load-bearing.** It was
 * `jsdom` for every file until 2026-08-28. jsdom's entry loads synchronously and
 * costs ~1.4s warm, but on a cold OS file cache it was measured at **113
 * seconds** in a single process on the development machine — and vitest gives a
 * worker 60 seconds to report in (`START_TIMEOUT`, hardcoded in vitest's dist,
 * with no config option feeding it). Every one of the 25 workers therefore died
 * before it could start, and the whole suite failed with
 * `[vitest-pool-runner]: Timeout waiting for worker to respond` — which reads as
 * a broken pool or a broken install, and is really a stopwatch. The second run
 * took 1.4s. See the *cold cache* note in CLAUDE.md.
 *
 * Since the 60s ceiling cannot be raised, the lever is to need jsdom less.
 * Measured: 20 of the 25 files and 363 of the 409 tests never touch a DOM API.
 * The five that do opt in individually with a first-line
 * `// @vitest-environment jsdom`, which is honoured per file and overrides both
 * this setting and a `--environment` flag on the command line.
 *
 * Do not "simplify" this back to a global `environment: 'jsdom'`. It costs
 * ~66s of environment setup summed across workers where this costs ~6ms, and it
 * puts every worker back behind the same 60s cliff.
 *
 * Adding a test that needs `document`, `DOMParser`, `localStorage`,
 * `sessionStorage`, `crypto.subtle`, `history` or `location`? Put the pragma on
 * line 1 of that file. Forgetting is safe: it fails loudly with a
 * `... is not defined` rather than passing on a half-real global.
 */
export default defineConfig({
  test: {
    // Per-file opt-in via `// @vitest-environment jsdom`; see the note above.
    environment: 'node',
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
      /**
       * `src/server/**` joined this list on 2026-08-29, when `securityHeaders`
       * and `bindHost` moved out of `src/lib` into their own directory. They
       * had always been in the denominator; leaving them out of the new path
       * would have quietly *raised* the coverage number by removing two
       * well-covered modules from it, which is the opposite of what a number
       * like this is for. It is also the wrong two files to stop measuring —
       * one sets the CSP and the other decides whether Express listens on
       * loopback or on every interface.
       */
      include: ['src/lib/**', 'src/services/**', 'src/server/**'],
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
  /**
   * Declared in THREE files with nothing checking they agree: here,
   * `tsconfig.json` (as `paths`) and `vite.config.ts`. Change one and the tests
   * and the build resolve `@` to different places — silently, because each
   * config remains individually valid and every tool still reports success.
   *
   * It is not collapsed into a shared constant because that needs a new
   * root-level file, and Phase 7 was reducing the root rather than adding to it;
   * `vitest.config.ts` importing from `vite.config.ts` would also couple the
   * test config to the file carrying the "Do not modify" HMR block, which is
   * precisely what this file's separation exists to avoid. See
   * docs/cleanup/03-duplicates.md §3.4.
   *
   * **If you edit this, edit the other two.**
   *
   * One fact that decides what to do about it, and which the Phase 3 analysis
   * missed by studying the triplication without asking the prior question:
   * **the alias has zero usages.** As of 2026-08-29 nothing in `src/`, `tests/`,
   * `server.ts` or `scripts/` imports `@/anything` — every import is relative.
   * So the real choice is to adopt it or to delete all three declarations, not
   * to keep three configs in agreement about a path nobody takes.
   */
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
