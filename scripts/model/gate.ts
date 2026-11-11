/**
 * May this candidate replace the model Forma ships? (2026-11-11, the full
 * audit's batch LO: LM-21, D7, D9.)
 *
 *   npx tsx scripts/model/gate.ts --candidate <file> [--shipped assets/model/formaModel.json] [--held-out <dir>] [--cases scripts/fidelity/cases/described]
 *
 * Until this, a training run wrote straight over assets/model/formaModel.json
 * and the leak check was all that stood between it and every user. Now
 * scripts/model/train.ts writes a candidate, and this compares it with the
 * shipped model (`gateModels`, lib/learningPipeline.ts). It exits 1 on any
 * drop, 0 when the candidate may ship:
 *
 *   (a) the leak check (`unexpectedStrings`) finds nothing, and every font it
 *       names is public or already shipped;
 *   (b) none of the six made-up, description-only fidelity cases in
 *       scripts/fidelity/cases/described (a stock register grouped by
 *       warehouse, invoice lines, payslips, a customer list, address labels, a
 *       ledger) scores lower with Forma's own report from the words
 *       (generateOffline, as the app builds one) than with the shipped model;
 *   (d) the skeletons train.ts held out (--hold-out, written to
 *       <data>/held-out) sit no further from the candidate's archetypes than
 *       from the shipped model's, both measured in the shipped model's scale.
 *
 * (c), the box reader on the seven picture cases (`run.ts --forma`) and on the
 * owner's real reports (`realScore.ts`), is not part of this gate, and that is
 * measured rather than assumed: nothing in the picture path reads
 * formaModel.json (the box reader is assets/model/boxReader.json, a model of
 * its own that the weekly job does not retrain), so a candidate cannot move
 * those scores. Run them by hand the day the box reader is retrained.
 *
 * No AI, no key and no quota: every part runs on this computer in seconds.
 * The console prints scores and counts, never a report's words. Pure ASCII,
 * as every script here.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { modelIdSource, type FormaModel } from '../../src/lib/formaModel';
import { gateModels, soundSkeleton, type DescribedCase, type GateCheck } from '../../src/lib/learningPipeline';
import type { ReportSkeleton } from '../../src/lib/reportSkeleton';
import { isMain, option } from '../admin/google.mjs';

export const CASES_DIR = 'scripts/fidelity/cases/described';

/** The described cases in a folder: one `case.json` per subfolder, in name order. */
export function loadDescribedCases(dir = CASES_DIR): DescribedCase[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, 'case.json')))
    .sort()
    .map((name) => {
      const file = JSON.parse(readFileSync(join(dir, name, 'case.json'), 'utf8')) as { prompt?: string; expect?: DescribedCase['expect'] };
      if (!file.prompt || !file.expect) throw new Error(`${join(dir, name, 'case.json')} needs "prompt" and "expect".`);
      return { name, prompt: file.prompt, expect: file.expect };
    });
}

/** The held-out skeletons in a folder, each checked as a pulled one is. */
export function loadHeldOut(dir: string | undefined): ReportSkeleton[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (!/\.json$/i.test(name)) return [];
    try {
      const k = soundSkeleton((JSON.parse(readFileSync(join(dir, name), 'utf8')) as { skeleton?: unknown }).skeleton);
      return k ? [k] : [];
    } catch {
      return [];
    }
  });
}

/** A model's id: its own, or the hash a model trained before ids had would carry. */
export const idOf = (model: FormaModel): string => model.id ?? createHash('sha256').update(modelIdSource(model)).digest('hex').slice(0, 12);

export const readModel = (path: string): FormaModel => JSON.parse(readFileSync(path, 'utf8')) as FormaModel;

/** The gate's verdict as the lines it prints. */
export function report(checks: readonly GateCheck[]): string[] {
  return checks.map((c) => `  ${c.pass ? 'pass' : 'FAIL'}  ${c.name}: ${c.detail}`);
}

export function main(argv = process.argv.slice(2)): number {
  const candidatePath = option(argv, 'candidate') as string | undefined;
  if (!candidatePath) {
    console.error('Usage: npx tsx scripts/model/gate.ts --candidate <file> [--shipped assets/model/formaModel.json] [--held-out <dir>] [--cases scripts/fidelity/cases/described]');
    return 2;
  }
  const shipped = readModel(resolve((option(argv, 'shipped') as string | undefined) ?? 'assets/model/formaModel.json'));
  const candidate = readModel(resolve(candidatePath));
  const cases = loadDescribedCases((option(argv, 'cases') as string | undefined) ?? CASES_DIR);
  const heldOut = loadHeldOut(option(argv, 'held-out') as string | undefined);
  const { pass, checks } = gateModels(shipped, candidate, { cases, heldOut });
  console.log(`gate: candidate ${idOf(candidate)} against shipped ${idOf(shipped)}, ${cases.length} described case(s), ${heldOut.length} held-out skeleton(s)`);
  for (const line of report(checks)) console.log(line);
  if (!heldOut.length) console.log('  (no held-out skeletons: the distance check was not run)');
  console.log(pass ? 'gate: the candidate may ship.' : 'gate: the candidate may NOT ship; the shipped model stays.');
  return pass ? 0 : 1;
}

if (isMain(import.meta.url)) process.exit(main());
