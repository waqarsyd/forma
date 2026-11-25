/**
 * The project hierarchy: every place in Forma that has to agree with a change,
 * and the check, run on every commit by the pre-commit hook, that a change
 * reached each one (2026-11-23, asked for by the owner).
 *
 * Why it exists. A feature is never one file. Adding an MCP connection, say,
 * is code in src/lib and App.tsx, and it is also a line on the Features page,
 * an article on the Docs page (which the chat answers questions about Forma
 * from), a release note, the product spec, the note that owns the area, the
 * privacy policy when it reaches a new party, and the CSP when the browser
 * reaches a new origin. Taking a feature away reaches the same places. Nothing
 * linked them, so a change could land with the code done and the pages still
 * describing the product as it was. This file is that link, written once.
 *
 * Two strengths of rule:
 *
 *   block   always true here, so the commit waits until the named file is in
 *           it too: a file added under src/lib is named in
 *           docs/project-structure.md, a test file added is a row in
 *           testing.md, a version bump has its release entry. A review cannot
 *           stand in for one of these.
 *   review  a checklist that needs judgement: does this change alter what the
 *           Features page says? The commit waits until every line not already
 *           in the commit has been looked at and the review is recorded with
 *           `npm run check:hierarchy -- --reviewed`. The record is a hash of
 *           exactly what is staged, kept inside .git and never committed, so
 *           staging anything more asks again.
 *
 * A surface already in the commit is ticked and asks for nothing more.
 *
 * The hierarchy guards itself. Every path it names must exist, and
 * docs/project-hierarchy.md, the readable copy, is written from this file by
 * `--write` and must match it: the commit is blocked on either, and
 * src/server/checkHierarchy.test.ts holds both, so CI does too.
 *
 * To change the hierarchy, edit SURFACES and RULES below, then
 * `npm run check:hierarchy -- --write`. Keep this file pure ASCII: what it
 * prints goes to a Windows console.
 *
 * Usage:
 *   npm run check:hierarchy                what the current changes reach
 *                                          (what is staged, else everything
 *                                          uncommitted); exits 1 on a block
 *   npm run check:hierarchy -- --reviewed  record the review of what is staged
 *   npm run check:hierarchy -- --list      print the whole hierarchy
 *   npm run check:hierarchy -- --write     rewrite docs/project-hierarchy.md
 *   node scripts/check-hierarchy.mjs --staged   what the pre-commit hook runs
 *
 * Bypass for one commit, as for the rest of the hook: git commit --no-verify.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The readable copy, written from this file. */
export const DOC_PATH = 'docs/project-hierarchy.md';

/** The levels of the hierarchy, from the code outwards. */
export const LAYERS = [
  { id: 'code', title: 'The code and its tests' },
  { id: 'spec', title: 'The spec, the notes and the map of the code' },
  { id: 'site', title: 'The public site and the release notes' },
  { id: 'repo', title: 'The repository front door' },
  { id: 'config', title: 'Configuration that must agree with the code' },
];

/**
 * Every surface a change may have to reach. A path ending in a slash is a
 * folder: any file in it counts as reaching it.
 */
