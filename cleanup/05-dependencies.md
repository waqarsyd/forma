# Phase 5 - Dependency diet

Date: 2026-08-28
Branch: `chore/cleanup`

**SAFE 0 / UNSURE 1 / KEEP 26.** Nothing was removed, because **there is nothing to
remove**: all 26 declared dependencies are used, correctly classified, non-overlapping,
and imported in the tree-shakeable form.

The prompt pack calls this phase "usually the biggest single weight win." On this
repository it is a second consecutive phase where that expectation does not hold, and
saying so plainly is more useful than manufacturing a result. What the phase *did*
produce is three things worth having: a measured decomposition of the 1.12 MB entry
chunk, a security picture in which none of the six advisories is reachable, and the
discovery that **`npm audit fix --force` would silently downgrade `firebase-tools` by a
major version.**

---

## 5.1 Unused dependencies: none

A substring grep is worthless here - `vite` matches `vitest` and `vite-env`, `tsx`
matches every `.tsx` path, `express` matches the word "expressed" in a comment. My first
pass made exactly those mistakes. The real check extracts module specifiers
(`import`/`require`/`import()`/CSS `@import`) and resolves each to a package name.

**All 10 `dependencies` are imported:**

| Package | Import sites |
|---|---|
| `@google/genai` | `src/lib/genai.ts` (behind a dynamic `import()`) |
| `dotenv` | `server.ts` |
| `express` | `server.ts` |
| `firebase` | 14 files |
| `motion` | 9 files |
| `pdfjs-dist` | `src/lib/pdf.ts` (+ its test), dynamic |
| `react` | 16 files |
| `react-dom` | `src/main.tsx` |
| `react-markdown` | `src/components/Markdown.tsx` |
| `remark-gfm` | `src/components/Markdown.tsx` |

**All 16 `devDependencies` are used**, though eight are never `import`ed - which is what
makes this the category the prompt warns about, where "build-time-only deps are easy to
miss":

| Package | Why it has no import site |
|---|---|
| `@types/express`, `@types/node`, `@types/react`, `@types/react-dom` | Type packages. `tsc` consumes them by inclusion. `CLAUDE.md` explicitly warns against removing `@types/react` on exactly this reasoning: it was previously present only because `react-markdown` depends on it, and every `.tsx` file would have silently degraded to `any` while `tsc` still exited 0. |
| `@vitest/coverage-v8` | Loaded by Vitest at runtime from `coverage.provider: 'v8'` in `vitest.config.ts`. |
| `jsdom` | Loaded by Vitest from the per-file `// @vitest-environment jsdom` pragma in five test files. |
| `firebase-tools` | A CLI. `npm run test:rules` shells out to `firebase emulators:exec`. |
| `tsx` | A CLI. `npm run dev` is `tsx server.ts`. |
| `typescript` | A CLI. `npm run lint` is `tsc --noEmit`. |

Removing any of those eight on "nothing imports it" would break a documented command.
This is precisely the trap knip fell into in Phase 4 when it called
`@firebase/rules-unit-testing` unused.

## 5.2 Misclassified prod vs dev: none that should change

Strictly, **8 of the 10 `dependencies` are bundle-time only.** `scripts/build-server.mjs`
keeps `node_modules` external, so what `dist/server.cjs` actually `require`s at runtime is
`express` and `dotenv` and nothing else. The other eight are compiled into client
JavaScript by Vite and are never resolved from `node_modules` in production.

By the letter of the prod/dev distinction they could be devDependencies, and a
production `npm ci --omit=dev` would then install ~0.36 MB of direct trees instead of
~148 MB.

**Recommendation: do not change this.** Three reasons. It is the universal convention
for bundled React applications, so a contributor reading `devDependencies: react` would
reasonably conclude something was broken. It would make `npm run build` fail in any
environment installed with `--omit=dev`, which is the more common accident. And there is
no deployment pipeline to benefit - no remote, no Docker, no CI that has ever run.
Recorded so the question is not re-opened without new information.

## 5.3 Redundant overlap: none

The check the prompt describes - moment + dayjs + date-fns, lodash + ramda, two HTTP
clients, two state managers, two icon packs - finds **one library per job**:

| Job | Library | Second implementation? |
|---|---|---|
| HTTP server | `express` | none |
| Animation | `motion` | none - `src/lib/motion.ts` is tokens over it, not a second library |
| Markdown | `react-markdown` + `remark-gfm` (its plugin) | none |
| PDF | `pdfjs-dist` | none |
| Dates | **none** - `src/lib/datetime.ts` uses `Intl` and native `Date` | none |
| HTTP client | **none** - native `fetch` | none |
| Icons | **none** - `src/components/landing/icons.tsx` is hand-written SVG | none |
| UUID | **none** - ids are `Date.now().toString()` | none |
| State | React's own | none |

