/**
 * The models a limit parked, kept in a file in Forma's folder (2026-11-24,
 * the CLI and Forma Designer work's wave 3; findings GAP3-1 and CLI-12, the
 * owner's decision OC2): the file itself (modelParks.ts `fileParks`), the
 * limit the parks make of an error (`limitAfterParks`), and the threads. A
 * park one thread records is honoured by the next, with a thread started
 * afresh in this thread's own modules and in real worker threads, each job in
 * one of its own (generator.ts `fresh`); a park that has lifted is dropped; a
 * damaged file is ignored and never fatal; a pinned model is neither parked
 * nor kept, and its limit is still read whole; a park lost to another writer
 * costs one request, once; and the limit a batch file's result carries is
 * the soonest the key can be asked again. The browser keeps no store, and
 * modelCache.test.ts holds that nothing changes there. The network is
 * stubbed throughout: no key is real and no request leaves this computer.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { limitOf, msUntilPacificReset, type AiLimit } from '../lib/aiLimit';
import { keyTag, type ModelPark } from '../lib/modelCache';
import type { ReportConfig } from '../services/geminiService';
import { workerGenerator } from './generator';
import type { GenerateDone, GenerateJob } from './genJobs';
import { LONGEST_PARK_MS, PARKS_FILE, RENAME_TRIES, fileParks, limitAfterParks } from './modelParks';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'model-parks-')));
let made = 0;
/** A Forma folder of a test's own. */
const folder = () => {
  const f = join(scratch, `forma-${++made}`);
  mkdirSync(f, { recursive: true });
  return f;
};
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the parks kept in a file in Forma's folder", () => {
  const NOW = 1_800_000_000_000;
  const TAG = keyTag('stand-in-key-not-a-credential');
  const park = (model: string, kind: ModelPark['kind'], inMs: number): ModelPark => ({ model, kind, until: NOW + inMs });

  it("keeps each park by the key's tag, written whole under a name of its own and renamed into place, and reads only that tag's", () => {
    const path = join(folder(), 'nested', PARKS_FILE);
    const parks = fileParks(path);
    expect(parks.read(TAG, NOW)).toEqual([]);
    parks.add(TAG, park('model-a', 'daily', 3_600_000), NOW);
    parks.add(TAG, park('model-b', 'per-minute', 30_000), NOW);
    parks.add('0badc0de', park('model-a', 'unknown', 60_000), NOW);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      [TAG]: { 'model-a': { kind: 'daily', until: NOW + 3_600_000 }, 'model-b': { kind: 'per-minute', until: NOW + 30_000 } },
      '0badc0de': { 'model-a': { kind: 'unknown', until: NOW + 60_000 } },
    });
    expect(readdirSync(dirname(path))).toEqual([PARKS_FILE]);
    expect(parks.read(TAG, NOW)).toEqual([park('model-a', 'daily', 3_600_000), park('model-b', 'per-minute', 30_000)]);
    expect(parks.read('ffffffff', NOW)).toEqual([]);
  });

  it('reads none that has lifted or lifts further off than the longest day, which no limit does, and leaves them out of the file at the next write', () => {
    const path = join(folder(), PARKS_FILE);
    const parks = fileParks(path);
    writeFileSync(
      path,
      JSON.stringify({
        [TAG]: { lifted: { kind: 'per-minute', until: NOW }, far: { kind: 'daily', until: NOW + LONGEST_PARK_MS + 1 }, live: { kind: 'daily', until: NOW + LONGEST_PARK_MS } },
        '0badc0de': { lifted: { kind: 'daily', until: NOW - 1 } },
      }),
    );
    expect(parks.read(TAG, NOW)).toEqual([park('live', 'daily', LONGEST_PARK_MS)]);
    expect(parks.read('0badc0de', NOW)).toEqual([]);
    parks.add(TAG, park('new', 'unknown', 60_000), NOW);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [TAG]: { live: { kind: 'daily', until: NOW + LONGEST_PARK_MS }, new: { kind: 'unknown', until: NOW + 60_000 } } });
  });

  it('keeps the later of two parks of one model, with its kind: a park is never shortened', () => {
    const parks = fileParks(join(folder(), PARKS_FILE));
    parks.add(TAG, park('model-a', 'daily', 5 * 3_600_000), NOW);
    parks.add(TAG, park('model-a', 'per-minute', 30_000), NOW);
    expect(parks.read(TAG, NOW)).toEqual([park('model-a', 'daily', 5 * 3_600_000)]);
    parks.add(TAG, park('model-a', 'daily', 6 * 3_600_000), NOW);
    expect(parks.read(TAG, NOW)).toEqual([park('model-a', 'daily', 6 * 3_600_000)]);
  });

  it('reads a damaged file, or an entry of the wrong shape, as none, never failing, and the next park replaces it whole', () => {
    const path = join(folder(), PARKS_FILE);
    const parks = fileParks(path);
    const damaged = [
      '{ half',
      '',
      '[]',
      'null',
      '"text"',
      JSON.stringify({ [TAG]: [] }),
      JSON.stringify({ [TAG]: { m: null } }),
      JSON.stringify({ [TAG]: { m: { kind: 'weekly', until: NOW + 1_000 } } }),
      JSON.stringify({ [TAG]: { m: { kind: 'daily', until: 'soon' } } }),
      JSON.stringify({ [TAG]: { m: { kind: 'daily', until: null } } }),
      JSON.stringify({ [TAG]: { '': { kind: 'daily', until: NOW + 1_000 } } }),
    ];
    for (const text of damaged) {
      writeFileSync(path, text);
      expect(parks.read(TAG, NOW), text).toEqual([]);
    }
    writeFileSync(path, JSON.stringify({ [TAG]: { bad: { kind: 'weekly', until: NOW + 1_000 }, good: { kind: 'per-minute', until: NOW + 1_000 } }, broken: 7 }));
    expect(parks.read(TAG, NOW)).toEqual([park('good', 'per-minute', 1_000)]);
    writeFileSync(path, '{ half');
    parks.add(TAG, park('model-a', 'daily', 3_600_000), NOW);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [TAG]: { 'model-a': { kind: 'daily', until: NOW + 3_600_000 } } });
  });

  it("is shared by two writers, each reading the other's parks; and one that cannot write throws, for modelCache to keep the park in memory", () => {
    const path = join(folder(), PARKS_FILE);
    const server = fileParks(path);
    const command = fileParks(path);
    server.add(TAG, park('model-a', 'daily', 3_600_000), NOW);
    command.add(TAG, park('model-b', 'per-minute', 30_000), NOW);
    expect(server.read(TAG, NOW)).toEqual([park('model-a', 'daily', 3_600_000), park('model-b', 'per-minute', 30_000)]);
    expect(command.read(TAG, NOW)).toEqual(server.read(TAG, NOW));
    // Forma's folder where a file stands: nothing can be written under it, and nothing is read.
    const blocked = join(folder(), 'a-file');
    writeFileSync(blocked, '');
    const nowhere = fileParks(join(blocked, PARKS_FILE));
    expect(() => nowhere.add(TAG, park('model-a', 'daily', 3_600_000), NOW)).toThrow();
    expect(nowhere.read(TAG, NOW)).toEqual([]);
  });

  /*
   * The wave's review (W3R-4): on Windows a rename onto the file is refused
   * while another process has it open at that moment, a reader included. The
   * rename is stood in for, so the case runs on every system, CI's Linux too.
   */
  it('tries a rename Windows refuses for a moment again, and throws once it has been refused every time, or for anything else', () => {
    const refused = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
    const path = join(folder(), PARKS_FILE);
    let tries = 0;
    const busyTwice = fileParks(path, (from, to) => {
      if (++tries <= 2) throw refused(tries === 1 ? 'EPERM' : 'EBUSY');
      renameSync(from, to);
    });
    busyTwice.add(TAG, park('model-a', 'daily', 3_600_000), NOW);
    expect(tries).toBe(3);
    expect(busyTwice.read(TAG, NOW)).toEqual([park('model-a', 'daily', 3_600_000)]);
    expect(readdirSync(dirname(path))).toEqual([PARKS_FILE]);

    tries = 0;
    const alwaysBusy = fileParks(path, () => {
      tries++;
      throw refused('EACCES');
    });
    expect(() => alwaysBusy.add(TAG, park('model-b', 'per-minute', 30_000), NOW)).toThrow(/EACCES/);
    expect(tries).toBe(RENAME_TRIES);
    tries = 0;
    const gone = fileParks(path, () => {
      tries++;
      throw refused('ENOENT');
    });
    expect(() => gone.add(TAG, park('model-b', 'per-minute', 30_000), NOW)).toThrow(/ENOENT/);
    expect(tries).toBe(1);
    // Neither left a part-written file behind, nor touched the park kept.
    expect(readdirSync(dirname(path))).toEqual([PARKS_FILE]);
    expect(busyTwice.read(TAG, NOW)).toEqual([park('model-a', 'daily', 3_600_000)]);
  });

  /*
   * The wave's review (W3R-3): a day's park lifts at Google's reset, midnight
   * Pacific on the zone's own calendar, and the longest day, when the clocks
   * go back, is still read.
   */
  it("says a day's limit lifts at midnight Pacific, on the days the clocks change too, and reads a park as far off as the longest day", () => {
    const parks = fileParks(join(folder(), PARKS_FILE));
    const at = (iso: string) => Date.parse(iso);
    expect(parks.dailyReset!(at('2026-03-08T08:30:00Z'))).toBe(at('2026-03-09T07:00:00Z'));
    expect(parks.dailyReset!(at('2026-11-01T07:30:00Z'))).toBe(at('2026-11-02T08:00:00Z'));
    const now = at('2026-11-01T07:30:00Z');
    parks.add(TAG, { model: 'model-a', kind: 'daily', until: parks.dailyReset!(now) }, now);
    expect(parks.read(TAG, now)).toEqual([{ model: 'model-a', kind: 'daily', until: at('2026-11-02T08:00:00Z') }]);
  });
});

