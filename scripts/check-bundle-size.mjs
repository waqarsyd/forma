/**
 * Fail if a build artifact grows past its budget.
 *
 * This exists because of a defect that every other check in this project missed.
 * `src/index.css` had a bare `@import "tailwindcss"`, so Tailwind scanned all 110
 * markdown files and generated real utilities from class names quoted in prose --
 * `.bg-user-msg` was shipping to every visitor because a cleanup report contained
 * the sentence explaining that the token was dead. tsc was clean, 409 tests
 * passed, the build succeeded, and the stylesheet quietly grew. Nothing was
 * watching the size, so nothing said so.
 *
 * The budgets below are set from the 2026-08-29 build with a deliberately small
 * headroom. They are meant to be *tight enough to trip*: a budget with 50% slack
 * is a budget that never fires, and the failure this catches was 1.1% of one file.
 *
 * When a budget legitimately needs raising, raise it in the same commit as the
 * change that needs it and say why in the message. A budget bumped in its own
 * commit, with no explanation, is how this check stops meaning anything.
 *
 * There is one standing exception, and it is the other way a budget stops
 * meaning anything: a cap that has crept up to ~99% of its artifact trips on the
 * next routine change, and what that teaches is to raise the number without
 * reading it. Retuning such a cap on its own is legitimate -- it is maintenance
 * of the check, not an excuse for a regression -- provided the comment says what
 * it measured and why the new number is where it is. See TOTAL_MAX, retuned this
 * way on 2026-09-05. The test of the difference is simple: a raise made because
 * something grew names the growth; a retune names the percentage.
 *
 * Usage:  node scripts/check-bundle-size.mjs        (exit 1 on any breach)
 *         node scripts/check-bundle-size.mjs --print (report only, exit 0)
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const PRINT_ONLY = process.argv.includes('--print');

/**
 * Matched as a prefix against the filename, because Vite fingerprints every
 * chunk. `index-` deliberately matches the eager entry chunk *and* the lazily
 * loaded genai chunk; both are budgeted by the same worst-case number, which is
 * the entry chunk's.
 */
