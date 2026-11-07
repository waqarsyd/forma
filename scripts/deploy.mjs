#!/usr/bin/env node
/**
 * One deploy, the same every time (2026-11-07, site audit items 3, 100, 101).
 *
 *   node scripts/deploy.mjs              build, check, and deploy main: hosting and the rules
 *   node scripts/deploy.mjs --preview    the same build to a preview channel for 7 days
 *   node scripts/deploy.mjs --dry-run    everything but the deploy
 *
 * For the owner to run. It is deliberately not an npm script: the committed
 * permission list allows `npm run *`, and a deploy changes what the public
 * site serves, so it must never be one an agent can start without asking
 * (CLAUDE.md, "Deploying is two commands, and both publish").
 *
 * The live site served the build of 28 October for weeks while README said it
 * was main, and the sharing rules were never deployed with the code that
 * needs them. So this refuses unless it is deploying main exactly as pushed
 * (a clean tree, on main, equal to origin/main), runs every check CI runs,
 * builds without the handwriting model unless asked (--with-handwriting, item
 * 2), deploys hosting and firestore.rules together, then runs
 * scripts/smoke.mjs against the live sites expecting this commit, which the
 * page now carries in <meta name="forma-version">.
 *
 * --preview deploys to a preview channel of forma-201ba (free on the Spark
 * plan; Firebase prints its URL, which expires in 7 days) and leaves the live
 * site and the rules alone: the way to look at a build before it is public.
 *
 * Rolling back is in README, *Firebase Hosting*: the Hosting console's
 * release history, or `firebase hosting:clone`, and the rules from the
 * commit before.
 *
 * Every deploy of main is a numbered release (2026-11-08, site audit item
 * 43): v<package.json's version>, tagged on the deployed commit and published
 * as a GitHub release once the live checks pass, its notes written from
 * src/lib/releases.ts by scripts/release-notes.ts. So before it builds
 * anything this checks the number: if v<version> is already a tag on another
 * commit, main has new work under an old number and it stops; if it is no tag
 * yet, the newest release in releases.ts must carry that version, or the notes
 * would start in the wrong place. Deploying a commit that is already tagged
 * (a re-deploy) makes no new release. The tag is pushed with git; the release
 * needs the GitHub CLI signed in, and without it the command to make it later
 * is printed instead.
 *
 * Pure ASCII, as every script here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const preview = args.has('--preview');
const dryRun = args.has('--dry-run');
const withHandwriting = args.has('--with-handwriting');

function run(command, options = {}) {
  console.log(`\n> ${command}`);
  const r = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, ...(options.env ?? {}) } });
  if (r.status !== 0) {
    const what = options.released ? 'The site is deployed and checked; the release step stopped here.' : `Nothing was deployed${options.after ? ' after it' : ''}.`;
    console.error(`\nStopped: "${command}" failed (exit ${r.status}). ${what}`);
    process.exit(r.status || 1);
  }
}

function read(command) {
  const r = spawnSync(command, { shell: true, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

// 1. Main, as pushed.
const branch = read('git rev-parse --abbrev-ref HEAD');
const dirty = read('git status --porcelain');
if (dirty) {
  console.error('Stopped: the working tree has changes. Commit or put them away first; a deploy is a commit.');
  process.exit(1);
}
if (!preview) {
  if (branch !== 'main') {
    console.error(`Stopped: on "${branch}", not main. Deploy main, or use --preview for a look first.`);
    process.exit(1);
  }
  run('git fetch origin main');
  const head = read('git rev-parse HEAD');
  const remote = read('git rev-parse origin/main');
  if (head !== remote) {
    console.error(`Stopped: this main (${head.slice(0, 12)}) is not origin/main (${remote.slice(0, 12)}). Push or pull first, so what is live is what is public.`);
    process.exit(1);
  }
}
const commit = read('git rev-parse HEAD');

// 1b. The number this deploy publishes (item 43). Not for a preview, which is
// a look, not a release.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
let notes = null; // the release's notes, when this deploy makes the release
let ghReady = false;
if (!preview) {
  run(`git fetch origin --tags --force`);
  const tagged = read(`git rev-list -n 1 ${tag}`);
  if (tagged && tagged !== commit) {
    console.error(
      `Stopped: ${tag} is already the release of ${tagged.slice(0, 12)}, and main has moved on from it. ` +
        'Give the new work a number: raise "version" in package.json (npm version <x.y.z> --no-git-tag-version) ' +
        'and set the same version on the newest release in src/lib/releases.ts, then commit and push.',
    );
    process.exit(1);
  }
  if (!tagged) {
    const info = JSON.parse(read(`npx tsx scripts/release-notes.ts ${version}`) || '{}');
    if (info.newest !== version || !info.notes) {
      console.error(
        `Stopped: package.json says ${version}, but the newest release in src/lib/releases.ts carries ` +
          `${info.newest ?? 'no version'}. Set version: '${version}' on it, so ${tag}'s notes start there.`,
      );
      process.exit(1);
    }
    notes = info.notes;
    ghReady = spawnSync('gh auth status', { shell: true, stdio: 'ignore' }).status === 0;
  }
}

console.log(
  `Deploying ${commit} (${branch})${preview ? ' to a preview channel' : ''}${dryRun ? ', dry run' : ''}` +
    `${preview ? '' : notes ? `, as release ${tag}` : `, already released as ${tag}`}.`,
);
if (notes && !ghReady) console.log('The GitHub CLI is not signed in: the tag will be pushed, and the command to make the release printed.');

// 2. Every check CI runs, and the rules suite, which needs Java.
run('npm run lint');
run('npx tsc --noEmit --noUnusedLocals --noUnusedParameters');
run('npm run lint:encoding');
run('npm run lint:links');
run('npm test');
run('npm run test:rules');
run('npm run build', { env: withHandwriting ? { FORMA_HANDWRITING: '1' } : {} });
run('npm run check:size');

if (dryRun) {
  console.log('\nDry run: every check passed and dist/ is built. Nothing was deployed.');
  process.exit(0);
}

// 3. The deploy.
if (preview) {
  run('npx firebase hosting:channel:deploy preview --expires 7d --only forma-201ba');
  console.log('\nPreview deployed. The live site and the rules are unchanged.');
  process.exit(0);
}
run('npx firebase deploy --only hosting,firestore:rules');

// 4. The live sites, expecting this commit.
run(`node scripts/smoke.mjs --expect ${commit}`, { after: true });
console.log(`\nDeployed ${commit.slice(0, 12)} to every site, with the rules, and the live checks passed.`);

// 5. The release (item 43): the tag on this commit, then its GitHub release.
if (notes) {
  run(`git tag -a ${tag} -m "Forma ${version}" ${commit}`, { released: true });
  run(`git push origin ${tag}`, { released: true });
  const file = join(tmpdir(), `forma-${tag}-notes.md`);
  writeFileSync(file, notes);
  const create = `gh release create ${tag} --repo waqarsyd/forma --title "Forma ${version}" --notes-file "${file}" --verify-tag`;
  if (ghReady) {
    run(create, { released: true });
    console.log(`\nReleased ${tag}: https://github.com/waqarsyd/forma/releases/tag/${tag}`);
  } else {
    console.log(`\nTagged ${tag}. Sign in to the GitHub CLI (gh auth login) and make its release with:\n  ${create}`);
  }
}
