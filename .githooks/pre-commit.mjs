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
import { existsSync } from 'node:fs';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

/* This exited here when nothing was added or modified, until 2026-11-23: a
 * commit of deletions alone has nothing for the checks below to read, but it
 * still has to reach the project hierarchy (section 4). */
const problems = [];
const flag = (label, file, detail) => problems.push({ label, file, detail });

/*
 * What lands is the index, so every check reads it (2026-11-23). Until then the
 * sizes and the key scan read the working tree, despite the note above: a key
 * staged and then removed from the working copy passed. Renames were left out
 * of the list too (ACM), so a file renamed into .mcp.json with a key in it
 * skipped every content check; R joined it.
 */
const stagedSize = (file) => {
  try {
    return Number(git('cat-file', '-s', `:${file}`).trim());
  } catch {
    return null;
  }
};
const stagedText = (file) => {
  try {
    return git('show', `:${file}`);
  } catch {
    return null;
  }
};

/* ---- 1. large files ---------------------------------------------------- */
/*
 * 1 MB. Only NEW or MODIFIED files are seen, so an oversized file that is
 * already committed does not trip this on every later commit.
 *
 * This paragraph used to warn that re-encoding assets/source/logo_white.png
 * "would be worse than leaving it, because the optimised file is a NEW blob
 * while the original stays reachable from history, so the clone grows rather
 * than shrinks." On 2026-08-29 it was re-encoded anyway, past this hook, with
 * --no-verify. The warning was exactly right: the working tree got 460 KB
 * smaller and the clone payload went from 4.74 MB to 7.59 MB, because history
 * then held both the 2,984,020-byte original and the 2,599,351-byte
 * replacement.
 *
 * Two things worth keeping from that. **A blob is forever unless history is
 * rewritten** -- "optimising" a large tracked binary always costs more than it
 * saves until someone purges the old one. And **this hook's refusal carried the
 * reasoning that made it correct**; overriding it after reading only the one-line
 * failure message is how a warning gets bypassed on its own merits.
 */
const SIZE_LIMIT = 1_048_576;
for (const file of staged) {
  const size = stagedSize(file);
  if (size !== null && size > SIZE_LIMIT) {
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
 * alone would fire on several legitimate places -- the public Firebase config,
 * the illustrative fake in VaultFigure.tsx, the run-forma driver's seeded
 * session, test fixtures, and the docs that explain all of these (`git grep -l
 * AIzaSy` lists them today) -- so the signal is an *assignment* to a key-shaped
 * name, not the prefix on its own. (This said "three legitimate places" until
 * 2026-11-11, and the list had grown past it unnoticed.)
 *
 * Two formats since 2026-11-05: Google AI Studio now also issues Gemini keys
 * that start `AQ.` and run to about 53 characters. The owner's new key was one,
 * and this pattern, which knew only `AIzaSy`, would have let it be committed.
 */
const SECRET = /(GEMINI_API_KEY|GOOGLE_API_KEY|apiKey)\s*[:=]\s*["'`]?(AIzaSy[A-Za-z0-9_-]{10}|AQ\.[A-Za-z0-9_-]{20})/;
/*
 * A second shape since 2026-11-23 (the MCP design audit's SEC-10): an
 * environment-style name written as JSON, where a closing quote stands between
 * the name and the colon -- the shape of an MCP host's config (.mcp.json,
 * claude_desktop_config.json) with a literal key in it -- and the Forma and
 * OpenRouter names the pattern above never knew. The generic `apiKey` above
 * stays case-sensitive and unquoted on purpose: widening it flags the public
 * Firebase config and test fixtures.
 */
/* `{0,40}`, not `*`: an unbounded run before KEY made the scan quadratic on a long FORMA_FORMA_... input (15 s at 240 KB). */
const SECRET_ENV = /(GEMINI_API_KEY|GOOGLE_API_KEY|OPENROUTER_API_KEY|FORMA_[A-Z_]{0,40}KEY)["']?\s*[:=]\s*["'`]?(AIzaSy[A-Za-z0-9_-]{10}|AQ\.[A-Za-z0-9_-]{20}|sk-or-v1-[0-9a-f]{20})/;
/*
 * An MCP host's config should hold ${VAR} references only: Claude Code's
 * .mcp.json, VS Code's and Cursor's mcp.json, Claude Desktop's
 * claude_desktop_config.json, Windsurf's mcp_config.json, Gemini CLI's
 * .gemini/settings.json. In one of those, a key-shaped literal under any name
 * is a leak, and so is a long literal under a name that reads as a
 * credential (a GitHub token, another vendor's key): a value made only of
 * references and short words ("Bearer ${input:token}") holds none.
 */
const MCP_CONFIG = /(^|\/)(\.?mcp\.json|claude_desktop_config\.json|mcp_config\.json|\.gemini\/settings\.json)$/i;
const KEY_LITERAL = /AIzaSy[A-Za-z0-9_-]{30}|AQ\.[A-Za-z0-9_-]{40}|sk-or-v1-[0-9a-f]{40}/;
const CREDENTIAL_PAIR = /"([A-Za-z0-9_.-]{0,60}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH)[A-Za-z0-9_.-]{0,60})"\s*:\s*"([^"]*)"/gi;
const holdsLiteral = (value) => /[A-Za-z0-9_.-]{16,}/.test(value.replace(/\$\{[^}]*\}/g, ''));
const mcpLeak = (text) =>
  KEY_LITERAL.test(text) || SECRET.test(text) || SECRET_ENV.test(text) || [...text.matchAll(CREDENTIAL_PAIR)].some((m) => holdsLiteral(m[2]));
const SKIP_BINARY = /\.(png|jpe?g|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;
for (const file of staged) {
  if (SKIP_BINARY.test(file) || file === 'package-lock.json') continue;
  const text = stagedText(file);
  if (text === null) continue;
  // The MCP case first: its advice differs, since an MCP server has no Settings dialog.
  if (MCP_CONFIG.test(file) && mcpLeak(text)) {
    flag(
      'SECRET?',
      file,
      'an MCP host config with a key, token or password in it. Write a ${VAR} reference (or the host\'s ${input:...} prompt) and set the value outside the file, or keep the server in local or user scope.',
    );
  } else if (SECRET.test(text) || SECRET_ENV.test(text)) {
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

/* ---- 4. the project hierarchy ------------------------------------------ */
/*
 * Every place a change has to reach, held against what is staged (2026-11-23):
 * a feature added or removed reaches the Features and Docs pages, the release
 * notes, the spec and the notes as well as the code. The hierarchy and its
 * reasoning are scripts/check-hierarchy.mjs; it prints its own report, asks
 * for a recorded review where a line needs judgement, and blocks the commit as
 * the checks above do. A checkout older than the script has nothing to run.
 */
const HIERARCHY = 'scripts/check-hierarchy.mjs';
if (existsSync(HIERARCHY)) {
  try {
    execFileSync(process.execPath, [HIERARCHY, '--staged'], { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
}

process.exit(0);