export const SURFACES = {
  testing: { layer: 'code', path: 'docs/notes/testing.md', what: 'every test file, its case count, and the total' },
  claims: { layer: 'code', path: 'src/components/publicClaims.test.ts', what: 'what the public pages claim, held to the code; add a claim when a page states a fact the code can answer' },
  rulesTests: { layer: 'code', path: 'tests/', what: 'the Firestore rules suite, run against the emulator' },
  designerRelease: { layer: 'code', path: 'src/lib/designerRelease.ts', what: 'the Forma Designer release the site offers, and what it needs' },

  prd: { layer: 'spec', path: 'docs/PRD.md', what: 'the product spec: what Forma does, and what is out of scope' },
  notes: { layer: 'spec', path: 'docs/notes/', what: 'the note that owns the area; the routing table in CLAUDE.md says which' },
  appShell: { layer: 'spec', path: 'docs/notes/app-shell.md', what: 'the workspace, routing and the public pages' },
  persistence: { layer: 'spec', path: 'docs/notes/persistence.md', what: 'Firestore, the device, the rules, sign-in and deletion' },
  geminiNote: { layer: 'spec', path: 'docs/notes/gemini.md', what: 'the AI call, the prompt, the repair chain and what RepxProbe measured of DevExpress; the SQL data source, and what Forma Designer is asked (/inspect, /sql)' },
  parity: { layer: 'spec', path: 'docs/proposals/devexpress-parity.md', what: "DevExpress 20.1's print, measured row by row with RepxProbe render and inspect, and what the Preview matches" },
  mcpNote: { layer: 'spec', path: 'docs/notes/mcp.md', what: "Forma's MCP server and command line, the Node side of Forma: the command a host runs, the stdout rule, the folders and paths a tool may use, what a tool returns, and where it differs from the browser" },
  structure: { layer: 'spec', path: 'docs/project-structure.md', what: 'the file layout; names every file under src/lib, src/services, src/components, src/server and src/mcp' },
  claude: { layer: 'spec', path: 'CLAUDE.md', what: 'the code map, the routing table, the commands, and the facts stated in more than one file' },
  skill: { layer: 'spec', path: 'docs/skills/devexpress-repx/SKILL.md', what: 'what Forma measured about the REPX format, for a person or an assistant editing a .repx; scripts/repx.ts stands on it, and the MCP server serves it' },
  designerReadme: { layer: 'spec', path: 'tools/RepxDesigner/README.md', what: 'Forma Designer: its routes, its guards, its download and install' },
  probeReadme: { layer: 'spec', path: 'tools/RepxProbe/README.md', what: 'RepxProbe: what it asks DevExpress, and how' },

  home: { layer: 'site', path: 'src/components/LandingPage.tsx', what: 'the home page (/)' },
  features: { layer: 'site', path: 'src/components/FeaturesPage.tsx', what: 'the Features page (/features)' },
  docs: { layer: 'site', path: 'src/components/DocsPage.tsx', what: 'the Docs page (/docs); the chat answers questions about Forma from it' },
  faq: { layer: 'site', path: 'src/components/faqs.tsx', what: 'the questions on /faq and the Docs page' },
  info: { layer: 'site', path: 'src/components/infoPages.tsx', what: 'security, pricing, examples, compare, about, self-host and download' },
  legal: { layer: 'site', path: 'src/components/LegalPage.tsx', what: 'terms, privacy and accessibility; the privacy policy names every third party the code reaches' },
  releases: { layer: 'site', path: 'src/lib/releases.ts', what: 'the release notes: /changelog, its feed, What is new in the app, and each GitHub release' },
  routeTitles: { layer: 'site', path: 'src/lib/routes.ts', what: 'each route\'s document title' },
  seo: { layer: 'site', path: 'src/lib/seo.ts', what: 'the routes search engines index, and their descriptions' },
  prerender: { layer: 'site', path: 'src/prerender.tsx', what: 'the pages the build draws into HTML' },
  publicPages: { layer: 'site', path: 'src/components/publicPages.tsx', what: 'which component draws each public route' },
  header: { layer: 'site', path: 'src/components/SiteHeader.tsx', what: 'the site header\'s links' },
  footer: { layer: 'site', path: 'src/components/SiteFooter.tsx', what: 'the site footer\'s links' },
  mobileNav: { layer: 'site', path: 'src/components/MobileNav.tsx', what: 'the phone menu\'s links' },

  readme: { layer: 'repo', path: 'README.md', what: 'the front door: setup, the script table, the honest limitations' },
  security: { layer: 'repo', path: 'SECURITY.md', what: 'how to report a vulnerability, and what the threat model covers' },
  contributing: { layer: 'repo', path: 'CONTRIBUTING.md', what: 'what a contributor runs, what the hook blocks, what a pull request needs' },

  securityHeaders: { layer: 'config', path: 'src/server/securityHeaders.ts', what: 'the CSP; connect-src is every origin the browser may reach' },
  firebaseJson: { layer: 'config', path: 'firebase.json', what: 'the live site\'s headers and rewrites; hostingConfig.test.ts prints what it must say' },
  firestoreRules: { layer: 'config', path: 'firestore.rules', what: 'what an account may read and write in Firestore' },
  checksYml: { layer: 'config', path: '.github/workflows/checks.yml', what: 'CI: the Node versions and every check' },
  lockfile: { layer: 'config', path: 'package-lock.json', what: 'the installed versions; npm ci fails when it disagrees with package.json' },
  envExample: { layer: 'config', path: '.env.example', what: 'the environment variables there are; no AI key ever belongs in .env' },
  encoding: { layer: 'config', path: 'scripts/check-encoding.mjs', what: 'ROOT_FILES, the root files the mojibake sweep reads' },
};

