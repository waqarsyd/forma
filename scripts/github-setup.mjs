#!/usr/bin/env node
/**
 * The repository's GitHub settings, labels, milestones and roadmap, prepared
 * by the site audit for the owner (2026-11-08, items 107 and 108, with the
 * settings batch SH left on the owner's list). For the owner to run, with the
 * GitHub CLI signed in as the repository's owner:
 *
 *   node scripts/github-setup.mjs           show what would change; changes nothing
 *   node scripts/github-setup.mjs --apply   make the changes
 *
 * Not an npm script, for deploy.mjs's reason: it changes what the public sees,
 * and `npm run *` is in the committed permission list. Every step reads first
 * and changes only what differs, so a second run changes nothing.
 *
 * 1. Settings. The wiki and projects off: both were on and empty (item 107),
 *    and the roadmap lives in milestones and a discussion instead (item 108).
 *    Private vulnerability reporting on, which SECURITY.md, the contact page
 *    and /security all point at; vulnerability alerts and Dependabot security
 *    updates on, beside .github/dependabot.yml's version updates.
 * 2. The ruleset in .github/rulesets/main.json, on main (batch SH).
 * 3. Labels. The issue forms' own (bug, idea, output) already exist; this adds
 *    `security` and one `area: ...` label per area the changelog files a
 *    change under, AREA_LABELS in src/lib/releases.ts, which a test holds this
 *    list to.
 * 4. Milestones, one per item of the roadmap in docs/PRD.md section 6, as it
 *    stood on 2026-11-08. After this they live on GitHub: close one when its
 *    item ships, and take the item off section 6 in the same change.
 * 5. A "Roadmap" discussion in Announcements, its text section 6 itself, read
 *    from docs/PRD.md when this runs, so the roadmap keeps one copy; a later
 *    run brings the discussion up to date. GitHub has no API to pin a
 *    discussion: the script prints its address, and Pin is one click there.
 *
 * Pure ASCII, as every script here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'waqarsyd/forma';
const [OWNER, NAME] = REPO.split('/');
const apply = process.argv.includes('--apply');

const AREA_LABELS = [
  ['area: report design', 'Designing a report from a picture, a PDF, a .repx or words'],
  ['area: chat', 'The conversation, and the edits it makes to the open report'],
  ['area: preview', 'The Preview, its pages and what it draws'],
  ['area: export', 'PDF, Excel, CSV, Word, RTF, HTML, images and the .repx itself'],
  ['area: ocr', 'Reading the text of an image or a scan'],
  ['area: data', 'The Data tab, binding, data files and test data'],
  ['area: sharing', 'Shared reports and their links'],
  ['area: workspace', 'The workspace around the report: projects, Settings, the sidebar'],
  ['area: site', 'The public pages, the docs and the changelog'],
];
const LABELS = [['security', 'A weakness in how Forma keeps a key or a report safe', 'b60205'], ...AREA_LABELS.map(([n, d]) => [n, d, 'c5def5'])];

const MILESTONES = [
  ['PDFs past eight pages', 'Raise or remove the 8-page PDF cap (MAX_PDF_PAGES), and support multi-page .repx datasets. docs/PRD.md section 6.'],
  ['Editing by hand on the Preview', 'Deleting and adding a control, editing a table cell\'s text, and multi-select. The chat already deletes and adds controls. docs/PRD.md section 6.'],
  ['Real barcodes', 'Barcodes encoded from their value in the Preview, which draws a placeholder of bars, and real gauges, barcodes and charts in the mockup. docs/PRD.md section 6.'],
  ['Password strength at sign-up', 'A password-strength indicator at sign-up; the minimum is eight characters already. docs/PRD.md section 6.'],
  ['The report library, evaluated', 'Run the evaluation in docs/proposals/rag.md, How we would know it worked, on real reports. docs/PRD.md section 6.'],
];

function gh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function ghJson(args) {
  const r = gh(args);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.out || 'null');
  } catch {
    return null;
  }
}
let changes = 0;
function change(what, args, input) {
  changes++;
  if (!apply) {
    console.log(`  would: ${what}`);
    return true;
  }
  const r = gh(args, input);
  console.log(`  ${r.ok ? 'done' : 'FAILED'}: ${what}${r.ok ? '' : ` (${r.err.split('\n')[0]})`}`);
  return r.ok;
}

if (!gh(['auth', 'status']).ok) {
  console.error('Stopped: the GitHub CLI is not signed in. Run gh auth login as the repository owner first.');
  process.exit(1);
}
console.log(apply ? `Applying to ${REPO}.` : `Dry run against ${REPO}: nothing is changed. Add --apply to make these changes.`);

// 1. Settings.
console.log('\n1. Settings');
const repo = ghJson(['api', `repos/${REPO}`]);
if (!repo) {
  console.error('Stopped: could not read the repository.');
  process.exit(1);
}
if (repo.has_wiki || repo.has_projects) {
  change('turn the wiki and projects off', ['api', '-X', 'PATCH', `repos/${REPO}`, '-F', 'has_wiki=false', '-F', 'has_projects=false']);
}
if (!ghJson(['api', `repos/${REPO}/private-vulnerability-reporting`])?.enabled) {
  change('turn private vulnerability reporting on', ['api', '-X', 'PUT', `repos/${REPO}/private-vulnerability-reporting`]);
}
if (!gh(['api', `repos/${REPO}/vulnerability-alerts`]).ok) {
  change('turn vulnerability alerts on', ['api', '-X', 'PUT', `repos/${REPO}/vulnerability-alerts`]);
}
if (!ghJson(['api', `repos/${REPO}/automated-security-fixes`])?.enabled) {
  change('turn Dependabot security updates on', ['api', '-X', 'PUT', `repos/${REPO}/automated-security-fixes`]);
}

// 2. The ruleset.
console.log('\n2. Ruleset');
const ruleset = readFileSync('.github/rulesets/main.json', 'utf8');
const rulesetName = JSON.parse(ruleset).name;
const existing = (ghJson(['api', `repos/${REPO}/rulesets`]) || []).find((r) => r.name === rulesetName);
if (existing) {
  change(`update the ruleset "${rulesetName}" from .github/rulesets/main.json`, ['api', '-X', 'PUT', `repos/${REPO}/rulesets/${existing.id}`, '--input', '-'], ruleset);
} else {
  change(`create the ruleset "${rulesetName}" from .github/rulesets/main.json`, ['api', '-X', 'POST', `repos/${REPO}/rulesets`, '--input', '-'], ruleset);
}

// 3. Labels.
console.log('\n3. Labels');
const labels = ghJson(['label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name,description,color']) || [];
for (const [name, description, color] of LABELS) {
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!found) change(`create the label "${name}"`, ['label', 'create', name, '--repo', REPO, '--description', description, '--color', color]);
  else if (found.description !== description) change(`describe the label "${name}"`, ['label', 'edit', name, '--repo', REPO, '--description', description]);
}

// 4. Milestones.
console.log('\n4. Milestones');
const milestones = ghJson(['api', `repos/${REPO}/milestones?state=all&per_page=100`]) || [];
for (const [title, description] of MILESTONES) {
  if (!milestones.some((m) => m.title === title)) {
    change(`create the milestone "${title}"`, ['api', '-X', 'POST', `repos/${REPO}/milestones`, '-f', `title=${title}`, '-f', `description=${description}`]);
  }
}

// 5. The roadmap discussion.
console.log('\n5. Roadmap discussion');
const prd = readFileSync('docs/PRD.md', 'utf8');
const section = prd.slice(prd.indexOf('## 6. Future Scope'));
const next = section.indexOf('\n## ', 3);
const body =
  'The roadmap, kept in [docs/PRD.md](https://github.com/' + REPO + '/blob/main/docs/PRD.md) and copied here by ' +
  '`scripts/github-setup.mjs`. Each item has a milestone; ideas go in the Ideas category, and an issue a milestone closes.\n\n' +
  (next < 0 ? section : section.slice(0, next)).replace(/^## 6\. Future Scope\n/, '').trim() + '\n';
const query =
  'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id ' +
  'discussionCategories(first: 25) { nodes { id name } } discussions(first: 100) { nodes { id title url body } } } }';
const data = ghJson(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${OWNER}`, '-f', `name=${NAME}`])?.data?.repository;
if (!data) {
  console.error('  could not read the discussions; is Discussions on?');
} else {
  const roadmap = data.discussions.nodes.find((d) => d.title === 'Roadmap');
  if (roadmap) {
    if (roadmap.body.trim() !== body.trim()) {
      change(`bring the Roadmap discussion up to date (${roadmap.url})`, ['api', 'graphql', '-f',
        'query=mutation($id: ID!, $body: String!) { updateDiscussion(input: {discussionId: $id, body: $body}) { discussion { url } } }',
        '-f', `id=${roadmap.id}`, '-f', `body=${body}`]);
    }
    console.log(`  Pin it, if it is not yet: ${roadmap.url} (Pin discussion, in its sidebar).`);
  } else {
    const category = data.discussionCategories.nodes.find((c) => c.name === 'Announcements') || data.discussionCategories.nodes.find((c) => c.name === 'General');
    const made = change(`start the Roadmap discussion in ${category?.name}`, ['api', 'graphql', '-f',
      'query=mutation($repo: ID!, $cat: ID!, $body: String!) { createDiscussion(input: {repositoryId: $repo, categoryId: $cat, title: "Roadmap", body: $body}) { discussion { url } } }',
      '-f', `repo=${data.id}`, '-f', `cat=${category?.id}`, '-f', `body=${body}`]);
    if (made && apply) console.log(`  Pin it: open https://github.com/${REPO}/discussions, then the Roadmap discussion, then Pin discussion.`);
  }
}

console.log(changes ? `\n${changes} change${changes === 1 ? '' : 's'} ${apply ? 'made' : 'to make'}.` : '\nNothing to change: GitHub already matches.');
