/**
 * Pre-commit guard. Blocks the accidents Phase 2 of the 2026-08-28 cleanup went
 * looking for, before they reach a commit rather than after.
 *
 * In Node rather than sh on purpose -- see the note in `.githooks/pre-commit`.
 * The development machine runs MinGit, which has no `wc`, `tr` or `grep`, so a
 * shell version of this silently could not execute.
 *
 * Everything here is checked against the STAGED content, not the working tree,
 * because those differ exactly when it matters: `git add` a file, edit it, then
 * commit, and the working tree is not what lands.
 */
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync, existsSync } from 'node:fs';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACM')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (staged.length === 0) process.exit(0);

const problems = [];
const flag = (label, file, detail) => problems.push({ label, file, detail });

/* ---- 1. large files ---------------------------------------------------- */
/*
 * 1 MB. Only NEW or MODIFIED files are seen, so the 2.98 MB
 * assets/source/logo_white.png that is already committed does not trip this --
 * and re-encoding it would be worse than leaving it, because the optimised file
 * is a NEW blob while the original stays reachable from history, so the clone
 * grows rather than shrinks.
 */
const SIZE_LIMIT = 1_048_576;
for (const file of staged) {
  if (!existsSync(file)) continue;
  const size = statSync(file).size;
  if (size > SIZE_LIMIT) {
    flag(
      'TOO LARGE',
      file,
      `${size.toLocaleString()} bytes, limit ${SIZE_LIMIT.toLocaleString()}. If it genuinely belongs in git, commit with --no-verify and say why in the message.`,
    );
  }
}

/* ---- 2. junk names ----------------------------------------------------- */
/* The same categories .gitignore backstops. A file still arrives here via
 * `git add -f`, or under a name no pattern anticipated. */
const NAME_RULES = [
  [/\.(bak|old|orig|rej|tmp|swp|swo)$/i, 'BACKUP', 'a scratch copy. Delete it — git already has whatever it shadows.'],
  [/\.(zip|tar|tgz|rar|7z)$|\.tar\.gz$/i, 'ARCHIVE', 'archives do not belong in the source tree.'],
  [/\.log$/i, 'LOG', 'tool output. Already covered by .gitignore, so this is a force-add.'],
  [/(^|\/)(Thumbs\.db|desktop\.ini|\.DS_Store)$/i, 'OS CRUFT', 'operating-system dropping.'],
  [/ \d+\.[A-Za-z0-9]+$|copy|-final\b|_backup|_deprecated/i, 'DUPLICATE', 'looks like a manual copy. Rename it, or delete the original it shadows.'],
];
for (const file of staged) {
  for (const [re, label, detail] of NAME_RULES) {
    if (re.test(file)) flag(label, file, detail);
  }
}

/* A third check lived here until 2026-08-29: it blocked anything staged inside
 * the `_not_required/` quarantine, because a tracked file stays tracked wherever
 * it sits and the bytes would never have left the clone. The quarantine was
 * retired along with its CI check; if it ever comes back, so should this. */

/* ---- 3. credentials ---------------------------------------------------- */
/*
 * Deliberately narrow. An application-owned Gemini key was once inlined into a
 * shipped bundle here and revoked by Google's secret scanner. Matching `AIzaSy`
 * alone would fire on three legitimate places -- the public Firebase config, the
 * illustrative fake in VaultFigure.tsx, and an input placeholder -- so the
 * signal is an *assignment* to a key-shaped name, not the prefix on its own.
 */
const SECRET = /(GEMINI_API_KEY|GOOGLE_API_KEY|apiKey)\s*[:=]\s*["'`]?AIzaSy[A-Za-z0-9_-]{10}/;
const SKIP_BINARY = /\.(png|jpe?g|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;
for (const file of staged) {
  if (SKIP_BINARY.test(file) || file === 'package-lock.json' || !existsSync(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (SECRET.test(text)) {
    flag(
      'SECRET?',
      file,
      'looks like a real API key assignment. Keys belong in the app\'s Settings dialog, which keeps them in sessionStorage and never on disk.',
    );
  }
}

/* ---- report ------------------------------------------------------------ */
if (problems.length) {
  console.error(`\npre-commit blocked this commit (${problems.length} problem(s)):\n`);
  for (const p of problems) {
    console.error(`  ${p.label.padEnd(11)} ${p.file}`);
    console.error(`  ${''.padEnd(11)} ${p.detail}\n`);
  }
  console.error('Nothing has been committed. Fix the above, or re-run with --no-verify');
  console.error('if you are certain — and say why in the commit message if you do.\n');
  process.exit(1);
}

process.exit(0);
