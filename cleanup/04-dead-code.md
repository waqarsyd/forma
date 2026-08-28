# Phase 4 - Dead code

Date: 2026-08-28
Branch: `chore/cleanup`

**SAFE 11 / UNSURE 3 / KEEP 7.**

Eleven dead symbols quarantined. The measured effect on the shipped bundle is
**−604 bytes, all of it CSS** - because ten of the eleven were already being
tree-shaken and cost nothing. That number is the point of this report: the tooling
answer and the truthful answer differ, and only a before/after build tells them apart.

---

## 4.1 Method

Three independent passes, deliberately not trusting any one of them:

1. **A hand-written import-graph walker** (`graph.mjs`) run from **every** entry point -
   `src/main.tsx`, `server.ts`, the three Vite/Vitest configs, the three `scripts/*.mjs`,
   and all 27 test files. It follows static imports, re-exports, side-effect imports and
   `import()`, and resolves both relative and `@/` alias specifiers. Written by hand
   rather than taken from a tool because ground rule 1 wants evidence that can be quoted
   and re-run, and because the two dynamic-`import()` loaders here (`genai.ts`, `pdf.ts`)
   are exactly the shape a static tool gets wrong.
2. **A hand-written unused-export scanner** (`exports.mjs`), because
   `tsc --noUnusedLocals` structurally *cannot* see these: an export is, by definition,
   used from its own module's point of view. Searches all 210 tracked files - including
   markdown, JSON, YAML and HTML - not just source.
3. **`npx knip@latest`** as a cross-check, run without installing it.

## 4.2 Unreferenced files: none

```
entry points: 35
reachable modules: 89
tracked source modules: 88

=== UNREACHABLE FROM ANY ENTRY POINT ===
  src/vite-env.d.ts

=== REACHED BY TESTS/CONFIG BUT NOT BY THE SHIPPED APP ===
  none
```

**Zero orphaned source files.** The single unreachable file is an ambient declaration
that `tsc` consumes by inclusion rather than by import, so no import graph can ever
reach it. Its own comment records why it is load-bearing: without it, `import.meta.env`
has no types, which forces `(import.meta as any)` casts, which defeat Vite's
transform-time substitution and leave a dev-only branch in the production bundle. **KEEP.**

The second list is worth noting too. Nothing in this project exists only to be tested -
there is no code that tests reach and the app does not.

## 4.3 Where knip and the hand-written scan disagreed, and who was right

knip reported 21 unused exports, 8 unused exported types, 3 unused files and 1 unused
devDependency. **Several of those are wrong**, and the failure has a single cause: knip
had no configuration for this project's *second* Vitest project, so it could not see
`vitest.rules.config.ts` as an entry point.

| knip said | Reality |
|---|---|
| `tests/firestore.rules.test.ts`, `tests/accountDeletion.test.ts`, `vitest.rules.config.ts` are **unused files** | They are the entire `npm run test:rules` suite - 41 passing tests against the emulator. |
| `@firebase/rules-unit-testing` is an **unused devDependency** | Imported by both rules tests. Removing it breaks the security-rule suite. |
| `VAULT_DOC_ID` is an unused export | Imported by `tests/accountDeletion.test.ts` at three call sites. |
| `DESIGNER_ORIGIN`, `EASE`, `REVIEW_BENCH_RESERVE`, `POINTS_PER_INCH`, `CSS_PX_PER_INCH`, `reauthenticate`, `VaultUnavailableError`, `FirestoreErrorInfo`, `ReportCell/Row/Section` are unused exports | All are used *inside their own module*, or re-exported through `geminiService.ts`. "Unused export" is accurate; "dead code" is not. |
| `IconRuler` is an unused export | **Correct** - and my scanner missed it, because the two prose comments mentioning `IconRuler` looked like references. |

That last row is why both passes were run. Each caught something the other did not.

## 4.4 SAFE - quarantined (11 symbols across 4 files)

These are **symbols cut from files that are still live**, so each is quarantined as an
excerpt file under `_not_required/dead-code/` preserving its original path, carrying the
code verbatim plus what it depends on. The live file keeps a short comment at the removal
site pointing at the manifest, so a reader finds the record without having to search for
it. Full evidence per row is in `_not_required/MANIFEST.md`.