const LAYOUT_DIRS = ['src/lib/', 'src/services/', 'src/components/', 'src/server/', 'src/mcp/'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
/** Where a removed file's name is looked for. */
const DOC_PATHS = ['docs', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', '.claude', 'tools/RepxDesigner/README.md', 'tools/RepxProbe/README.md'];

const isTest = (p) => /\.test\.(ts|tsx|js|mjs)$/.test(p);
const isTestFile = (p) => isTest(p) && (p.startsWith('src/') || p.startsWith('tests/'));
const SURFACE_PATHS = new Set(Object.values(SURFACES).map((s) => s.path));
/** Code a person uses: what the pages, the notes and the release notes describe. */
const isFeatureCode = (p) =>
  !isTest(p) && !SURFACE_PATHS.has(p) && !p.endsWith('.d.ts') && !p.startsWith('src/mcp/') && (/^src\/.+\.(ts|tsx)$/.test(p) || p === 'server.ts' || p === 'index.html');

/** Both sides of a rename, or the one path. */
const pathsOf = (c) => (c.oldPath ? [c.oldPath, c.path] : [c.path]);
const labelOf = (c) =>
  c.status === 'A' ? `${c.path} (added)`
  : c.status === 'D' ? `${c.path} (removed)`
  : c.status === 'R' ? `${c.oldPath} -> ${c.path} (renamed)`
  : c.path;
const addedOrRemoved = (c) => c.status !== 'M';
const changed = (pkg, field) => pkg !== null && JSON.stringify(pkg.before?.[field] ?? null) !== JSON.stringify(pkg.after?.[field] ?? null);
const scriptNames = (side) => Object.keys(side?.scripts ?? {}).sort().join('\n');

/**
 * What a change is checked against. `when` names the changes that trigger the
 * rule; `surfaces` names, by key, what they must reach. A rule may instead
 * work out its own lines (`check`), as the one for removed files does.
 */
export const RULES = [
  {
    id: 'layout', kind: 'block',
    title: 'A file is added, removed or renamed under src/lib, src/services, src/components, src/server or src/mcp',
    why: 'docs/project-structure.md names every file there, so it changes in the same commit.',
    surfaces: ['structure'],
    when: ({ changes }) => changes.filter((c) => addedOrRemoved(c) && pathsOf(c).some((p) => !isTest(p) && LAYOUT_DIRS.some((d) => p.startsWith(d)))).map(labelOf),
  },
  {
    id: 'test-files', kind: 'block',
    title: 'A test file is added, removed or renamed',
    why: 'testing.md lists every test file with its count, and the total moves with it. Recount by running the suite, never by grepping.',
    surfaces: ['testing'],
    when: ({ changes }) => changes.filter((c) => addedOrRemoved(c) && pathsOf(c).some(isTestFile)).map(labelOf),
  },
  {
    id: 'node-floor', kind: 'block',
    title: 'The Node floor changes (engines in package.json)',
    why: 'The floor is restated in five other files, and nothing else keeps them in step.',
    surfaces: ['readme', 'contributing', 'checksYml', 'info', 'claude'],
    when: ({ pkg }) => (changed(pkg, 'engines') ? ['package.json engines'] : []),
  },
  {
    id: 'version', kind: 'block',
    title: 'The release version changes (version in package.json)',
    why: 'Every deploy of main is a numbered release: its notes are the newest entry of releases.ts, the lockfile carries the version too, and so does the Docs page, whose MCP article clones v<version> (since 1.7.0, held by publicClaims.test.ts).',
    surfaces: ['releases', 'lockfile', 'docs'],
    when: ({ pkg }) => (changed(pkg, 'version') ? ['package.json version'] : []),
  },
  {
    id: 'dependencies', kind: 'block',
    title: 'A dependency or an override changes',
    why: 'npm ci, the first thing CI runs, fails when package.json and the lockfile disagree.',
    surfaces: ['lockfile'],
    when: ({ pkg }) => DEPENDENCY_FIELDS.filter((f) => changed(pkg, f)).map((f) => `package.json ${f}`),
  },
  {
    id: 'scripts-list', kind: 'block',
    title: 'An npm script is added or removed',
    why: 'The Commands in CLAUDE.md and the script table in README.md list every script.',
    surfaces: ['claude', 'readme'],
    when: ({ pkg }) => (pkg !== null && scriptNames(pkg.before) !== scriptNames(pkg.after) ? ['package.json scripts'] : []),
  },
  {
    id: 'root-file', kind: 'block',
    title: 'A file is added at the root of the repository',
    why: 'The mojibake sweep reads a root file only once ROOT_FILES names it.',
    surfaces: ['encoding'],
    when: ({ changes, topLevel }) => changes.filter((c) => c.status === 'A' && !c.path.includes('/') && !topLevel.has(c.path)).map(labelOf),
  },
  {
    id: 'top-dir', kind: 'block',
    title: 'A new top-level directory appears',
    why: 'A new top-level directory needs a stated reason, in the file layout and in the overview of the top level in README.md.',
    surfaces: ['structure', 'readme'],
    when: ({ changes, topLevel }) => [...new Set(changes.filter((c) => c.status !== 'D' && c.path.includes('/')).map((c) => c.path.split('/')[0]).filter((d) => !topLevel.has(d)))].map((d) => `${d}/ (new)`),
  },
  {
    id: 'feature', kind: 'review',
    title: 'Code a person uses is added, changed or removed',
    why: 'A feature is never one file. Each line below describes the product, and must describe it as it is after this commit, including what was taken away.',
    surfaces: ['releases', 'features', 'docs', 'faq', 'home', 'info', 'legal', 'prd', 'notes', 'readme', 'claude', 'claims', 'securityHeaders', 'firestoreRules'],
    when: ({ changes }) => changes.filter((c) => pathsOf(c).some(isFeatureCode)).map(labelOf),
  },
  {
    id: 'mcp', kind: 'review',
    title: "Forma's MCP server and command line: a file under src/mcp, or scripts/repx.ts, changes",
    why: 'They are how other programs, and a person at a terminal, use Forma: the tools and commands they offer, what each needs and where data goes are stated on the Docs page, in its FAQ, in README.md, on the security and self-host pages, in the privacy policy, in SECURITY.md, in CONTRIBUTING.md, in the REPX skill and in docs/notes/mcp.md, which owns them; publicClaims.test.ts holds the tool list (src/mcp/toolList.ts) to the Docs page, the FAQ, /self-host and README.md, and the command list (src/mcp/cliCommands.ts) to the Docs page, README.md and the REPX skill; legalDisclosure.test.ts holds the privacy policy to both; .env.example says neither reads it. The command line\'s code is in src/mcp beside the server, a second entry with its own launcher (since 2026-11-24, CLI-1), so this rule sees every file of it; scripts/repx.ts, the command line until then, only forwards to it.',
    surfaces: ['readme', 'docs', 'faq', 'info', 'legal', 'security', 'contributing', 'skill', 'prd', 'releases', 'mcpNote', 'claude', 'claims', 'envExample'],
    when: ({ changes }) => changes.filter((c) => pathsOf(c).some((p) => (p.startsWith('src/mcp/') && !isTest(p)) || p === 'scripts/repx.ts')).map(labelOf),
  },
  {
    id: 'removed', kind: 'review',
    title: 'A file is removed or renamed, and the docs still name it',
    why: 'A pointer to something gone is worse than none. Update each mention, or keep it where the history is the point and date the removal.',
    check: removedMentions,
  },
  {
    id: 'test-cases', kind: 'review',
    title: 'A test file changes',
    why: 'A case added or removed changes its row in testing.md and the total. Recount by running the suite, never by grepping.',
    surfaces: ['testing'],
    when: ({ changes }) => changes.filter((c) => c.status === 'M' && isTestFile(c.path)).map(labelOf),
  },
  {
    id: 'scripts-dir', kind: 'review',
    title: 'A file is added, removed or renamed under scripts',
    why: 'The file layout names the scripts a person runs, and CLAUDE.md the ones a session needs.',
    surfaces: ['structure', 'claude'],
    when: ({ changes }) => changes.filter((c) => addedOrRemoved(c) && pathsOf(c).some((p) => p.startsWith('scripts/') && !isTest(p))).map(labelOf),
  },
  {
    id: 'script-commands', kind: 'review',
    title: 'What an npm script runs changes',
    why: 'CLAUDE.md and README.md say what each script does.',
    surfaces: ['claude', 'readme'],
    when: ({ pkg }) => (pkg !== null && scriptNames(pkg.before) === scriptNames(pkg.after) && changed(pkg, 'scripts') ? ['package.json scripts'] : []),
  },
  {
    id: 'designer', kind: 'review',
    title: 'Forma Designer changes (tools/RepxDesigner)',
    why: 'Its README is its note. The site offers its release (src/lib/designerRelease.ts, and the download page in infoPages.tsx, whose security and self-host pages describe it too, with the download page\'s description in seo.ts), and what it does, what it reads and what it is sent are stated on the home page, in the Docs page\'s designer and data articles, on the Features page, in the FAQ, in README.md, in the PRD, and in the terms and the privacy policy (LegalPage.tsx), with publicClaims.test.ts holding some of it to the code; app-shell.md owns Open in designer in the workspace, gemini.md what the workspace asks it (/inspect, /sql), and docs/notes/mcp.md says how Forma\'s Node side is to reach it. CLAUDE.md says what its README owns, which Forma Designer first answers /inspect, and the session rule for starting it (--serve is the person\'s to start), all of which a new route or verb changes: a verb that prints and exits is the one way the design lets an agent start it. Its ReportGuard (Probe.cs) must refuse what src/lib/inspectionGuard.ts refuses, and inspectionGuard.test.ts holds their lists to each other. A new way in, such as a verb that reads a database, is a change to the threat model in SECURITY.md.',
    surfaces: ['designerRelease', 'claims', 'prd', 'appShell', 'geminiNote', 'mcpNote', 'designerReadme', 'claude', 'home', 'docs', 'features', 'faq', 'info', 'legal', 'seo', 'releases', 'readme', 'security'],
    when: ({ changes }) => changes.filter((c) => pathsOf(c).some((p) => p.startsWith('tools/RepxDesigner/') && !SURFACE_PATHS.has(p))).map(labelOf),
  },
  {
    id: 'tools', kind: 'review',
    title: 'RepxProbe, or another tool under tools that is not Forma Designer, changes',
    why: 'Its README is its note. What RepxProbe measured, and the commands that measured it (render, inspect, emit-gauge, emit-localize, the sql-* commands), are cited in gemini.md, the DevExpress parity proposal, the PRD, app-shell.md, the REPX skill, Forma Designer\'s README and CLAUDE.md, so a command renamed or dropped leaves a citation in each to update or date.',
    surfaces: ['probeReadme', 'geminiNote', 'parity', 'prd', 'appShell', 'skill', 'designerReadme', 'claude'],
    when: ({ changes }) => changes.filter((c) => pathsOf(c).some((p) => p.startsWith('tools/') && !p.startsWith('tools/RepxDesigner/') && !SURFACE_PATHS.has(p))).map(labelOf),
  },
  {
    id: 'csp', kind: 'review',
    title: 'The security headers change',
    why: 'firebase.json carries the same policy to the live site, and a new origin in connect-src is a new party the privacy policy must name.',
    surfaces: ['firebaseJson', 'legal', 'info'],
    when: ({ changes }) => changes.filter((c) => c.path === SURFACES.securityHeaders.path).map(labelOf),
  },
  {
    id: 'rules', kind: 'review',
    title: 'The Firestore rules change',
    why: 'The rules suite holds every rule, persistence.md owns why, and the privacy policy says what is kept.',
    surfaces: ['rulesTests', 'persistence', 'legal'],
    when: ({ changes }) => changes.filter((c) => c.path === SURFACES.firestoreRules.path).map(labelOf),
  },
  {
    id: 'routes', kind: 'review',
    title: 'The list of routes changes (src/lib/router.ts)',
    why: 'A page has a title, a description, prerendered HTML, a component that draws it, and links in the header, the footer and the phone menu.',
    surfaces: ['routeTitles', 'seo', 'prerender', 'publicPages', 'header', 'footer', 'mobileNav', 'appShell'],
    when: ({ changes }) => changes.filter((c) => c.path === 'src/lib/router.ts').map(labelOf),
  },
  {
    id: 'ci', kind: 'review',
    title: 'A CI workflow changes',
    why: 'The check list is stated in CLAUDE.md, README.md, CONTRIBUTING.md and checks.yml, and nothing keeps them in step.',
    surfaces: ['claude', 'readme', 'contributing'],
    when: ({ changes }) => changes.filter((c) => c.path.startsWith('.github/workflows/')).map(labelOf),
  },
  {
    id: 'hook', kind: 'review',
    title: 'The pre-commit hook changes',
    why: 'CONTRIBUTING.md tells a contributor what it blocks, and CLAUDE.md tells a session.',
    surfaces: ['contributing', 'claude'],
    when: ({ changes }) => changes.filter((c) => c.path.startsWith('.githooks/')).map(labelOf),
  },
];

/**
 * The docs that still name a removed or renamed file. A name shorter than five
 * letters would match too much, and a file moved without being renamed is
 * still named correctly.
 */
function removedMentions({ changes, mentionsOf }) {
  const triggers = [];
  const byDoc = new Map();
  for (const c of changes) {
    if (c.status !== 'D' && c.status !== 'R') continue;
    const gone = c.oldPath ?? c.path;
    const name = basename(gone, extname(gone));
    if (name.length < 5 || (c.oldPath && basename(c.path) === basename(c.oldPath))) continue;
    const docs = mentionsOf(name).filter((d) => d !== DOC_PATH && d !== gone);
    if (!docs.length) continue;
    triggers.push(labelOf(c));
    for (const d of docs) byDoc.set(d, [...(byDoc.get(d) ?? []), name]);
  }
  const items = [...byDoc].map(([path, names]) => ({ path, what: `still names ${names.join(', ')}` }));
  return { triggers, items };
}

/**
 * Every rule a change triggers, with each line it must reach marked as reached
 * or not. Pure: the caller gathers the change.
 *
 * ctx.changes     [{ status: 'A' | 'M' | 'D' | 'R', path, oldPath? }]
 * ctx.pkg         { before, after } (package.json parsed) when it changed, else null
 * ctx.topLevel    Set of the names at the top of the repository before the change
 * ctx.mentionsOf  name -> paths of the docs that name it
 */
export function findings(ctx) {
  const reached = ctx.changes.flatMap(pathsOf);
  const isReached = (p) => (p.endsWith('/') ? reached.some((r) => r.startsWith(p)) : reached.includes(p));
  const out = [];
  for (const rule of RULES) {
    const { triggers, items } = rule.check
      ? rule.check(ctx)
      : { triggers: rule.when(ctx), items: rule.surfaces.map((k) => SURFACES[k]) };
    if (!triggers.length || !items.length) continue;
    const lines = items.map((s) => ({ path: s.path, what: s.what, reached: isReached(s.path) }));
    out.push({ rule, triggers, lines, open: lines.filter((l) => !l.reached) });
  }
  return out;
}

/** Surfaces the hierarchy names that are not on disk. */
export function missingSurfaces(exists) {
  return Object.values(SURFACES).filter((s) => !exists(s.path)).map((s) => s.path);
}

/** The readable copy, docs/project-hierarchy.md. */
export function hierarchyMarkdown() {
  const link = (p) => `[\`${p}\`](${p.startsWith('docs/') ? p.slice('docs/'.length) : `../${p}`})`;
  const L = [
    '# Project hierarchy',
    '',
    '<!-- Written by `npm run check:hierarchy -- --write` from scripts/check-hierarchy.mjs. Edit the script, then write this file again; a test fails while the two differ. -->',
    '',
    'Every place in Forma that has to agree with a change, and the rules each commit is checked against. A feature is never one file: an MCP connection added in `src/lib` is also a line on the Features page, an article on the Docs page, a release note, the product spec, the note that owns the area, and, once it reaches a new party or a new origin, the privacy policy and the CSP. Taking a feature away reaches the same places.',
    '',
    'The pre-commit hook runs the check on every commit (`.githooks/pre-commit.mjs`), so a change cannot land with the code done and the pages still describing the product as it was. The reasoning is the doc comment of [`scripts/check-hierarchy.mjs`](../scripts/check-hierarchy.mjs).',
    '',
    'Two strengths of rule. One that blocks is always true here, so the commit waits until the named file is in it. One that asks for a review is a checklist that needs judgement: the commit waits until every line not already in the commit has been looked at, and the review is recorded. A line already in the commit is ticked.',
    '',
    '## Every place a change may have to reach',
    '',
  ];
  for (const layer of LAYERS) {
    L.push(`### ${layer.title}`, '', '| Surface | What it holds |', '|---|---|');
    for (const s of Object.values(SURFACES).filter((x) => x.layer === layer.id)) L.push(`| ${link(s.path)} | ${s.what} |`);
    L.push('');
  }
  L.push('## What each change is checked against', '', '| When | It must reach | Strength | Why |', '|---|---|---|---|');
  for (const r of RULES) {
    const reach = r.surfaces ? r.surfaces.map((k) => `\`${SURFACES[k].path}\``).join(', ') : 'every doc that still names it';
    L.push(`| ${r.title} | ${reach} | ${r.kind === 'block' ? 'Blocks' : 'Review'} | ${r.why} |`);
  }
  L.push(
    '',
    '## Running it',
    '',
    '```',
    'npm run check:hierarchy                 # what the current changes reach: what is staged, else everything uncommitted',
    'npm run check:hierarchy -- --reviewed   # after going through the list: record the review of what is staged',
    'npm run check:hierarchy -- --list       # print this hierarchy',
    'npm run check:hierarchy -- --write      # write this file again after editing the script',
    '```',
    '',
    'Stage everything the commit will hold before recording a review: the record is a hash of exactly what is staged, kept inside `.git` and never committed, so staging anything more asks again. `git commit --no-verify` skips the check, with the rest of the hook, for one commit.',
    '',
  );
  return L.join('\n');
}

/* ---- gathering the change, and the command line ------------------------- */

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};

/** `git diff --name-status -z` output as changes; a copy counts as an added file. */
export function parseNameStatus(raw) {
  const t = raw.split('\0');
  const out = [];
  for (let i = 0; i + 1 < t.length; ) {
    const code = t[i];
    if (!code) break;
    if (code[0] === 'R' || code[0] === 'C') {
      out.push(code[0] === 'R' ? { status: 'R', oldPath: t[i + 1], path: t[i + 2] } : { status: 'A', path: t[i + 2] });
      i += 3;
    } else {
      out.push({ status: code[0] === 'A' || code[0] === 'D' ? code[0] : 'M', path: t[i + 1] });
      i += 2;
    }
  }
  return out;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function gather(staged) {
  const changes = staged
    ? parseNameStatus(git('diff', '--cached', '--name-status', '-M', '-z'))
    : [
        ...parseNameStatus(tryGit('diff', 'HEAD', '--name-status', '-M', '-z')),
        ...tryGit('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).map((path) => ({ status: 'A', path })),
      ];
  const pkgChanged = changes.some((c) => c.path === 'package.json');
  const after = staged ? tryGit('show', ':package.json') : existsSync('package.json') ? readFileSync('package.json', 'utf8') : '';
  const pkg = pkgChanged ? { before: parseJson(tryGit('show', 'HEAD:package.json')), after: parseJson(after) } : null;
  const topLevel = new Set(tryGit('ls-tree', '--name-only', 'HEAD').split('\n').filter(Boolean));
  const mentionsOf = (name) =>
    tryGit('grep', '-l', '-w', '-F', ...(staged ? ['--cached'] : []), '-e', name, '--', ...DOC_PATHS).split('\n').filter(Boolean);
  const doc = staged ? tryGit('show', `:${DOC_PATH}`) : existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : '';
  return { changes, pkg, topLevel, mentionsOf, doc };
}

/**
 * The hierarchy's own problems: a surface that is gone, or a readable copy that has drifted.
 * A commit that stages neither this script nor its doc leaves the committed pair as HEAD had
 * it, so the copy is not compared then: the working tree's script may already hold the next
 * commit's change (found 2026-11-23, committing the MCP work's first wave batch by batch).
 */
function selfCheck(doc, stagedChanges) {
  const out = missingSurfaces(existsSync).map((p) => `${p} is named in the hierarchy and does not exist: update SURFACES in scripts/check-hierarchy.mjs.`);
  const SCRIPT = 'scripts/check-hierarchy.mjs';
  const pairStaged = !stagedChanges || stagedChanges.some((c) => pathsOf(c).some((p) => p === SCRIPT || p === DOC_PATH));
  if (pairStaged && doc.replace(/\r\n/g, '\n') !== hierarchyMarkdown()) out.push(`${DOC_PATH} is not the hierarchy as the script writes it: run npm run check:hierarchy -- --write, and stage it.`);
  return out;
}

const stagedKey = () =>
  createHash('sha256')
    .update(tryGit('rev-parse', '--verify', '-q', 'HEAD').trim() || 'none')
    .update('\0')
    .update(git('diff', '--cached', '--binary', '--full-index', '--no-color', '--no-ext-diff'))
    .digest('hex');
const reviewFile = () => git('rev-parse', '--git-path', 'forma-hierarchy-reviewed').trim();
const reviewed = () => {
  const file = reviewFile();
  return existsSync(file) && readFileSync(file, 'utf8').trim() === stagedKey();
};

function printFinding(f) {
  const width = Math.max(...f.lines.map((l) => l.path.length));
  const shown = f.triggers.slice(0, 6).join(', ') + (f.triggers.length > 6 ? `, and ${f.triggers.length - 6} more` : '');
  console.log(`  * ${f.rule.title}`);
  console.log(`      why      ${f.rule.why}`);
  console.log(`      changed  ${shown}`);
  for (const l of f.lines) console.log(`      [${l.reached ? 'x' : ' '}] ${l.path.padEnd(width)}  ${l.what}`);
  console.log('');
}

function main(argv) {
  const args = new Set(argv);
  if (args.has('--list')) {
    process.stdout.write(hierarchyMarkdown());
    return 0;
  }
  if (args.has('--write')) {
    writeFileSync(DOC_PATH, hierarchyMarkdown());
    console.log(`Wrote ${DOC_PATH}.`);
    return 0;
  }
  const hook = args.has('--staged');
  const recording = args.has('--reviewed');
  const staged = hook || recording || tryGit('diff', '--cached', '--name-only') !== '';
  const ctx = gather(staged);
  if (!ctx.changes.length) {
    if (!hook) console.log(`Project hierarchy: nothing ${staged ? 'staged' : 'changed'}.`);
    return 0;
  }
  const all = findings(ctx);
  const own = selfCheck(ctx.doc, staged ? ctx.changes : null);
  const blocked = all.filter((f) => f.rule.kind === 'block' && f.open.length);
  const toReview = all.filter((f) => f.rule.kind === 'review' && f.open.length);
  const isReviewed = staged && toReview.length > 0 && reviewed();

  if (hook && !blocked.length && !own.length && (!toReview.length || isReviewed)) {
    if (all.length) console.log(`Project hierarchy: ${isReviewed ? 'the review of this commit is recorded' : 'every surface this change reaches is in the commit'}.`);
    return 0;
  }

  console.log(`\nProject hierarchy: ${ctx.changes.length} changed path(s), ${staged ? 'as staged' : 'uncommitted'}.\n`);
  if (own.length) {
    console.log('BLOCKED: the hierarchy itself is out of date.\n');
    for (const o of own) console.log(`  * ${o}`);
    console.log('');
  }
  if (blocked.length) {
    console.log('BLOCKED: each of these is always true here, so the commit waits until the unticked files are in it.\n');
    blocked.forEach(printFinding);
  }
  if (toReview.length) {
    console.log(`TO REVIEW${isReviewed ? ' (recorded for what is staged now)' : ''}: go through every unticked line. Update it if this change makes it untrue; leave it if it does not.\n`);
    toReview.forEach(printFinding);
  }
  if (!blocked.length && !own.length && !toReview.length) console.log('Every surface this change reaches is in it.\n');

  if (recording) {
    if (blocked.length || own.length) {
      console.log('Not recorded: a review cannot stand in for a blocked line. Fix those first.\n');
      return 1;
    }
    writeFileSync(reviewFile(), `${stagedKey()}\n`);
    console.log('Review recorded for exactly what is staged now. Commit when ready; staging anything more asks again.\n');
    return 0;
  }
  if (hook) {
    if (!blocked.length && !own.length) {
      console.log('When every line is done, stage your updates and record the review:');
      console.log('    npm run check:hierarchy -- --reviewed');
      console.log('then commit again. Staging anything after that asks again.\n');
    }
    console.log('Nothing has been committed. (git commit --no-verify skips this check for one commit.)\n');
    return 1;
  }
  if (!staged && toReview.length) console.log('This is a preview of what the commit will ask. Stage the change, then the hook checks what is staged.\n');
  return blocked.length || own.length ? 1 : 0;
}

const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : '';
if (invoked && invoked === fileURLToPath(import.meta.url).toLowerCase()) process.exit(main(process.argv.slice(2)));
