import { defineConfig } from 'vitest/config';

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
 * with no config option feeding it). Every worker therefore died before it
 * could start, and the whole suite failed with
 * `[vitest-pool-runner]: Timeout waiting for worker to respond` — which reads as
 * a broken pool or a broken install, and is really a stopwatch. The second run
 * took 1.4s. See the *cold cache* note in CLAUDE.md.
 *
 * Since the 60s ceiling cannot be raised, the lever is to need jsdom less.
 * Measured when this was written, most files and most tests never touched a
 * DOM API (`docs/notes/testing.md` keeps the files that do). Those opt in
 * individually with a first-line
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
    /*
     * `.tsx` was added 2026-09-05 for the first component tests. It matters
     * more than it looks: the pattern was `*.test.ts` only, so a component test
     * written as `.test.tsx` is not "failing" — it is not collected at all, and
     * the suite reports the same green it did before the file existed. That is
     * the same silence the `src/**` scoping note below is about.
     */
    include: ['src/**/*.test.{ts,tsx}'],
    reporters: 'default',
    /**
     * Coverage, added 2026-08-27 (audit INV-004). `coverage/` was gitignored
     * from the start but no provider was ever installed, so the number could
     * not be produced at all.
     *
     * Excludes are the point of this block. Counting `App.tsx` and the
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
       *
       * `src/mcp/**` joined it on 2026-11-24 (the MCP work's wave 3, owner
       * decision OD8), for the reason src/server did: Forma's MCP server
       * holds security code (which folders a tool may touch, which path forms
       * it refuses, what reaches stdout), and leaving it out would have put
       * that code under no floor, so losing its tests would have left CI
       * green. Its logic lives in modules the tests import, and only the
       * entry is excluded below, `src/mcp/stdio.ts` and the launcher a host
       * runs, `src/mcp/run.mjs`: they run only in the process
       * `stdio.test.ts` spawns, which v8 coverage does not follow, so they
       * would read 0% while being exercised on every run. So is
       * `src/mcp/worker.mjs` (2026-11-24, the wave-4 review's REV4-3), the
       * worker thread the report tools' work runs in, which v8 coverage does
       * not follow either; the work it runs, `pipeline.ts`, is measured where
       * the tests run it in their own thread. So is `src/mcp/genWorker.mjs`
       * (2026-11-24, wave 8), the AI tools' worker thread, whose work,
       * `genJobs.ts`, the tests run in their own thread too. So are the
       * command line's entry and launcher, `src/mcp/cliEntry.ts` and
       * `src/mcp/cli.mjs` (2026-11-24, the CLI and Forma Designer work's
       * wave 4), which run only in the process `commandLine.test.ts` spawns; what
       * the command line does is `commandLine.ts`'s, which the tests call in their
       * own thread, and is measured. So are
       * `src/mcp/testFs.ts` and `src/mcp/testClient.ts` (2026-11-24), the
       * tests' in-memory file system and client: they are test code, which
       * the tests exercise in full, so counting them would raise the number
       * without measuring the server (finding T7 of the wave-3 review;
       * `boundaries.test.ts` fails if anything but a test imports them). So
       * is `src/lib/sqlFixtures.ts` (2026-11-24, the CLI and Forma Designer
       * work's wave 5, D1-12), the FormaSample captures the tests that read
       * a database layout share: test data, held to the same rule.
       */
      include: ['src/lib/**', 'src/services/**', 'src/server/**', 'src/mcp/**'],
      exclude: [
        '**/*.test.ts',
        // Loaders whose whole job is a dynamic import; there is nothing to
        // cover but the import itself. See PERF-001.
        'src/lib/genai.ts',
        // Design tokens, not logic.
        'src/lib/motion.ts',
        // The MCP server's entry, its launcher and its worker thread's, exercised only in a spawned process or thread (above).
        'src/mcp/stdio.ts',
        'src/mcp/run.mjs',
        'src/mcp/worker.mjs',
        'src/mcp/genWorker.mjs',
        // The command line's entry and launcher, exercised only in a spawned process (above).
        'src/mcp/cliEntry.ts',
        'src/mcp/cli.mjs',
        // The MCP tests' in-memory file system and client: test code, not the server's (above).
        'src/mcp/testFs.ts',
        'src/mcp/testClient.ts',
        // The database captures the layout tests share: test data, not code (above).
        'src/lib/sqlFixtures.ts',
      ],
      reporter: ['text-summary', 'text'],
      /*
       * Enforced since 2026-11-11 (the full audit, TC-11). Until then the
       * number was printed in every CI log and gated nothing, so a change that
       * dropped a module's tests passed green. CI's run of a76e367 read 88.65
       * statements, 81.09 branches, 90.4 functions and 90.33 lines; each floor
       * sits about two points under that, so ordinary churn does not trip it
       * and losing a tested module's cases does. Functions and lines were
       * planned at 89 and set at 88, because a local run of the same day read
       * 90.0 and 89.79, under a point clear of them. Raise a floor when the
       * number has risen and stayed; lowering one is a decision to write down
       * in the commit, never a way to get a red run green.
       */
      thresholds: { statements: 87, branches: 79, functions: 88, lines: 88 },
    },
  },
  /*
   * There is deliberately no `resolve.alias` block here.
   *
   * An `'@'` alias pointing at the repo root used to be declared in this file,
   * in `vite.config.ts` and in `tsconfig.json`'s `paths` — three declarations
   * with nothing checking they agreed, so changing one would have made the
   * tests and the build resolve `@` to different places, silently. Phase 3 of
   * the 2026-08-28 cleanup treated that as a duplication problem and looked for
   * somewhere to put a shared constant.
   *
   * The prior question went unasked until the end of the pass: **nothing was
   * using it.** Not one import in `src/`, `tests/`, `server.ts` or `scripts/`
   * referenced `@/anything` — every import in this project is relative. All
   * three declarations were removed on 2026-08-29.
   *
   * If path aliases are ever wanted, add them back to all three files in one
   * commit and use them. Commit 1e9b4e5 carries the full reasoning.
   */
});
