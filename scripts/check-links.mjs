/**
 * Fail if a pointer in the documentation does not resolve.
 *
 * This project's documentation is deliberately a router: CLAUDE.md is short
 * because the reasoning lives in docs/notes/, in the two READMEs under tools/,
 * and in doc comments, and CLAUDE.md points at all of it. (Do not write that
 * tools path as a glob here -- the star-slash ends this comment.) A rotted
 * pointer is
 * therefore worse here than a stale sentence would be somewhere else -- a
 * session follows it, finds nothing, and concludes nothing was written.
 *
 * Two kinds of pointer, and both rot silently:
 *
 *   1. A relative link.  `[gemini.md](docs/notes/gemini.md)` breaks when a file
 *      moves. Nothing renders this markdown, so nobody sees a broken link.
 *
 *   2. A cited section heading.  Rows in CLAUDE.md's routing table read
 *      "[`gemini.md`](docs/notes/gemini.md) -- *The units audit*", and the
 *      Architecture section promises that a heading quoted anywhere in the file
 *      is findable with `grep -rn "<name>" docs/notes/`. Nothing checked that
 *      promise, and a renamed heading breaks it with no other symptom.
 *
 * Added 2026-09-06, after the second kind was found broken by hand. The
 * parameters row cited "the first measurement that was a negative result"; the
 * heading read "... that was a *negative* result", with emphasis inside it, so
 * the plain-text grep the promise rests on missed it. One defect in 22
 * citations, invisible to every other check in this repository.
 *
 * Usage:  node scripts/check-links.mjs        (exit 1 on any hit)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Directories swept for markdown, matching scripts/check-encoding.mjs. */
const DIRS = ['docs', 'src', 'tools', '.claude', '.github'];

/** Individually named markdown at the repo root. */
const ROOT_FILES = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'];

const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

/**
 * Link targets that are correct but not resolvable on disk.
 *
 * README's build badge links to `../../actions`, which GitHub resolves against
 * the repository URL. It is not a path and there is nothing here to check it
 * against. Keep this list short: an entry here is a check turned off.
 */
const ALLOW_LINKS = new Set(['../../actions']);

/**
 * A citation is an emphasised phrase sitting on a line that also carries a
 * relative link, and of a length a heading plausibly has.
 *
 * The floor keeps ordinary emphasis out: "*why* it is outside" is not a
 * heading. The ceiling keeps long italic prose out -- docs/PRD.md emphasises
 * whole sentences of 20 to 40 words, which are statements rather than
 * pointers. The longest real citation in the repo is 11 words, so 14 leaves
 * room without letting a paragraph through. A heading longer than that is not
 * checked; write shorter headings.
 */
const MIN_CITATION_WORDS = 3;
const MAX_CITATION_WORDS = 14;

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EMPHASIS = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
const CODE_SPAN = /`[^`]*`/g;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
    } else if (entry.endsWith('.md')) {
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

/** Read a linked file once, so a table of 35 rows does not read gemini.md 35 times. */
const cache = new Map();
const readTarget = (path) => {
  if (!cache.has(path)) {
    try {
      cache.set(path, readFileSync(path, 'utf8'));
    } catch {
      cache.set(path, null);
    }
  }
  return cache.get(path);
};

// Deliberately strict: case and whitespace only. It is tempting to strip
// backticks and asterisks from both sides so a heading and its citation can
// differ in markup -- and that is exactly wrong here, because the promise being
// checked is that a LITERAL `grep -rn "<name>"` finds the heading. Stripping
// the markup makes the check pass on the one defect it was written to catch: a
// heading reading "a *negative* result" cited as "a negative result" greps to
// nothing, and a tolerant comparison says it is fine. Verified: with markup
// stripping the reintroduced defect passed; with this, it fails. All 41
// citations in the repo satisfy the strict form today, so tolerance buys
// nothing and costs the check its purpose.
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Heading lines of a file, cached alongside its text. */
const headingCache = new Map();
const headingsOf = (path) => {
  if (!headingCache.has(path)) {
    const body = readTarget(path);
    headingCache.set(path, body === null ? [] : body.split(/\r?\n/).filter((l) => /^#{1,6}\s/.test(l)));
  }
  return headingCache.get(path);
};

const badLinks = [];
const badCitations = [];
let linksChecked = 0;
let citationsChecked = 0;

for (const file of new Set(files)) {
  const name = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const dir = dirname(file);

  text.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    const targets = [];

    for (const m of line.matchAll(LINK)) {
      const raw = m[1];
      if (/^(https?:|mailto:|#)/.test(raw) || ALLOW_LINKS.has(raw)) continue;
      const path = resolve(dir, raw.split('#')[0]);
      linksChecked++;
      if (!existsSync(path)) {
        badLinks.push({ file: name, line: lineNo, raw });
      } else {
        targets.push(path);
      }
    }

    if (targets.length === 0) return;

    // Code spans first: `*.log` and `npm run *` are globs, not emphasis.
    const prose = line.replace(CODE_SPAN, ' ');
    for (const m of prose.matchAll(EMPHASIS)) {
      const phrase = m[1].trim();
      const words = phrase.split(/\s+/).length;
      if (words < MIN_CITATION_WORDS || words > MAX_CITATION_WORDS) continue;
      citationsChecked++;
      // The linked files are searched in full, because a citation sometimes
      // quotes a sentence rather than a heading.
      //
      // The CITING file is searched for headings only, and that distinction is
      // load-bearing rather than fussy. CLAUDE.md legitimately points at its own
      // sections ("for the PowerShell reason in *Read this first*"), so it has
      // to be a candidate -- but searching its whole body makes every check pass
      // for free, since the phrase is sitting right there in the line being
      // checked. An earlier draft did exactly that and reported a clean sweep
      // with the known defect reintroduced.
      const found =
        targets.some((t) => {
          const body = readTarget(t);
          return body !== null && norm(body).includes(norm(phrase));
        }) || headingsOf(file).some((h) => norm(h).includes(norm(phrase)));
      if (!found) {
        badCitations.push({ file: name, line: lineNo, phrase, targets: targets.map((t) => relative(ROOT, t).split(sep).join('/')) });
      }
    }
  });
}

// A sweep that quietly stops matching files looks identical to a clean sweep.
if (linksChecked < 100) {
  console.error(`Only ${linksChecked} links were checked. The file selection is probably broken.`);
  process.exit(1);
}

if (badLinks.length) {
  console.error('Broken relative links. The target does not exist:\n');
  for (const { file, line, raw } of badLinks) console.error(`  ${file}:${line}  ->  ${raw}`);
  console.error('');
}

if (badCitations.length) {
  console.error('Cited section names that do not appear in the file they point at.\n');
  console.error('Either the heading was renamed, or it carries inline markup that the');
  console.error('citation does not -- a heading meant to be grepped should be plain.\n');
  for (const { file, line, phrase, targets } of badCitations) {
    console.error(`  ${file}:${line}`);
    console.error(`      cites: "${phrase}"`);
    console.error(`      in:    ${targets.join(', ')}`);
  }
  console.error('');
}

if (badLinks.length || badCitations.length) process.exit(1);

console.log(
  `Pointers clean: ${linksChecked} relative links and ${citationsChecked} cited section names resolve.`
);