describe('when a key can next be asked: the parks laid over the limit an error is', () => {
  const NOW = 1_800_000_000_000;
  const HOURS = 7 * 3_600_000;
  const park = (model: string, kind: ModelPark['kind'], inMs: number): ModelPark => ({ model, kind, until: NOW + inMs });
  const daily: AiLimit = { kind: 'daily', waitMs: HOURS, provider: 'gemini' };

  it("takes the park that lifts soonest when every model the key can call is parked: a minute's, though the last model asked met the day's", () => {
    expect(limitAfterParks(daily, [park('a', 'per-minute', 30_000), park('b', 'daily', HOURS)], ['a', 'b'], NOW)).toEqual({ kind: 'per-minute', waitMs: 30_000, provider: 'gemini' });
    expect(limitAfterParks(daily, [park('a', 'daily', HOURS), park('b', 'daily', HOURS)], ['a', 'b'], NOW)).toEqual(daily);
    // A limit that said neither its kind nor its wait gets the wait its park was given.
    expect(limitAfterParks({ kind: 'unknown', waitMs: null, provider: 'gemini' }, [park('a', 'unknown', 60_000), park('b', 'daily', HOURS)], ['a', 'b'], NOW)).toEqual({
      kind: 'unknown',
      waitMs: 60_000,
      provider: 'gemini',
    });
    // A model's latest park is the one that counts.
    expect(limitAfterParks(daily, [park('a', 'per-minute', 30_000), park('a', 'daily', HOURS)], ['a'], NOW)).toEqual(daily);
  });

  it('leaves the limit as the error gave it when the parks do not explain it', () => {
    const parks = [park('a', 'per-minute', 30_000)];
    // A model the parks leave free, or one whose park has lifted.
    expect(limitAfterParks(daily, parks, ['a', 'b'], NOW)).toBe(daily);
    expect(limitAfterParks(daily, [park('a', 'per-minute', 0)], ['a'], NOW)).toBe(daily);
    // No limit, another AI's, or no models known.
    expect(limitAfterParks(null, parks, ['a'], NOW)).toBeNull();
    const openrouter: AiLimit = { kind: 'daily', waitMs: null, provider: 'openrouter' };
    expect(limitAfterParks(openrouter, parks, ['a'], NOW)).toBe(openrouter);
    expect(limitAfterParks(daily, parks, null, NOW)).toBe(daily);
    expect(limitAfterParks(daily, parks, [], NOW)).toBe(daily);
  });
});