Two of those are worth naming as absences rather than presences, because they are the
usual suspects in this phase: **there is no date library and no HTTP client.** The audit
had already removed an icon *font* (PERF-002 - Material Symbols, loaded from Google for
five glyphs, three of which already existed as inline SVG).

## 5.4 Import style: already optimal

| Library | Style found | Verdict |
|---|---|---|
| `firebase` | `firebase/app`, `firebase/auth`, `firebase/firestore` with named imports | Fully modular. No `import * as firebase`. |
| `pdfjs-dist` | `import('pdfjs-dist')` inside `src/lib/pdf.ts` | Dynamic, and measurably split: `pdf-*.js` (447 kB) and the 2.17 MB worker are separate chunks that never load unless a PDF is opened. |
| `motion` | `motion/react` subpath, named imports | Correct subpath. |
| `@google/genai` | `import('@google/genai')` in `src/lib/genai.ts` | Dynamic; lands in its own 278 kB chunk. |

No barrel files defeating tree-shaking, no whole-package imports, no side-effect CSS
framework imports. Phase 4 independently confirmed tree-shaking works here: removing
seven dead JS symbols changed the bundle by exactly 0 bytes.

## 5.5 What the 1.12 MB entry chunk is actually made of

The prompt asks for bundle-size impact per dependency. Rather than estimate, I built once
with a temporary `manualChunks` split and then reverted it (`vite.config.ts` verified
byte-identical to `HEAD` afterwards).

| Contents of the eager entry chunk | Raw | Gzip |
|---|---|---|
| **`firebase`** (app + auth + firestore) | **471.91 kB** | **110.52 kB** |
| `react` + `react-dom` + `scheduler` | 312.61 kB | 96.96 kB |
| application code | 324.56 kB | 92.94 kB |
| `motion` | 127.81 kB | 42.08 kB |
| *(already split, not in the entry chunk)* `@google/genai` | 278.43 kB | 55.76 kB |
| *(already split)* `pdfjs-dist` + worker | 2,622 kB | - |
| *(already split)* `react-markdown` + `remark-gfm` | 156.73 kB | 47.46 kB |

**Firebase is the single largest thing every visitor downloads, and it is ~42% of the
eager chunk.** `src/services/firebase.ts` initialises the app at import time and
`App.tsx` imports it at module scope, so all 472 kB loads for someone who opens the
landing page, reads the features page and leaves without ever signing in.

**Not acted on.** Deferring it behind the auth boundary is a code-splitting change to
live application code, not a dependency removal, and the audit already tracks this class
of work as PERF-001. But it is now a measured 110 kB gzip rather than a hunch, which is
what a follow-up needs. The three genuinely heavy things - pdfjs, genai, markdown - are
*already* split; firebase is the one that is not.

## 5.6 Security: 6 advisories, 0 reachable, and a trap

`npm audit` reports **6 vulnerabilities (1 low, 5 moderate)**. Every one is in a
devDependency, and none is reachable from anything this project ships.

| Advisory | Severity | Path | Reachable? |
|---|---|---|---|
| `esbuild` - arbitrary file read via the **development server** on Windows | low | direct devDependency, `0.27.7`, advisory range `0.27.3 - 0.28.0` | **No.** `scripts/build-server.mjs` imports `{ build }` and calls the build API. Nothing in this project ever calls esbuild's `serve()`. Vite's dev server is Vite's own. |
| `@opentelemetry/core` - unbounded memory allocation in W3C Baggage | moderate | `firebase-tools` -> `@google-cloud/pubsub` -> here | **No.** `firebase-tools` is dev-only, invoked solely by `npm run test:rules` to run a local emulator. It is not shipped and does not run in production. |
| `@google-cloud/pubsub` | moderate | `firebase-tools` | No - same path. |
| `gaxios` | moderate | `firebase-tools` | No - same path. |
| `uuid` - missing buffer bounds check in v3/v5/v6 | moderate | `firebase-tools` -> `gaxios` -> here | No - same path. |
| `firebase-tools` itself | moderate | direct devDependency | No - dev-only. |

### The trap: `npm audit fix --force` would downgrade `firebase-tools`

Five of the six advisories resolve through `firebase-tools`, and npm reports:

```
fixAvailable: { name: firebase-tools, version: 14.23.0, isSemVerMajor: true }
```

