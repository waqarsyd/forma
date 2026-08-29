/**
 * Fail if any source file contains mojibake.
 *
 * Windows PowerShell 5.1 decodes with the ANSI codepage, so a read-modify-write
 * round-trip through Get-Content / Set-Content turns every UTF-8 character into
 * mojibake. This has happened here: bulk edits corrupted 2,768 sequences in
 * App.tsx, which reached the UI as "can run without it A-tilde..." in the
 * API-key banner and the status bar. It compiled, and every test passed, because
 * nothing checks string contents -- it was visible only by looking at the page.
 *
 * CLAUDE.md has carried a PowerShell one-liner for this since. It was also the
 * only documented check with no runnable form on any other platform, which made
 * it the one most likely to be skipped and the one with the largest blast
 * radius when it was. This is that check as a script, so CI can run it.
 *
 * NOTE this file is deliberately pure ASCII, including the pattern below, which
 * is written as escapes rather than as the characters it matches. Two reasons:
 * a script containing the literal sequences would flag itself, and PowerShell
 * 5.1 decodes a BOM-less .mjs as ANSI too -- so non-ASCII prose inside a
 * generator script is already corrupt before it writes anything.
 *
 * Usage:  node scripts/check-encoding.mjs        (exit 1 on any hit)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * Directories swept recursively.
 *
 * `.github` is here because everything in it is read by strangers — the issue
 * forms, the PR template and the CI workflow — and none of it was covered until
 * 2026-08-29. A mojibake em dash in an issue form is seen by every person who
 * files a bug, which is a wider audience than most of `src`.
 */
const DIRS = ['src', 'docs', 'tests', 'scripts', 'tools', '.github'];

/** Extensions worth reading. Binary files are skipped by omission. */
const EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.css', '.mjs', '.cs', '.html', '.yml', '.yaml']);

/**
 * Individually named files at the repo root.
 *
 * This list is the sweep's weak spot and worth knowing about: a NEW root-level
 * file is not swept until someone adds it here. That is not hypothetical --
 * CONTRIBUTING.md was written on 2026-08-29, scored a hit on the mojibake
 * pattern, and the sweep still reported clean because the file was not on this
 * list. Add root files here when you create them.
 *
 * The root is not a formality either: server.ts and .gitignore both carry em
 * dashes inside comments, and a sweep scoped only to the source directories
 * would score them 0 by never opening them.
 */
const ROOT_FILES = [
  'server.ts',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.rules.config.ts',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'index.html',
  'firestore.rules',
  '.gitignore',
  '.env.example',
];

/**
 * Never swept.
 *
 * CLAUDE.md quotes the corrupted example verbatim and states the pattern three
 * times as prose, so it scores a legitimate non-zero. Excluding it is what the
 * PowerShell original does too; the alternative -- an expected-count constant --
 * goes stale the moment anyone edits the file.
 */
const SKIP_FILES = new Set(['CLAUDE.md']);

/** Build output under tools/ is not source. */
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

/**
 * The signatures of UTF-8 read as Latin-1: A-tilde, A-circumflex, and the
 * a-circumflex + euro pair that leads a mangled em dash or curly quote.
 *
 * Written as escapes so this file stays pure ASCII and does not match itself.
 */
const MOJIBAKE = new RegExp('\\u00C3|\\u00C2|\\u00E2\\u20AC', 'g');

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

const files = [];
for (const dir of DIRS) files.push(...walk(join(ROOT, dir)));
for (const name of ROOT_FILES) {
  const full = join(ROOT, name);
  if (existsSync(full)) files.push(full);
}

const hits = [];
let checked = 0;

for (const file of new Set(files)) {
  if (SKIP_FILES.has(basename(file))) continue;
  checked++;
  const matches = readFileSync(file, 'utf8').match(MOJIBAKE);
  if (matches) hits.push({ file: relative(ROOT, file).split(sep).join('/'), count: matches.length });
}

// A sweep that silently stops matching files looks identical to a clean sweep.
// The floor is well below the real count (75 as of 2026-08-27) and exists only
// to catch the glob breaking, not to be kept in step with the file count.
if (checked < 40) {
  console.error(`Only ${checked} files were swept. The file selection is probably broken.`);
  process.exit(1);
}

if (hits.length) {
  console.error('Mojibake found. These files were almost certainly written by a tool that');
  console.error('decoded them as ANSI -- PowerShell Get-Content/Set-Content is the usual cause.\n');
  for (const { file, count } of hits) console.error(`  ${String(count).padStart(5)}  ${file}`);
  console.error('\nRecover them from git rather than hand-editing: the damage is lossy.');
  process.exit(1);
}

console.log(`Encoding clean: ${checked} files swept, no mojibake.`);