/* ---------------------------------------------------------------------- *
 * The threads. Every request is answered here, by the model it names.
 * ---------------------------------------------------------------------- */

const KEY = 'stand-in-key-not-a-credential';
const CONFIG = { customApiKey: KEY, version: '20.1', unit: 'HundredthsOfAnInch', pageSize: 'Letter' } as ReportConfig;
const PARTS = [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }];
const DAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';

const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" DisplayName="Invoice" ReportUnit="HundredthsOfAnInch" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="label1" Text="Invoice" LocationFloat="0,0" SizeF="200,20" Font="Arial, 9pt" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

/** A finished answer, its stream naming the model that wrote it, as Gemini's does. */
const good = (model: string) => () =>
  new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: REPX }], role: 'model' }, finishReason: 'STOP' }], modelVersion: model })}\r\n\r\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/** Google's 429, the quota named and RetryInfo's wait in the body, as the API sends it. */
const limited = (quotaId: string, retryDelay?: string) => () =>
  new Response(
    JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota, please check your plan and billing details.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
          ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
        ],
      },
    }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );

/** The network, answering each request by the model it names; returns the models asked, in order. */
function network(answers: Record<string, () => Response>): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const model = /\/models\/([^:/?]+):/.exec(String(url))?.[1] ?? String(url);
      asked.push(model);
      const answer = answers[model];
      if (!answer) throw new Error(`nothing answers ${model} here`);
      return answer();
    }),
  );
  return asked;
}