const BUDGETS = [
  // Lowered from 1,160,000 on 2026-09-01, when Firebase was deferred behind
  // lib/firebaseClient.ts and the entry chunk fell from 1,121,920 B to 619,380 B
  // -- 502,540 B, 45% of it, off the critical path. A cap left at 1,160,000
  // would have had 87% headroom and could never fire again, which is the failure
  // this whole script exists to prevent. Tightened to sit just above the new
  // measurement instead.
  // Lowered again from 660_000 on 2026-09-04, when services/geminiService.ts was
  // deferred behind lib/geminiClient.ts and the entry chunk fell from 649,111 B
  // to 588,368 B -- 60,743 B, including 19,615 B of mega-prompt that every
  // visitor to the landing page was downloading to read marketing copy. Left at
  // 660_000 the cap would have had 11% headroom against a chunk that had just
  // shrunk by 9%, which is the same "can never fire again" failure the
  // 2026-09-01 entry applies. Tightened to sit just above the new measurement,
  // exactly as that one was.
  //
  // 625_000 rather than 600_000, which was tried first and is the mistake this
  // whole file is about: it put the chunk at 98.1%, so the next routine change
  // would have tripped a size check for no reason and taught someone to raise
  // the number instead of reading it. 588,368 against 625_000 is 94.1%, which is
  // where the 2026-09-01 cap and the firebase- cap both sit. Tight enough to
  // trip on a regression, loose enough that only a regression trips it.
  { prefix: 'index-', ext: '.js', max: 625_000, note: 'eager entry chunk + the genai chunk' },
  /*
   * The generation service, lazy as of 2026-09-04.
   *
   * Budgeted because it is almost entirely one template literal, and prompt text
   * is the thing in this repository most likely to grow without anyone noticing:
   * every fidelity fix so far has added prose to it, and nothing else measures
   * it. The other direction -- the whole service silently returning to the eager
   * path, which is what a value import in App.tsx would do -- does not show up
   * here. It shows up as the entry chunk jumping ~61 kB against the cap above.
   */
  // Raised from 70_000 on 2026-09-05, and this is the case the budget was put
  // here for: the chunk is almost entirely one template literal, and it grew
  // 63,492 -> 70,651 B when the prompt gained a GROUPING section and a
  // PARAMETERS section. Two features, ~7.2 kB of instruction, and nothing else
  // in the build would have said so.
  //
  // 75_000 puts it at 94.2%, where the index- and firebase- caps sit. This is a
  // raise, not a retune, so per the header it names the growth: grouping and
  // parameters, in the commit that added them.
  //
  // Raised again to 78_000 on 2026-09-05, same day, same reason, one feature
  // later: 70,651 -> 73,565 B, +2,914 B, when `7e756f9` added the CHARTS AND
  // CROSS-TABS section. That is 39 lines of prompt asking for a real `XRChart`
  // and `XRCrossTab` instead of a picture of one. 78_000 puts it back at 94.3%.
  //
  // **The growth is not in this file's own module, and that is worth knowing
  // before hunting it.** `geminiService.ts` imports `rootStructurePrompt` from
  // `lib/reportBands.ts`, and every prompt section since the banded skeleton has
  // been added there -- so the chunk this cap watches grows from a file whose
  // name does not appear in the artifact list. Three raises in two days is not
  // drift: the mega-prompt is where features are specified, so a cap on it fires
  // roughly once per feature. If it ever fires without a prompt change behind
  // it, that is the interesting case and the one this budget is really for.
  { prefix: 'geminiService-', ext: '.js', max: 78_000, note: 'the mega-prompt + generation service, lazy' },
  // Raised from 112,000 on 2026-08-30: the six @font-face rules for the
  // self-hosted families add ~1,935 B of CSS, which took this to 98.4% of the
  // old cap -- tight enough that the next unrelated line would have tripped it
  // and sent someone hunting a Tailwind leak that was not there.
  { prefix: 'index-', ext: '.css', max: 116_000, note: 'the whole stylesheet' },
  { prefix: 'pdf.worker-', ext: '.mjs', max: 2_250_000, note: 'pdfjs worker, lazy' },
  { prefix: 'pdf-', ext: '.js', max: 470_000, note: 'pdfjs entry, lazy' },
  { prefix: 'Markdown-', ext: '.js', max: 175_000, note: 'react-markdown + remark-gfm, lazy' },
  /*
   * The Firebase SDK, lazy as of 2026-09-01 and grouped into one chunk by the
   * manualChunks block in vite.config.ts.
   *
   * Budgeted because it is now the largest thing that is *not* on the critical
   * path, and the way that silently reverts is a static `import` of
   * `services/firebase` creeping back into the eager graph. That would not show
   * up here -- it shows up as the entry chunk jumping ~500 kB against its own
   * cap. This budget catches the other direction: the SDK itself growing.
   */
  { prefix: 'firebase-', ext: '.js', max: 660_000, note: 'firebase app + auth + firestore, lazy' },
  /*
   * Every self-hosted font, checked individually. An empty prefix matches all
   * of them; the cap is the largest (inter-latin-ext, 85,068 B) plus a little.
   *
   * Worth watching per-file rather than only in the total, because the failure
   * mode here is silent and specific: fetching a STATIC instance instead of a
   * variable face, or a subset wider than latin-ext, changes one file's size
   * and nothing else. See src/fonts/README.md for how to refresh them.
   */
  { prefix: '', ext: '.woff2', max: 90_000, note: 'a single self-hosted font subset' },
];

