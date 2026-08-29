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
  { prefix: 'index-', ext: '.js', max: 1_160_000, note: 'eager entry chunk + the genai chunk' },
  { prefix: 'index-', ext: '.css', max: 112_000, note: 'the whole stylesheet' },
  { prefix: 'pdf.worker-', ext: '.mjs', max: 2_250_000, note: 'pdfjs worker, lazy' },
  { prefix: 'pdf-', ext: '.js', max: 470_000, note: 'pdfjs entry, lazy' },
  { prefix: 'Markdown-', ext: '.js', max: 175_000, note: 'react-markdown + remark-gfm, lazy' },
];

/** The whole deployable payload, as a backstop for anything the list above misses. */
const TOTAL_MAX = 4_600_000;

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
