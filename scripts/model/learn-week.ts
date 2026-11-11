/**
 * The weekly learning job, for the owner's own PC (2026-11-11, the full
 * audit's batch LO, D8): pull, train a candidate, gate it, and only when the
 * gate passes put it where the app ships it. Nothing learned until this:
 * the pull and the train were each a command the owner had to remember, and
 * the result went live with only the leak check in its way.
 *
 *   npx tsx scripts/model/learn-week.ts --data <dir> [--key <credential.json>] [--reports <dir>]
 *       [--skeletons <dir> ...] [--models <dir>] [--k 10] [--no-pull] [--dry-run]
 *
 * --data       the job's folder, outside the repository, the same every week:
 *              <data>/pulled (pull-learning.ts's folder, which resumes a
 *              lookback before where last week's pull stopped, and loses what
 *              people cleared), <data>/set (train.ts's training set and
 *              held-out skeletons, rebuilt from <data>/pulled on every run, so
 *              what was cleared leaves them too) and <data>/candidate. The
 *              pull is made without --reconcile, so the credential can be
 *              viewer-only; deleting a deleted account's events from Firestore
 *              is a run the owner makes on purpose.
 * --key        the credential pull-learning.ts reads (see
 *              scripts/admin/google.mjs); without one, and without gcloud's
 *              application default credentials, the job trains on what earlier
 *              pulls brought.
 * --reports    the owner's own reports, learned beside what was pulled, as
 *              the shipped model was; without them a candidate is learned from
 *              the pulled skeletons alone, which the gate is right to refuse
 *              while there are few.
 * --skeletons  further fixed skeleton sets (the Crystal set); repeatable.
 * --models     where every shipped model is kept by id (default
 *              <data>/../models, so forma-model-data/models): the way back to
 *              last week's is copying <id>.json over assets/model/formaModel.json.
 * --no-pull    train and gate on what is already in <data>/pulled.
 * --dry-run    everything but the copy into assets/model/ and --models.
 *
 * On a pass it writes the candidate to assets/model/formaModel.json and
 * assets/model/model-card.json (its id, the day, what it was learned from and
 * the gate's checks: counts only), and keeps both models under --models. On
 * a fail it changes nothing and exits 1. Committing and deploying stay the
 * owner's: the job prints the two commands and runs neither.
 *
 * In Task Scheduler on the owner's PC (a weekly trigger; "Start in" the
 * repository folder). The program is cmd, not npx: npx is npx.cmd on
 * Windows, which Task Scheduler cannot start by that name.
 *   Program:   cmd.exe
 *   Arguments: /c npx tsx scripts/model/learn-week.ts --data E:\...\forma-model-data\learning-week --reports <the owner's reports>
 *
 * No AI and no quota. Pure ASCII, as every script here.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { adcPath, isMain, option, options } from '../admin/google.mjs';
import { gateModels } from '../../src/lib/learningPipeline';
import { idOf, loadDescribedCases, loadHeldOut, readModel } from './gate';
import { insideRepository } from './pull-learning';

const SHIPPED = 'assets/model/formaModel.json';
const CARD = 'assets/model/model-card.json';

const quote = (a: string) => (/^[A-Za-z0-9_.:\\/=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function tsx(script: string, args: string[]): number {
  const command = `npx tsx ${script} ${args.map(quote).join(' ')}`;
  console.log(`\n> ${command}`);
  return spawnSync(command, { shell: true, stdio: 'inherit' }).status ?? 1;
}

const count = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((n) => /\.json$/i.test(n)).length : 0);

export function main(argv = process.argv.slice(2)): number {
  const dataArg = option(argv, 'data') as string | undefined;
  if (!dataArg) {
    console.error('Usage: npx tsx scripts/model/learn-week.ts --data <dir> [--key <credential.json>] [--reports <dir>] [--skeletons <dir> ...] [--models <dir>] [--k 10] [--no-pull] [--dry-run]');
    return 2;
  }
  const data = resolve(dataArg);
  const models = resolve((option(argv, 'models') as string | undefined) ?? join(data, '..', 'models'));
  const key = option(argv, 'key') as string | undefined;
  const reports = option(argv, 'reports') as string | undefined;
  const extra = options(argv, 'skeletons') as string[];
  const dryRun = argv.includes('--dry-run');
  for (const dir of [data, models, ...(reports ? [reports] : []), ...extra]) {
    if (insideRepository(dir)) {
      console.error(`${dir} is inside the repository. Keep the job's folders outside it.`);
      return 2;
    }
  }
  const pulled = join(data, 'pulled');
  const set = join(data, 'set');
  const candidate = join(data, 'candidate', 'formaModel.json');

  // 1. The pull, resuming where last week's stopped.
  if (argv.includes('--no-pull')) console.log('learn-week: no pull asked for; training on what earlier pulls brought.');
  else if (!key && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(adcPath())) console.log('learn-week: no credential, so no pull; training on what earlier pulls brought.');
  else if (tsx('scripts/model/pull-learning.ts', ['--out', pulled, '--skeletons-only', ...(key ? ['--key', key] : [])]) !== 0) {
    console.error('learn-week: the pull failed; nothing was trained.');
    return 1;
  }

  // 2. A candidate, with a tenth of the pulled skeletons held out for the gate.
  const skeletonDirs = [join(pulled, 'skeletons'), ...extra].filter((d) => count(d) > 0);
  if (!skeletonDirs.length && !reports) {
    console.error('learn-week: nothing to learn from (no pulled skeletons, no --reports, no --skeletons). The shipped model stays.');
    return 1;
  }
  const trainArgs = ['--data', set, '--out', candidate, '--hold-out', '0.1', ...(reports ? ['--reports', reports] : []), ...skeletonDirs.flatMap((d) => ['--skeletons', d])];
  const k = option(argv, 'k') as string | undefined;
  if (k) trainArgs.push('--k', k);
  if (tsx('scripts/model/train.ts', trainArgs) !== 0) {
    console.error('learn-week: training stopped (see above); the shipped model stays.');
    return 1;
  }

  // 3. The gate, in this process so its checks go into the model card.
  const shipped = readModel(SHIPPED);
  const next = readModel(candidate);
  const heldOut = loadHeldOut(join(set, 'held-out'));
  const { pass, checks } = gateModels(shipped, next, { cases: loadDescribedCases(), heldOut });
  console.log(`\nlearn-week: gate, candidate ${idOf(next)} against shipped ${idOf(shipped)}`);
  for (const c of checks) console.log(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.name}: ${c.detail}`);
  if (!pass) {
    console.log('learn-week: the candidate did not pass; the shipped model stays.');
    return 1;
  }

  // 4. Ship it into the working tree, keeping both models by id.
  const card = {
    id: idOf(next),
    learnedOn: next.learnedOn,
    previous: idOf(shipped),
    trainedFrom: next.trainedFrom ?? { reports: next.reports, events: 0, accounts: 0 },
    archetypes: next.archetypes.length,
    fonts: next.style.fonts.length,
    gate: checks.map((c) => ({ check: c.name, pass: c.pass, detail: c.detail })),
  };
  if (dryRun) {
    console.log(`\nlearn-week: dry run. It would keep ${idOf(shipped)} and ${card.id} under ${models}, copy ${card.id} to ${SHIPPED} and write ${CARD}.`);
    return 0;
  }
  mkdirSync(models, { recursive: true });
  const keptShipped = join(models, `${idOf(shipped)}.json`);
  if (!existsSync(keptShipped)) copyFileSync(SHIPPED, keptShipped);
  copyFileSync(candidate, join(models, `${card.id}.json`));
  copyFileSync(candidate, SHIPPED);
  writeFileSync(CARD, `${JSON.stringify(card, null, 1)}\n`);
  console.log(`\nlearn-week: ${card.id} is in ${SHIPPED}; ${idOf(shipped)} is kept in ${models}.`);
  console.log('Committing and deploying are yours:');
  console.log(`  commit ${SHIPPED} and ${CARD} (git add, then git commit -F with a message file), then`);
  console.log('  node scripts/deploy.mjs');
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