/**
 * The whole deployable payload, as a backstop for anything the list above misses.
 *
 * Raised from 4,600,000 on 2026-08-30 for the self-hosted fonts (audit
 * PERF-002): six woff2 files, 230,672 B, which took the total from 4,468,367 to
 * 4,699,146 and tripped this check exactly as it should have. The bytes moved
 * from Google's origin to ours rather than appearing from nowhere -- a typical
 * page still fetches three of the six, the same three it fetched before -- but
 * they are in `dist/` now, so the budget has to say so.
 *
 * Raised again from 4,840,000 on 2026-09-01, to 4,847,691 measured + headroom.
 * Deferring Firebase (see lib/firebaseClient.ts) took 502,540 B off the entry
 * chunk but added 148,489 B to the total: code-splitting is not free, and the
 * same modules spread across more chunks tree-shake and dedupe less well than
 * they did in one. Grouping the SDK with manualChunks was tried against this and
 * recovered only ~3 kB, so the cost is inherent rather than a chunking mistake.
 *
 * It is a deliberate trade and worth stating plainly: every visitor now
 * downloads ~500 kB less to see a page, and only the ones who sign in ever fetch
 * the 619 kB Firebase chunk at all. The total is the wrong number to optimise
 * for when most of it is never requested -- but it still gets a budget, because
 * something has to notice if it doubles.
 *
 * Raised from 4,900,000 on 2026-09-05, against 4,890,175 measured -- 99.8%, or
 * about 9.8 kB of headroom. Nothing had breached it. That is the reason to move
 * it, not a reason to leave it: the 2026-09-04 entry on the `index-` cap above
 * rejected a number that would have sat at 98.1% as "the mistake this whole file
 * is about", because a cap the next routine change trips teaches people to raise
 * the number rather than read it. The total had drifted past that line one small
 * commit at a time and nobody had noticed, since a passing check says nothing
 * about how nearly it failed.
 *
 * 5,200,000 puts it at 94.0%, which is exactly where the `index-` and
 * `firebase-` caps sit. That is the standard this file already applies to every
 * per-file budget, applied here for the first time.
 *
 * The header says to raise a budget in the same commit as the change that needs
 * it, and this raise had no such change. The rule is aimed at a bump smuggled in
 * to make a red check green; the reasoning above is what it actually asks for.
 * Note also what the total is FOR: it is the backstop for what the per-file list
 * misses, and it is meant to catch a doubling. 310 kB of headroom still does
 * that, and the per-file caps -- which are the sensitive detectors -- are
 * untouched.
 */
const TOTAL_MAX = 5_200_000;

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ directory. Run \`npm run build\` first.`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push({ name: entry, path: full, size: statSync(full).size });
  }
  return out;
};

const files = walk(DIST);
const total = files.reduce((a, f) => a + f.size, 0);

const rows = [];
const breaches = [];

for (const budget of BUDGETS) {
  const matches = files.filter(
    (f) => f.name.startsWith(budget.prefix) && f.name.endsWith(budget.ext),
  );
  if (matches.length === 0) {
    breaches.push(
      `MISSING  ${budget.prefix}*${budget.ext} — no artifact matched. Either the build ` +
        `changed shape or it did not run; a budget that matches nothing is not passing, ` +
        `it is blind.`,
    );
    continue;
  }
  for (const m of matches) {
    const pct = ((m.size / budget.max) * 100).toFixed(1);
    rows.push({ name: m.name, size: m.size, max: budget.max, pct, note: budget.note });
    if (m.size > budget.max) {
      breaches.push(
        `OVER     ${m.name} — ${m.size.toLocaleString()} B exceeds the ` +
          `${budget.max.toLocaleString()} B budget by ${(m.size - budget.max).toLocaleString()} B (${budget.note})`,
      );
    }
  }
}

rows.push({ name: 'dist/ total', size: total, max: TOTAL_MAX, pct: ((total / TOTAL_MAX) * 100).toFixed(1), note: 'everything deployed' });
if (total > TOTAL_MAX) {
  breaches.push(
    `OVER     dist/ total — ${total.toLocaleString()} B exceeds the ${TOTAL_MAX.toLocaleString()} B budget`,
  );
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('artifact', 34)} ${pad('bytes', 12)} ${pad('budget', 12)} used`);
for (const r of rows) {
  console.log(
    `${pad(r.name, 34)} ${pad(r.size.toLocaleString(), 12)} ${pad(r.max.toLocaleString(), 12)} ${r.pct}%`,
  );
}

if (PRINT_ONLY) process.exit(0);

if (breaches.length) {
  console.error('\nBundle size budget exceeded:\n');
  for (const b of breaches) console.error(`  ${b}`);
  console.error(
    '\nIf the growth is intended, raise the budget in scripts/check-bundle-size.mjs in\n' +
      'the SAME commit as the change, and say why. If it is not intended, the usual\n' +
      'causes are a new dependency in the eager path, a lazy import that became\n' +
      'static, or Tailwind generating utilities from something it should not be\n' +
      'scanning — see the @source note at the top of src/index.css.\n',
  );
  process.exit(1);
}

console.log('\nAll artifacts within budget.');