| Symbol(s) | File | Evidence |
|---|---|---|
| `IconRuler`, `IconUpload` | `src/components/landing/icons.tsx` | `git grep -w` -> 1 hit / 3 hits, the latter being the declaration plus two prose comments, no JSX. No `icons[name]` lookup exists anywhere, so no dynamic reference is possible. |
| `drawerVariants`, `messageVariants`, `tabPanelVariants`, `snapInVariants` | `src/lib/motion.ts` | Exactly one hit each - the declaration. knip flagged the same four independently. |
| `SMALL` | `src/components/landing/sections.tsx` | One hit. Its four siblings are imported by `LandingPage` and `FeaturesPage`; this one by neither. A fixed-string search for the class list found no inline copy under another name. |
| `.bento-grid`, `.glass-panel`, `.port-indicator`, `.hero-gradient` | `src/index.css` | Each class name appears **exactly once in the whole repository**. All 98 template-literal `className` sites were read; none constructs a `-grid`, `-panel`, `-gradient` or `-indicator` suffix. |

### The measurement, which changes the story

I recorded the bundle before and after rather than asserting a saving:

| Artifact | Before | After | Delta |
|---|---|---|---|
| `index-*.js` | 1,120,976 B | 1,120,976 B | **0** |
| `index-*.css` | 109,411 B | 108,807 B | **−604 B** |
| all `dist/assets` | 4,287,707 B | 4,287,103 B | **−604 B** |

**The JS is byte-identical.** Rollup was already tree-shaking every one of the seven dead
JS symbols, so removing them saved precisely nothing in what users download. Confirmed
independently before the build too: neither dead icon's `d=` path data, and neither
`x:'100%'` nor `scale:1.22`, appears anywhere in the built JS, while the control symbols
(`IconFolder`, `fadeInUpVariants`) each appear once.

Only the CSS was real waste. Tailwind purges the *utilities* it generates, but
`.bento-grid` and its three neighbours are hand-written rules, so nothing removed them.

**The honest summary: Phase 4's value here is source clarity, not bytes.** Seven symbols
that looked like waste were costing nothing; four CSS rules that looked identical in kind
were costing 604 bytes on every page load. Only measuring separated them.

## 4.5 UNSURE - not moved, awaiting your decision (3)

### 1. `resetGenAIForTests` - `src/lib/genai.ts:36`

```ts
/** Test seam. Not for application use — the memo is deliberate at runtime. */
export function resetGenAIForTests(): void { pending = null; }
```

Unreferenced: `git grep resetGenAIForTests` across the whole repo returns one hit, the
declaration. **No test uses the test seam.**

**Why UNSURE rather than SAFE.** Its docblock states an intent that removing it defeats.
`loadGenAI()` memoises a dynamic `import()` on the module, so without this any future
test touching that loader inherits state from the previous test. It is three lines and
tree-shaken. Removing dead code is right; removing a deliberately-placed, documented
seam for tests that have not been written yet is a different decision, and it is yours.

### 2. `Route` - `src/lib/router.ts:28`

```ts
export const ROUTES = ['/', '/features', …] as const;
export type Route = (typeof ROUTES)[number];
```

`ROUTES` is heavily used and documented as load-bearing. The derived `Route` type is
used nowhere - not even inside `router.ts`. It is one line, erased entirely at compile
time, and it names the route union for anyone reading the module. **Recommendation:
keep**; listed only so the finding is on record.

### 3. About a dozen exports used only inside their own module

`EASE`, `googleProvider`, `USERS_COLLECTION`, `REPORTS_COLLECTION`, `VAULT_COLLECTION`,
`DESIGNER_ORIGIN`, `POINTS_PER_INCH`, `CSS_PX_PER_INCH`, `REVIEW_BENCH_RESERVE`,
`reauthenticate`, `LOCAL_REPORTS_KEY`, `FirestoreErrorInfo`.

Every one is live inside its declaring file; only the `export` keyword is surplus, and
this is not a published package so nothing external can want them.

**The argument for narrowing them is better than it looks:** an exported symbol is
invisible to `tsc --noUnusedLocals`, so if one of these *becomes* dead later, nothing
will ever say so. Un-exporting puts them under a checker that already runs in CI.

**The argument against:** it is an edit to nine files with no runtime effect, and
`VAULT_DOC_ID` in the same file as three of them *is* legitimately imported by a test -
so the boundary is not "this file exports nothing", it is symbol by symbol. Easy to get
subtly wrong for no user-visible gain.

## 4.6 KEEP - looked dead, is not (7)

Recorded in `MANIFEST.md` so a later pass does not repeat the work: `src/vite-env.d.ts`,
`GET /api/health`, `@firebase/rules-unit-testing`, the 46 unused `@theme` tokens, the
~12 internal-only exports, `AttachmentText` vs `TextAttachment`, and the `Route` type.