The installed version is **15.28.1**, and the latest published is **15.28.2**. npm's
"fix" is a **major-version downgrade**, backwards by a whole release line. Running
`npm audit fix --force` here would trade six unreachable dev-only advisories for a year
of regressions in the tool that runs the security-rule suite.

**Do not run it.** There is no forward fix available for these five; the 15.x line still
carries the vulnerable transitive tree. Given they are unreachable and dev-only, waiting
for upstream is the correct action, and this paragraph exists so that the next person to
run `npm audit` does not "fix" it.

### The one advisory naming a package this project declares

`esbuild` is the exception: it is a **direct** devDependency, the installed `0.27.7` is
inside the advisory range `0.27.3 - 0.28.0`, and a genuine forward fix exists at
`0.28.2`. It is still unreachable - we call `build()`, not `serve()` - so this is
hygiene rather than urgency. Offered as the one proposal below.

## 5.7 Duplicate transitive versions

`esbuild` is installed **twice**, and it is the only duplicate that costs real space:

```
esbuild@0.27.7   <- root devDependency, and tsx@4.21.0 deduped onto it
esbuild@0.25.12  <- nested under vite@6.4.3
```

Each drags a platform binary:

```
10.86 MB  node_modules/@esbuild/win32-x64
10.13 MB  node_modules/vite/node_modules/@esbuild/win32-x64
```

**~10.1 MB of pure duplication, and this project cannot collapse it.** I checked the
obvious move - declaring `esbuild@^0.25` so the root and Vite share one copy - and it
does not work: `tsx` requires the 0.27 line, so it would simply take the nested slot
instead of Vite. The duplication is imposed by `tsx` and `vite` disagreeing about
esbuild's version, not by anything this repository declares. An `overrides` entry could
force it, at the risk of handing one of them an esbuild it was not tested against, for
10 MB of dev-only disk. Not worth it.

Everything else nested is small dev-only CLI noise from `firebase-tools`' tree
(`ansi-regex` ×12, `strip-ansi` ×11, `emoji-regex` ×10, `debug` ×8). Chasing those has
no effect on anything shipped or on install time worth measuring.

## 5.8 Deprecated or unmaintained: none

No package in the tree is deprecated, and every direct dependency has had a release
recently enough to be plainly maintained. `npm outdated` shows 19 of 26 behind, and
several by a major version (`typescript` 5.8 -> 7.0, `vite` 6.4 -> 8.2, `express` 4 -> 5,
`motion` 12 -> 13, `pdfjs-dist` 5 -> 6, `@google/genai` 1.45 -> 2.19).

**Deliberately out of scope.** Upgrading a major version is a behaviour change with its
own testing burden, and this repository's floor is documented and load-bearing - the
Node engines range exists because `vitest` requires `^20 || ^22 || >=24`, and
`CLAUDE.md` records that `express` and `firebase` versions were pinned deliberately.
A cleanup pass that quietly bumps six majors is not a cleanup pass. Listed so it is a
visible decision rather than an oversight.

## 5.9 Editor / tooling extensions

`.vscode/extensions.json` does not exist, so there are no irrelevant recommendations to
prune. `.vscode/launch.json` was quarantined in Phase 2; `.vscode/settings.json` was
kept by decision. No unused generators and no unused CLI tools - `firebase-tools`, `tsx`
and `typescript` each back a documented `npm` script.

## 5.10 Lockfile

Not regenerated, because nothing changed to regenerate it for. Phase 0 established the
lockfile is internally consistent: `npm ci` exits 0, which fails when `package.json` and
`package-lock.json` disagree.

Phase 0's other lockfile finding stands and is worth repeating here: the working
`node_modules` measured **544.94 MB** while a clean `npm ci` produces **530.30 MB**, so
the installed tree had drifted **14.64 MB** above what the lockfile specifies. That is
what `npm install` does over time, and it is the same argument that retired
`.vscode/launch.json` in Phase 2 for running `npm install && npm run dev`.

## 5.11 The one proposal

| # | Proposal | Effect | Risk |
|---|---|---|---|
| 1 | Bump `esbuild` `^0.27.4` -> `^0.28.2` | Clears the only advisory naming a directly-declared package | npm calls it semver-major because esbuild is 0.x, but `scripts/build-server.mjs` uses only `build()` with `entryPoints`, `outfile`, `bundle`, `platform`, `format`, `define` and `packages: 'external'` - all stable across that boundary. Verified by running the build and the full suite. |

Nothing else in this phase has an action attached. **SAFE 0**, because there is no unused
dependency to quarantine; **KEEP 26**, all of them, with the reasons above.
