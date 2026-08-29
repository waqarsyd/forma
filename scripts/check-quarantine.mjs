/**
 * Fail if anything in the project reaches into `_not_required/`.
 *
 * The quarantine only works if it is a one-way door. A file that is parked but
 * still imported is not parked -- it is a file in a confusing location, and the
 * manifest saying it was removed becomes a lie.
 *
 * Two things are checked, because they fail differently:
 *
 *   1. No source file may import from the folder. This is the one that breaks a
 *      build, and it is the reason the check exists.
 *   2. `_not_required/` must contain nothing tracked except MANIFEST.md and
 *      README.md. This catches the subtler mistake: `git mv`-ing something INTO
 *      the folder appears to work, but a tracked file stays tracked no matter
 *      where it sits, so the bytes never actually leave the clone. Moving
 *      something in needs `git rm --cached` after the move -- see
 *      _not_required/README.md.
 *
 * Usage:  node scripts/check-quarantine.mjs        (exit 1 on any hit)
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const QUARANTINE = '_not_required';
const ALLOWED_TRACKED = new Set([
  `${QUARANTINE}/MANIFEST.md`,
  `${QUARANTINE}/README.md`,
]);

const tracked = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const problems = [];

/* ---- 1. imports ------------------------------------------------------- */

const sources = tracked.filter(
  (f) => /\.(ts|tsx|mjs|cjs|js|jsx|css)$/.test(f) && !f.startsWith(`${QUARANTINE}/`),
);

// `from '…_not_required…'`, `import('…')`, `require('…')`, and CSS `@import`.
const REACH = new RegExp(
  `(?:from\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*|@import\\s+)['"][^'"]*${QUARANTINE}[^'"]*['"]`,
);

for (const file of sources) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (REACH.test(line)) {
      problems.push(`  ${file}:${i + 1}  imports from ${QUARANTINE}/`);
    }
  });
}

/* ---- 2. tracked contents ---------------------------------------------- */

for (const file of tracked) {
  if (!file.startsWith(`${QUARANTINE}/`)) continue;
  if (ALLOWED_TRACKED.has(file)) continue;
  problems.push(
    `  ${file}  is TRACKED inside ${QUARANTINE}/ — the bytes are still in the clone.\n` +
      `      Run: git rm --cached "${file}"   (the file stays on disk)`,
  );
}

/* ---- report ------------------------------------------------------------ */

if (problems.length) {
  console.error(`Quarantine violated (${problems.length}):\n`);
  for (const p of problems) console.error(p);
  console.error(
    `\n${QUARANTINE}/ is not part of the project. Nothing may import from it, and\n` +
      `nothing inside it may be tracked except MANIFEST.md and README.md.\n` +
      `See ${QUARANTINE}/README.md for the convention.\n`,
  );
  process.exit(1);
}

console.log(
  `Quarantine intact: ${sources.length} source files checked, none import from ` +
    `${QUARANTINE}/; tracked contents are MANIFEST.md and README.md only.`,
);