Two deserve their reasoning here.

**The 46 unused `@theme` tokens cost zero bytes.** A naive `var()` scan called 81 of
`index.css`'s 199 custom properties dead. That analysis was wrong in an instructive way:
in Tailwind v4 a token declared in `@theme` is consumed by the *compiler* to generate a
utility class, not read with `var()`. `--color-user-msg` is "used" when some JSX says
`bg-user-msg`. Re-run with utility derivation and arbitrary-value syntax
(`text-[color:var(--x)]`) taken into account, the figure fell to 46 - and checking the
built stylesheet showed **none of the 46 reaches it**. They are the unused half of a
coherent Material Design 3 palette, costing source lines only.

**`AttachmentText` and `TextAttachment` are not a duplicate pair.** The transposed names
look like an accident. They are not: `AttachmentText` is `{ text: string }`, deliberately
minimal so `App.tsx`'s five-field `TextAttachment` satisfies it structurally without
`src/lib` depending on the component.

## 4.7 The other Phase 4 categories

| Category | Result |
|---|---|
| Unreachable code (after `return`/`throw`, `if (false)`) | **None.** Every source file scanned for a statement following a terminating one at the same indent. |
| Commented-out code blocks | **None.** Three lines matched a code-shaped comment pattern; all three are prose that happens to begin with `<details>` or `function`. No `git blame` ageing was needed because there was nothing to age. |
| Dead feature flags | **None.** `VITE_FORMA_MOCK`, `DISABLE_HMR`, `HTTPS`, `HOST`, `NODE_ENV`, `NO_COLOR` are all read at runtime and none is permanently on or off. `VITE_FORMA_MOCK` is documented opt-in mock mode. |
| Unused function params / vars / imports | **None** - `tsc --noUnusedLocals --noUnusedParameters` is clean and stays clean. |
| Unused React components | 2, quarantined (§4.4). |
| Unused CSS classes / variables | 4 classes quarantined; 46 tokens measured and kept (§4.6). No Tailwind safelist exists. |
| Unused i18n keys | **Not applicable** - no i18n layer. |
| Dead API surface | 1 route, `GET /api/health`, with no in-repo caller. **KEEP** - health endpoints are called from outside, and both `docs/PRD.md` and `docs/notes/gemini.md` record it as the deliberate sole survivor after the key-bearing endpoints were deleted. |
| Dead database surface | **None, and it cannot drift.** `firestore.rules` validates report documents with `hasOnly(['id','name','timestamp','messages','result','userId'])` *and* `hasAll` of the same six; `toFirestoreDocument()` writes exactly those six. The vault doc is the same pattern over five keys. `hasOnly` makes an unread extra field structurally impossible rather than merely absent. |
| Orphaned / skipped tests | **None.** `git grep '\.skip|\.todo|\.only|xit\(|xdescribe\('` over `src` and `tests` returns nothing - no skipped, no todo, no focused tests anywhere. |
| Dead `package.json` scripts | **None.** Every file path referenced by the 13 scripts exists. |
| Old migrations | **Not applicable.** |

## 4.8 Found while working, not acted on

`src/services/geminiService.ts:115-120` carries a comment that its own code contradicts:

```ts
// Must stay written as `import.meta.env` — Vite substitutes that exact
// expression at transform time. Writing `import.meta?.env` silently defeats the
// replacement, leaving an undefined value in the browser and a mock flag that
// never fires.
const viteEnv: Record<string, string | undefined> =
  (import.meta as any).env ?? {};
```

The comment says the exact text matters; the line below it is a cast. And
`src/vite-env.d.ts` exists *specifically* so that `(import.meta as any)` casts could be
removed - its comment says those casts "produced something the minifier could not fold
to a constant". This is the one that survived, in the very place the warning is written.

It most likely still works, because TypeScript erases `as any` before Vite's define pass
sees the text. **Not changed**: it is a live code path with no test, in a file whose
history includes a leaked API key, and "probably fine" is not the standard for editing
it during a cleanup. Recorded for whoever owns `docs/notes/gemini.md`.

## 4.9 Verification

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | exit 0 |
| `npm run lint:encoding` | exit 0 - 105 files swept |
| `npm test` | exit 0 - **25 files / 409 tests passed** |
| `npm run clean && npm run build` | exit 0, and measured against the pre-removal bundle |

Nothing broke; nothing needed restoring.