/** The day's choice as the model probe keeps it in Forma's folder: this key found its two models today, so nothing is probed. */
function foundToday(forma: string): void {
  writeFileSync(join(forma, 'model-choice.json'), JSON.stringify({ 'geminiModel:day': JSON.stringify({ tag: keyTag(KEY), model: 'model-a', usable: ['model-a', 'model-b'], at: Date.now() }) }));
}

const keptIn = (forma: string) => JSON.parse(readFileSync(join(forma, PARKS_FILE), 'utf8')) as Record<string, Record<string, { kind: string; until: number }>>;

beforeAll(async () => {
  // Pay for the SDK import outside any test's budget, as generationRetry.test.ts does.
  await import('@google/genai');
}, 60_000);
beforeEach(() => {
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * A thread started afresh, as the command line starts one for each file of a
 * batch: fresh modules, so the memory a thread before it held is gone, and
 * Forma's folder kept as nodeGeneration.ts keeps it, the day's model choice
 * and the parks each in its file.
 */
async function freshThread(forma: string) {
  vi.resetModules();
  const [cache, service, { fileStorage }, parksModule] = await Promise.all([import('../lib/modelCache'), import('../services/geminiService'), import('./nodeGeneration'), import('./modelParks')]);
  cache.keepModelChoiceIn({ session: null, day: fileStorage(join(forma, 'model-choice.json')), parks: parksModule.fileParks(join(forma, parksModule.PARKS_FILE)) });
  return { cache, design: () => service.analyzeReportDesign('', PARTS, CONFIG), service };
}

describe('a park one thread records is honoured by the next', () => {
  it("does not ask the next thread's first request of a model the thread before found spent for the day: it starts on the next model", async () => {
    const forma = folder();
    foundToday(forma);
    const first = await freshThread(forma);
    let asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    expect((await first.design()).model).toBe('model-b');
    expect(asked).toEqual(['model-a', 'model-b']);
    const text = readFileSync(join(forma, PARKS_FILE), 'utf8');
    expect(text).not.toContain(KEY);
    const kept = keptIn(forma)[keyTag(KEY)]['model-a'];
    expect(kept.kind).toBe('daily');
    // Until midnight Pacific, when Google resets the day's allowance, on the zone's own calendar.
    expect(Math.abs(kept.until - (Date.now() + msUntilPacificReset()))).toBeLessThan(5_000);

    asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    expect((await (await freshThread(forma)).design()).model).toBe('model-b');
    expect(asked).toEqual(['model-b']);

    // What every fresh thread cost before the file: the spent model asked again, a request out of the file's budget.
    rmSync(join(forma, PARKS_FILE));
    asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-a', 'model-b']);
  });

  it("honours a minute's limit for its stated wait, and drops a park that has lifted: that model is asked first again", async () => {
    const forma = folder();
    foundToday(forma);
    let asked = network({ 'model-a': limited(MINUTE, '30s'), 'model-b': good('model-b') });
    const before = Date.now();
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-a', 'model-b']);
    const kept = keptIn(forma)[keyTag(KEY)]['model-a'];
    expect(kept.kind).toBe('per-minute');
    expect(kept.until - before).toBeGreaterThanOrEqual(30_000);
    expect(kept.until - before).toBeLessThan(35_000);

    asked = network({ 'model-a': good('model-a'), 'model-b': good('model-b') });
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-b']);

    // Its instant passed: the park is not read, and the model the key prefers is asked first again.
    writeFileSync(join(forma, PARKS_FILE), JSON.stringify({ [keyTag(KEY)]: { 'model-a': { ...kept, until: Date.now() - 1 } } }));
    asked = network({ 'model-a': good('model-a'), 'model-b': good('model-b') });
    expect((await (await freshThread(forma)).design()).model).toBe('model-a');
    expect(asked).toEqual(['model-a']);
  });

  it('ignores a damaged file, never failing the request, and the next limit writes it whole again', async () => {
    const forma = folder();
    foundToday(forma);
    writeFileSync(join(forma, PARKS_FILE), '{ half');
    const asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    expect((await (await freshThread(forma)).design()).model).toBe('model-b');
    expect(asked).toEqual(['model-a', 'model-b']);
    expect(Object.keys(keptIn(forma)[keyTag(KEY)])).toEqual(['model-a']);
  });

  it('costs one request, once, when another writer lost a park: the model is asked, answers 429 again, and is kept again', async () => {
    const forma = folder();
    foundToday(forma);
    let asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-a', 'model-b']);
    // Another process read the file before this park was written and renamed its own after: model-a's park is gone.
    const other = { [keyTag('another-key')]: { 'model-x': { kind: 'per-minute', until: Date.now() + 30_000 } } };
    writeFileSync(join(forma, PARKS_FILE), JSON.stringify(other));
    asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-a', 'model-b']);
    expect(Object.keys(keptIn(forma))).toEqual([keyTag('another-key'), keyTag(KEY)]);
    asked = network({ 'model-a': limited(DAY), 'model-b': good('model-b') });
    await (await freshThread(forma)).design();
    expect(asked).toEqual(['model-b']);
  });

  it("neither parks nor keeps a pinned model, and still reads its limit whole: a minute's with Google's wait, the day's to midnight Pacific", async () => {
    const forma = folder();
    foundToday(forma);
    const thread = await freshThread(forma);
    const pinned = { ...CONFIG, modelName: 'model-a' };
    const asked = network({ 'model-a': limited(MINUTE, '41s') });
    const minute = await thread.service.analyzeReportDesign('', PARTS, pinned).catch((e: unknown) => e);
    expect(asked).toEqual(['model-a']);
    expect(limitOf(minute)).toEqual({ kind: 'per-minute', waitMs: 41_000, provider: 'gemini' });
    network({ 'model-a': limited(DAY) });
    const now = new Date();
    const day = await thread.service.analyzeReportDesign('', PARTS, pinned).catch((e: unknown) => e);
    expect(limitOf(day, 'gemini', now)).toEqual({ kind: 'daily', waitMs: msUntilPacificReset(now), provider: 'gemini' });
    expect(thread.cache.isModelInCooldown('model-a')).toBe(false);
    expect(existsSync(join(forma, PARKS_FILE))).toBe(false);
  });
});

describe("the limit a batch file's result carries, the parks laid over the error's", () => {
  const JOB: GenerateJob = { kind: 'generate', voice: 'cli', config: CONFIG, words: 'An invoice with a title and a table of items.', files: [], standIn: false };

  /** genJobs.ts's runner in this thread, afresh, on Forma's folder; Tesseract alone, which a description never asks. */
  async function runner(forma: string, model?: string) {
    vi.resetModules();
    const { makeRunner } = await import('./genJobs');
    return makeRunner({ mock: false, userFolder: forma, paddleModels: null, ...(model ? { model } : {}) }, { log: () => {} });
  }

  it("is the minute of the model that lifts soonest, though the last model asked met the day's limit: the batch waits rather than stopping", { timeout: 60_000 }, async () => {
    const forma = folder();
    foundToday(forma);
    const run = await runner(forma);
    try {
      const asked = network({ 'model-a': limited(MINUTE, '30s'), 'model-b': limited(DAY) });
      const done = (await run.run(JOB, new AbortController().signal, () => {})) as GenerateDone;
      expect(asked).toEqual(['model-a', 'model-b']);
      // Nothing stands in (OC5), and the error alone would have said the day's limit.
      expect(done).toMatchObject({ xml: '', standIn: null, by: null });
      expect(done.failure).toMatch(/daily/i);
      expect(done.limit).toMatchObject({ kind: 'per-minute', provider: 'gemini' });
      expect(done.limit!.waitMs).toBeGreaterThan(25_000);
      expect(done.limit!.waitMs).toBeLessThanOrEqual(30_000);
    } finally {
      await run.close();
    }
  });

  it("is the error's own on a pinned model, which is never parked: a minute's, with Google's wait, and nothing kept", { timeout: 60_000 }, async () => {
    const forma = folder();
    foundToday(forma);
    const run = await runner(forma, 'model-a');
    try {
      const asked = network({ 'model-a': limited(MINUTE, '41s'), 'model-b': good('model-b') });
      const done = (await run.run(JOB, new AbortController().signal, () => {})) as GenerateDone;
      expect(asked).toEqual(['model-a']);
      expect(done).toMatchObject({ xml: '', standIn: null, limit: { kind: 'per-minute', waitMs: 41_000, provider: 'gemini' } });
      expect(existsSync(join(forma, PARKS_FILE))).toBe(false);
    } finally {
      await run.close();
    }
  });
});

describe('across real worker threads, each job in a thread of its own', () => {
  const GEN_WORKER = new URL('./genWorker.mjs', import.meta.url).href;

  /**
   * genWorker.mjs, the AI tools' own thread, with the network stood in before
   * it loads: each request answered by the model it names (model-a's day spent,
   * model-b answering) and the model written to `log`, the one way out of a
   * thread that is ended when its job is.
   */
  const stubbedWorker = (log: string) => `
const { appendFileSync } = require('node:fs');
const REPX = ${JSON.stringify(REPX)};
globalThis.fetch = async (url) => {
  const model = (/\\/models\\/([^:/?]+):/.exec(String(url)) || [])[1] || String(url);
  appendFileSync(${JSON.stringify(log)}, model + '\\n');
  if (model === 'model-a') return new Response(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: ${JSON.stringify(DAY)} }] }] } }), { status: 429, headers: { 'content-type': 'application/json' } });
  return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: REPX }], role: 'model' }, finishReason: 'STOP' }], modelVersion: model }) + '\\r\\n\\r\\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
import(${JSON.stringify(GEN_WORKER)});
`;

  it('honours in the second thread the park the first recorded: the model spent today is not asked again', { timeout: 120_000 }, async () => {
    const forma = folder();
    foundToday(forma);
    const log = join(forma, 'asked.txt');
    const asked = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    let starts = 0;
    const gen = workerGenerator({
      setup: { mock: false, userFolder: forma, paddleModels: null },
      log: () => {},
      fresh: true,
      spawn: (limits, setup) => {
        starts++;
        return new Worker(stubbedWorker(log), { eval: true, workerData: setup, resourceLimits: { maxOldGenerationSizeMb: limits.heapMb, stackSizeMb: limits.stackMb }, stdout: true, stderr: true });
      },
    });
    const job: GenerateJob = { kind: 'generate', voice: 'cli', config: CONFIG, words: 'An invoice with a title and a table of items.', files: [], standIn: false };
    try {
      const first = (await gen.run(job, new AbortController().signal, () => {})) as GenerateDone;
      expect(first).toMatchObject({ by: 'gemini', model: 'model-b', limit: null, standIn: null });
      expect(first.xml).toContain('XtraReportsLayoutSerializer');
      const firstAsked = asked();
      expect(firstAsked[0]).toBe('model-a');
      expect(firstAsked.slice(1).every((m) => m === 'model-b')).toBe(true);
      expect(keptIn(forma)[keyTag(KEY)]['model-a'].kind).toBe('daily');

      const second = (await gen.run(job, new AbortController().signal, () => {})) as GenerateDone;
      expect(second).toMatchObject({ by: 'gemini', model: 'model-b', limit: null });
      const secondAsked = asked().slice(firstAsked.length);
      expect(secondAsked.length).toBeGreaterThan(0);
      expect(secondAsked).not.toContain('model-a');
      expect(starts).toBe(2);
    } finally {
      await gen.close();
    }
  });
});
