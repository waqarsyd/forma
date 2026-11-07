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
 * Pure ASCII, as every script here.
 */
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const preview = args.has('--preview');
const dryRun = args.has('--dry-run');
const withHandwriting = args.has('--with-handwriting');

function run(command, options = {}) {
  console.log(`\n> ${command}`);
  const r = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, ...(options.env ?? {}) } });
  if (r.status !== 0) {
    console.error(`\nStopped: "${command}" failed (exit ${r.status}). Nothing was deployed${options.after ? ' after it' : ''}.`);
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
console.log(`Deploying ${commit} (${branch})${preview ? ' to a preview channel' : ''}${dryRun ? ', dry run' : ''}.`);

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
