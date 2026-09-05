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
 * That claim had quietly stopped being true: the `.github` comment below picked
 * up two em dashes when it was written, and nothing noticed, because this sweep
 * hunts mojibake and a correctly-encoded em dash is not mojibake. Use ` -- `
 * here. If you want to know whether this file still holds, the check is
 * `[regex]::Matches($text, '[^\x00-\x7F]').Count` and the answer must be 0.
 *
 * Usage:  node scripts/check-encoding.mjs        (exit 1 on any hit)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * Directories swept recursively.
 *
 * `.github` is here because everything in it is read by strangers -- the issue
 * forms, the PR template and the CI workflow -- and none of it was covered until
 * 2026-08-29. A mojibake em dash in an issue form is seen by every person who
 * files a bug, which is a wider audience than most of `src`.
 *
 * `.claude` joined on 2026-09-05 for the same reason and one more. It is
 * tracked and public: `settings.json` is the committed permission allowlist,
 * and `skills/run-forma/` is prose plus a driver script that a session reads
 * and follows. The extra reason is that the skill's own instructions tell the
 * next editor to keep the driver pure ASCII *because* nothing checked it --
 * a rule enforced only by a sentence asking nicely. Now it is checked.
 */
const DIRS = ['src', 'docs', 'tests', 'scripts', 'tools', '.github', '.claude'];

/**
 * Extensions worth reading. Binary files are skipped by omission.
 *
 * `.json` is here only because `.claude/settings.json` is tracked and there is
 * no other JSON inside any swept directory -- the root ones reach the sweep
 * through `ROOT_FILES`, which bypasses this filter entirely.
 */
const EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.css', '.mjs', '.cs', '.html', '.yml', '.yaml', '.json']);

/**
 * Individually named files at the repo root.
 *
 * This list is the sweep's weak spot and worth knowing about: a NEW root-level
 * file is not swept until someone adds it here. That is not hypothetical --
 * CONTRIBUTING.md was written on 2026-08-29, scored a hit on the mojibake
 * pattern, and the sweep still reported clean because the file was not on this
 * list. Add root files here when you create them.
 *
 * It caught the same trap twice: package.json was added on 2026-09-04, having
 * sat outside the sweep the whole time with an em dash in its "description".
 * It was clean, but it is a file agents edit often and a corrupted description
 * is what npm shows the world. Note it is the first non-source entry here --
 * the extension filter above never would have reached it.
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
  'package.json',
];

/**
 * Never swept.
 *
 * CLAUDE.md quotes the corrupted example verbatim and states the pattern three
 * times as prose, so it scores a legitimate non-zero. Excluding it is what the
 * PowerShell original does too; the alternative -- an expected-count constant --
 * goes stale the moment anyone edits the file.
 *
 * `settings.local.json` is skipped for an unrelated reason: it is gitignored
 * and personal, so it is the one file this sweep could reach that nobody else
 * will ever read. Failing a shared gate on an untracked file belonging to
 * whoever happens to be running it is a false positive by construction --
 * a check nobody can fix from the repository.
 */
const SKIP_FILES = new Set(['CLAUDE.md', 'settings.local.json']);

/** Build output under tools/ is not source. */
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

/**
 * The signatures of UTF-8 read as Latin-1: A-tilde, A-circumflex, and the
 * a-circumflex + euro pair that leads a mangled em dash or curly quote.
 *
 * Written as escapes so this file stays pure ASCII and does not match itself.
 */
const MOJIBAKE = new RegExp('\\u00C3|\\u00C2|\\u00E2\\u20AC', 'g');

/**
 * Literal control characters, which are a different kind of invisible damage.
 *
 * Mojibake at least renders as something. A raw NUL or DEL in a source file
 * renders as nothing at all: it survives no copy-paste, it is invisible in
 * every editor, and it can silently change what a regular expression matches.
 *
 * Added 2026-09-05 after `src/lib/zip.ts` was written with a character class
 * containing literal U+0000, U+001F and U+007F where the escapes were meant.
 * The code happened to be correct and the line was unreadable and unmaintainable
 * -- and the mojibake sweep, which had just run clean over that file, could
 * never have said so.
 *
 * Tab, newline and carriage return are excluded because they are what source
 * files are made of.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

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
const controls = [];
let checked = 0;

for (const file of new Set(files)) {
  if (SKIP_FILES.has(basename(file))) continue;
  checked++;
  const text = readFileSync(file, 'utf8');
  const name = relative(ROOT, file).split(sep).join('/');
  const matches = text.match(MOJIBAKE);
  if (matches) hits.push({ file: name, count: matches.length });
  const ctrl = text.match(CONTROL_CHARS);
  if (ctrl) {
    // The line number is worth the extra pass: a control character is invisible,
    // so "somewhere in this 400-line file" is not an actionable report.
    const line = text.slice(0, text.search(CONTROL_CHARS)).split('\n').length;
    controls.push({ file: name, count: ctrl.length, line });
  }
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

if (controls.length) {
  console.error('Literal control characters found. They render as nothing, survive no');
  console.error('copy-paste, and can silently change what a regular expression matches.\n');
  for (const { file, count, line } of controls) {
    console.error(`  ${String(count).padStart(5)}  ${file}:${line}`);
  }
  console.error('\nWrite them as escapes -- \\u0000, \\t -- rather than as raw bytes.');
  process.exit(1);
}

console.log(`Encoding clean: ${checked} files swept, no mojibake, no control characters.`);
