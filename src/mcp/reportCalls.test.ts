/**
 * The calls that ask an AI, as the command line makes them (2026-11-24,
 * the CLI and Forma Designer work's wave 2; findings CLI-2, CLI-3, CLI-6 and
 * SEC-4 of its design audit): reportCalls.ts's `planGenerate`,
 * `runGenerate`, `planRevise` and `runRevise` with a working-folder policy
 * in the command line's voice, on files in a scratch folder, the AI stood in
 * by the mock or by a stub that fails the test if it is asked. No key is real
 * and no request leaves this computer: the one request made goes to a
 * stand-in server this file starts on 127.0.0.1, answering 429 (wave 3);
 * every key is built at run time (TST-10). aiTools.test.ts drives the same
 * functions through the MCP server, its expectations unchanged by the move
 * but for the fields wave 3 adds.
 *
 * What is held: relative paths judged against the working folder and the
 * output beside the first file or where named; generate_report's and
 * revise_report's own output objects, field for field and in order; a taken
 * name refused and nothing written, or replaced when the person said so; the
 * refusals before any request in a person's words; a file that went after
 * the plan refused at its turn; a link out of the working folder refused; a
 * stop writing nothing; the gate; a failure's keys out before its cut; and a
 * result, unscrubbed as it comes back, shown through caller.ts with its keys
 * out before any string is clipped (the wave-2 review's SEC-W2-3). Since the
 * work's wave 3: the limit the AI met, refused as an `AiFailure` or carried
 * in the data, out of the real worker thread too; nothing standing in when
 * the command asks for none; and the model that answered, and the fix's.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SET_UP_AI } from '../lib/aiProvider';
import { MAX_ATTACHMENTS } from '../lib/attachmentBudget';
import { classifyGeminiError } from '../lib/geminiErrors';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { buildMockReportReply, mockAnswer } from '../services/geminiService';
import { readAiSettings, takeAiEnv, type AiSettings } from './aiSettings';
import { AiFailure, CallStopped, MAX_FILE_TEXT, ToolRefusal, clippedFromFile, scrubbed } from './caller';
import type { GenEvent, GenHooks, GenSetup } from './genJobs';
import { workerGenerator, type Generator } from './generator';
import { nodeSystem, type IfExists } from './paths';
import { failureSaid, planGenerate, planRevise, readyGenerator, runGenerate, runRevise, type CallRun, type PathPolicy } from './reportCalls';
import { inThreadGenerator } from './testClient';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'cli-calls-')));
/** The folder the command runs in, and one beside it. */
const work = join(scratch, 'work');
const elsewhere = join(scratch, 'elsewhere');
mkdirSync(work);
mkdirSync(elsewhere);
const SETUP: GenSetup = { mock: true, userFolder: join(scratch, 'forma-user'), paddleModels: null };

const system = nodeSystem();
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'C'.repeat(33);
/** The settings as the command line's entry reads them: its environment taken in its voice, the mock its --mock flag. */
const settings: AiSettings = readAiSettings(takeAiEnv({ FORMA_GEMINI_KEY: geminiKey }, 'cli').aiEnv, { voice: 'cli', mock: true });
const redact = redactorFor(settings.secrets, FORMA_KEYS);

/** The words a host's model is told, never a person at a command line. */
const MODEL_WORDS = /\bsend\b|this server|forma_status|\ba tool\b/i;

let mock: Generator;
beforeAll(() => {
  // The pipeline logs freely, as in the browser; the command line sends that to stderr.
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  mock = inThreadGenerator(SETUP, { log: () => {} });
});
afterAll(async () => {
  await mock.close();
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** The command line's policy: its working folder, its voice, and a taken name refused unless it says replace. */
const policy = <W extends IfExists = 'refuse'>(ifExists: W = 'refuse' as W, base = work): PathPolicy<W> => ({ voice: 'cli', sys: system, scope: { base }, ifExists });

/** A run on `generator`, its events kept. */
function run(generator: Generator | null = mock, signal: AbortSignal = new AbortController().signal) {
  const events: GenEvent[] = [];
  const r: CallRun = { ai: { settings, generator }, signal, tell: (e) => events.push(e), redact };
  return { r, events };
}

/** A generator that fails the test if it is ever asked. */
const never: Generator = {
  run: async () => {
    throw new Error('the AI must not be asked');
  },
  close: async () => {},
};

const at = (...parts: string[]) => join(work, ...parts);
function put(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}
const partials = () => readdirSync(work, { recursive: true }).map(String).filter((f) => f.includes('forma-partial'));
const refusal = async (p: Promise<unknown>): Promise<string> => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ToolRefusal);
  return (error as Error).message;
};

const INVOICE = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="20.1">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="Invoice" LocationFloat="0, 10" SizeF="300, 30" Font="Arial, 14pt" Padding="2,2,0,0,100" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="25" />
    <Item4 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>
`;

describe('generate, as the command line calls it', () => {
  it("makes a report from a description, its output named relative to the working folder, and returns generate_report's own output object", { timeout: 60_000 }, async () => {
    const plan = await planGenerate({ description: 'An invoice with a title and a table of items.', output: join('described', 'invoice.repx') }, policy());
    expect(plan.target).toBe(at('described', 'invoice.repx'));
    const { r, events } = run();
    const made = await runGenerate(plan, r);
    // The wave-3 fields last (GAP3-2, GAP3-4): every field before them as it was.
    expect(Object.keys(made.data)).toEqual(['written', 'ai', 'switched', 'standIn', 'notices', 'pictures', 'errors', 'warnings', 'summary', 'findings', 'printFindings', 'translated', 'model', 'fixModel', 'limit']);
    expect(made.data).toMatchObject({ written: { path: at('described', 'invoice.repx'), status: 'written' }, ai: 'mock', switched: false, standIn: null, pictures: 0, model: null, fixModel: null, limit: null });
    expect(made.data.written.bytes).toBe(readFileSync(at('described', 'invoice.repx')).byteLength);
    expect(Array.isArray(made.fromFile.findings) && Array.isArray(made.fromFile.printed)).toBe(true);
    expect(typeof made.auditWords).toBe('string');
    expect(events.at(-1)).toEqual({ stage: 'writing' });
  });

  it('reads a relative source and data file from the working folder, writing beside the first file', { timeout: 60_000 }, async () => {
    put(at('in', 'old.repx'), INVOICE);
    put(at('in', 'items.csv'), 'Item,Qty,Price\nChai,12,18.00\n');
    const plan = await planGenerate({ description: 'Make it a sales invoice', files: [join('in', 'old.repx')], data: [join('in', 'items.csv')] }, policy());
    expect(plan.inputs.map((f) => f.name)).toEqual(['old.repx', 'items.csv']);
    expect(plan.target).toBe(at('in', 'old.generated.repx'));
    const made = await runGenerate(plan, run().r);
    expect(made.data.written).toMatchObject({ path: at('in', 'old.generated.repx'), status: 'written' });
    expect(readFileSync(at('in', 'old.repx'), 'utf8')).toBe(INVOICE);
  });

  it('refuses a taken name with other content and writes nothing, then replaces it only when the person said so', { timeout: 60_000 }, async () => {
    const target = put(at('taken', 'invoice.repx'), 'a file of the person\'s own');
    const refused = await runGenerate(await planGenerate({ description: 'An invoice with a title.', output: target }, policy()), run().r);
    expect(refused.data.written).toEqual({ path: target, status: 'exists', bytes: expect.any(Number) });
    expect(readFileSync(target, 'utf8')).toBe("a file of the person's own");
    expect(readdirSync(at('taken'))).toEqual(['invoice.repx']);
    const replaced = await runGenerate(await planGenerate({ description: 'An invoice with a title.', output: target }, policy('replace')), run().r);
    expect(replaced.data.written).toMatchObject({ path: target, status: 'replaced' });
    expect(readFileSync(target, 'utf8')).toContain('<XtraReportsLayoutSerializer');
    expect(partials()).toEqual([]);
  });

  it("refuses before any request, in a person's words: nothing to make it from, no output, too many files, a wrong kind, a credential, a dot-folder, a share", async () => {
    put(at('refused', 'rows.json'), '[{"a":1}]');
    put(at('refused', 'appsettings.Production.json'), '{}');
    put(at('refused', '.hidden', 'page.png'), 'x');
    const share = system.path.sep === '\\' ? '\\\\host\\share\\page.png' : '//host/share/page.png';
    const cases: [Parameters<typeof planGenerate>[0], RegExp][] = [
      [{}, /^Give a description of the report, files to make it from, or both\.$/],
      [{ description: 'An invoice' }, /^Name where to write the report, a \.repx, since there is no file to write it beside\.$/],
      [{ description: 'x', files: Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => `p${i}.png`) }, new RegExp(`^Give at most ${MAX_ATTACHMENTS} files at once`)],
      [{ files: [join('refused', 'rows.json')] }, /is not a \.png or .*\.frx file/],
      [{ description: 'x', data: [join('refused', 'appsettings.Production.json')], output: 'out.repx' }, /named as a file of credentials, which Forma never opens/],
      [{ files: [join('refused', '.hidden', 'page.png')] }, /is inside "\.hidden"; Forma never reads from a dot-folder/],
      [{ files: [share] }, /another computer|two slashes/],
      [{ description: 'x', output: 'out.pdf' }, /is not a \.repx file/],
      [{ files: ['missing.png'] }, /There is no file at/],
    ];
    for (const [input, why] of cases) {
      const said = await refusal(planGenerate(input, policy()).then((plan) => runGenerate(plan, run(never).r)));
      expect(said, JSON.stringify(input)).toMatch(why);
      expect(said, JSON.stringify(input)).not.toMatch(MODEL_WORDS);
    }
    expect(readdirSync(at('refused')).sort()).toEqual(['.hidden', 'appsettings.Production.json', 'rows.json']);
  });

  it('reads the files only when the job has its turn: a file gone after the plan is refused then, and nothing is written', { timeout: 60_000 }, async () => {
    put(at('gone', 'page.png'), 'not really a picture');
    const plan = await planGenerate({ description: 'An invoice', files: [join('gone', 'page.png')] }, policy());
    unlinkSync(at('gone', 'page.png'));
    expect(await refusal(runGenerate(plan, run().r))).toBe(`"${at('gone', 'page.png')}" could not be read when its turn came: it was moved, removed or locked meanwhile. Nothing was written.`);
    expect(readdirSync(at('gone'))).toEqual([]);
  });

  it('refuses a file reached through a link out of the working folder, and reads it by its own full path', async () => {
    put(join(elsewhere, 'scan.png'), 'x');
    symlinkSync(elsewhere, at('link'), 'junction');
    expect(await refusal(planGenerate({ files: [join('link', 'scan.png')] }, policy()))).toMatch(/leads through a link to .*, outside the folder the command is run in; Forma follows no link out of it\./);
    const plan = await planGenerate({ files: [join(elsewhere, 'scan.png')], output: 'from-elsewhere.repx' }, policy());
    expect(plan.inputs[0].path).toBe(join(elsewhere, 'scan.png'));
  });

  it('writes nothing once stopped', async () => {
    const stop = new AbortController();
    const plan = await planGenerate({ description: 'An invoice', output: join('stopped', 'never.repx') }, policy());
    stop.abort();
    await expect(runGenerate(plan, run(mock, stop.signal).r)).rejects.toBeInstanceOf(CallStopped);
    expect(existsSync(at('stopped'))).toBe(false);
  });

  it("refuses at the gate with the app's words when no AI is set up", () => {
    expect(() => readyGenerator({ settings: readAiSettings({}), generator: null })).toThrow(ToolRefusal);
    expect(() => readyGenerator({ settings: readAiSettings({}), generator: null })).toThrow(SET_UP_AI);
    expect(readyGenerator({ settings, generator: mock })).toBe(mock);
  });

  it('refuses at the gate in the words the settings were read in: the environment the command runs in, never an MCP configuration (CLI-10)', () => {
    const unset = readAiSettings(takeAiEnv({}, 'cli').aiEnv, { voice: 'cli' });
    const said = (() => {
      try {
        readyGenerator({ settings: unset, generator: null });
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();
    expect(said.startsWith(SET_UP_AI)).toBe(true);
    expect(said).toContain('Here, Settings are the environment the command runs in');
    expect(said).not.toMatch(/\bMCP\b|assistant|\bhost\b|\btools?\b|this server/i);
  });
});

describe('revise, as the command line calls it', () => {
  it("edits a report named relative to the working folder, writing beside it and returning revise_report's own output object", { timeout: 60_000 }, async () => {
    put(at('revise', 'inv.repx'), INVOICE);
    const plan = await planRevise({ path: join('revise', 'inv.repx'), request: 'Make the title bold' }, policy());
    expect(plan.target).toBe(at('revise', 'inv.revised.repx'));
    const made = await runRevise(plan, run().r);
    expect(Object.keys(made.data)).toEqual(['path', 'kind', 'loginRemoved', 'action', 'applied', 'declined', 'ai', 'switched', 'notices', 'translated', 'written', 'errors', 'warnings', 'summary', 'findings', 'model', 'fixModel', 'limit']);
    expect(made.data).toMatchObject({ path: at('revise', 'inv.repx'), kind: 'repx', action: 'edit', applied: 1, ai: 'mock', written: { path: at('revise', 'inv.revised.repx'), status: 'written' } });
    expect(readFileSync(at('revise', 'inv.revised.repx'), 'utf8')).toMatch(/Name="title"[^>]*Font="Arial, 14pt, style=Bold"/);
    expect(readFileSync(at('revise', 'inv.repx'), 'utf8')).toBe(INVOICE);
    // Run again into the same name, now holding other content: refused, nothing written.
    put(at('revise', 'inv.revised.repx'), 'changed by hand');
    const again = await runRevise(await planRevise({ path: join('revise', 'inv.repx'), request: 'Make the title bold' }, policy()), run().r);
    expect(again.data.written).toMatchObject({ status: 'exists' });
    expect(readFileSync(at('revise', 'inv.revised.repx'), 'utf8')).toBe('changed by hand');
  });

  it("refuses an empty request and a report that is not one, in a person's words, before any request", async () => {
    put(at('revise-refused', 'notes.repx'), '<notes/>');
    for (const [input, why] of [
      [{ path: 'whatever.repx', request: '  ' }, /^Give the request: what to change in the report/],
      [{ path: join('revise-refused', 'notes.repx'), request: 'bold' }, /is not the XML layout DevExpress writes/],
      [{ path: join('revise-refused', 'missing.repx'), request: 'bold' }, /There is no file at/],
    ] as const) {
      const said = await refusal(planRevise(input, policy()).then((plan) => runRevise(plan, run(never).r)));
      expect(said).toMatch(why);
      expect(said).not.toMatch(MODEL_WORDS);
    }
  });
});

/*
 * What a failure and an answer carry (2026-11-24, the CLI and Forma Designer
 * work's wave 3; GAP3-2, GAP3-3, GAP3-4, GAP3-5 and the owner's OC5), read
 * the way the command line's batch reads them (its wave 4): the limit
 * the AI met on an `AiFailure` or in the data, worked out in the work's
 * thread from the error itself; the model that answered; and nothing standing
 * in when the command asked for none. The AI is a stub that throws the
 * service's own classified errors, or, through the real worker thread, a
 * stand-in OpenAI-compatible server on this computer that answers 429.
 */
describe('what a failure and an answer carry, as the command line reads them', () => {
  /** Google's own 429 under the service's classified error, as analyzeReportDesign throws it. */
  const googleLimit = (quotaId: string, retryDelay?: string) =>
    classifyGeminiError(
      Object.assign(
        new Error(
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
        ),
        { status: 429 },
      ),
    );
  const DAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
  const MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';
  type Ask = NonNullable<GenHooks['ask']>;
  /** The mock invoice as each answer, its `n`th call refused by `fail`, changed by `answer`. */
  const asking = (o: { fail?: (n: number) => Error | null; answer?: (n: number) => Record<string, unknown> } = {}): Ask => {
    let n = 0;
    return async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
      n += 1;
      const failure = o.fail?.(n);
      if (failure) throw failure;
      return { ...mockAnswer('true', previous, options), ...o.answer?.(n) };
    };
  };
  /** A generator whose AI is `hooks`' stand-ins, never the mock's answer. */
  const answering = (hooks: GenHooks) => inThreadGenerator({ ...SETUP, mock: false }, { log: () => {}, ...hooks });
  const failedWith = async (p: Promise<unknown>): Promise<AiFailure> => {
    const error = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AiFailure);
    // A refusal still, so the server sends its words alone, as before.
    expect(error).toBeInstanceOf(ToolRefusal);
    return error as AiFailure;
  };
  const DESCRIPTION = 'An invoice with a title and a table of items.';

  it("stands nothing in when the command asks for none: the day's limit refused with the limit as data, and nothing written", { timeout: 60_000 }, async () => {
    const gen = answering({ ask: asking({ fail: () => googleLimit(DAY, '20s') }) });
    try {
      const plan = await planGenerate({ description: DESCRIPTION, output: join('limited', 'invoice.repx') }, policy(), { standIn: false });
      expect(plan.standIn).toBe(false);
      const failure = await failedWith(runGenerate(plan, run(gen).r));
      expect(failure.limit).toEqual({ kind: 'daily', waitMs: expect.any(Number), provider: 'gemini' });
      expect(failure.limit!.waitMs).toBeGreaterThan(0);
      // At most the longest day, the 25 hours of the day the clocks go back.
      expect(failure.limit!.waitMs).toBeLessThanOrEqual(25 * 3600_000);
      expect(failure.message).toMatch(/^No report was made: Today's free daily allowance for this key is used up\. .* Nothing was written\.$/);
      expect(failure.message).not.toMatch(MODEL_WORDS);
      expect(existsSync(at('limited'))).toBe(false);
    } finally {
      await gen.close();
    }
  });

  it("stands Forma's draft in by default, as the server has it, and the result says which limit it stood in for", { timeout: 60_000 }, async () => {
    const gen = answering({ ask: asking({ fail: () => googleLimit(DAY) }) });
    try {
      const made = await runGenerate(await planGenerate({ description: DESCRIPTION, output: join('stood-in', 'invoice.repx') }, policy()), run(gen).r);
      expect(made.data).toMatchObject({ standIn: 'offline', ai: null, model: null, fixModel: null, limit: { kind: 'daily', provider: 'gemini' } });
      expect(made.data.written).toMatchObject({ path: at('stood-in', 'invoice.repx'), status: 'written' });
    } finally {
      await gen.close();
    }
  });

  it("carries a minute's limit that kept the print check's fix from being asked: the report before the fix written, with the wait and the model", { timeout: 60_000 }, async () => {
    const clipped = [{ severity: 'error', code: 'clipped-at-margin', message: 'A label runs past the right margin.' }];
    const gen = answering({
      ask: asking({
        fail: (n) => (n === 2 ? googleLimit(MINUTE, '41s') : null),
        answer: () => ({ model: 'gemini-3.6-flash-002', printFindings: clipped }),
      }),
    });
    try {
      const made = await runGenerate(await planGenerate({ description: DESCRIPTION, output: join('unfixed', 'invoice.repx') }, policy(), { standIn: false }), run(gen).r);
      expect(made.data).toMatchObject({ ai: 'gemini', standIn: null, model: 'gemini-3.6-flash-002', fixModel: null, limit: { kind: 'per-minute', waitMs: 41_000, provider: 'gemini' } });
      expect(made.data.printFindings).toEqual([{ severity: 'error', code: 'clipped-at-margin' }]);
      expect(existsSync(at('unfixed', 'invoice.repx'))).toBe(true);
      // The model is data, never a phrase: no notice names it.
      expect(made.data.notices.join(' ')).not.toContain('gemini-3.6');
    } finally {
      await gen.close();
    }
  });

  it('names the AI that answered for a fix it could not answer, when a limit had switched the request to another than the one chosen', { timeout: 60_000 }, async () => {
    const clipped = [{ severity: 'error', code: 'clipped-at-margin', message: 'A label runs past the right margin.' }];
    // OpenRouter chosen, at its limit; Gemini set up beside it answers, and is asked the fix, which meets Gemini's minute's limit.
    const routerKey = ['sk', 'or', 'v1'].join('-') + '-' + '0'.repeat(64);
    const both = readAiSettings(takeAiEnv({ FORMA_PROVIDER: 'openrouter', FORMA_OPENROUTER_KEY: routerKey, FORMA_OPENROUTER_MODEL: 'x:free', FORMA_GEMINI_KEY: geminiKey }, 'cli').aiEnv, { voice: 'cli' });
    const gemini = asking({ fail: (n) => (n === 2 ? googleLimit(MINUTE, '41s') : null), answer: () => ({ printFindings: clipped }) });
    const ask: Ask = async (prompt, parts, config, ...rest) => {
      if (config?.provider === 'openrouter') throw Object.assign(new Error('OpenRouter answered 429: Rate limit exceeded'), { status: 429, provider: 'openrouter' });
      return gemini(prompt, parts, config, ...rest);
    };
    const gen = answering({ ask });
    try {
      const plan = await planGenerate({ description: DESCRIPTION, output: join('switched', 'invoice.repx') }, policy());
      const made = await runGenerate(plan, { ...run(gen).r, ai: { settings: both, generator: gen } });
      expect(made.data).toMatchObject({ ai: 'gemini', switched: true, limit: { kind: 'per-minute', waitMs: 41_000, provider: 'gemini' } });
    } finally {
      await gen.close();
    }
  });

  it('names the model that designed the report and, when another made the fix kept, that one too', { timeout: 60_000 }, async () => {
    const clipped = [{ severity: 'error', code: 'clipped-at-margin', message: 'A label runs past the right margin.' }];
    const gen = answering({
      ask: asking({ answer: (n) => (n === 1 ? { model: 'gemini-3.6-flash-002', printFindings: clipped } : { model: 'gemini-3.5-flash-lite-001' }) }),
    });
    try {
      const made = await runGenerate(await planGenerate({ description: DESCRIPTION, output: join('fixed', 'invoice.repx') }, policy()), run(gen).r);
      expect(made.data).toMatchObject({ ai: 'gemini', model: 'gemini-3.6-flash-002', fixModel: 'gemini-3.5-flash-lite-001', limit: null, printFindings: [] });
    } finally {
      await gen.close();
    }
  });

  it("refuses a revise the AI could not answer with the limit as data, and names the model that answered an edit", { timeout: 60_000 }, async () => {
    put(at('revise-limit', 'inv.repx'), INVOICE);
    const plan = await planRevise({ path: join('revise-limit', 'inv.repx'), request: 'Make the title bold' }, policy());
    const limited = answering({ chat: async () => Promise.reject(googleLimit(MINUTE, '41s')) });
    try {
      const failure = await failedWith(runRevise(plan, run(limited).r));
      expect(failure.limit).toEqual({ kind: 'per-minute', waitMs: 41_000, provider: 'gemini' });
      expect(failure.message).toMatch(/^No change was made: This key has used its free quota of requests for the moment/);
    } finally {
      await limited.close();
    }
    expect(readdirSync(at('revise-limit'))).toEqual(['inv.repx']);
    const named = answering({
      chat: async (history, _config, _signal, _partial, report) => ({ ...buildMockReportReply(history.at(-1)!.text, report!.outline), model: 'gemini-3.5-flash-lite-001' }),
    });
    try {
      const made = await runRevise(plan, run(named).r);
      expect(made.data).toMatchObject({ action: 'edit', ai: 'gemini', model: 'gemini-3.5-flash-lite-001', fixModel: null, limit: null });
    } finally {
      await named.close();
    }
  });

  it("carries the limit out of the real worker thread: a Local AI that answers 429 with its headers, asked once, and nothing written", { timeout: 120_000 }, async () => {
    // A stand-in for an OpenAI-compatible server on this computer, answering every request with OpenRouter's rate-limit headers.
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      req.on('end', () => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Date.now() + 30_000) });
        res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
      });
      req.resume();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const local = readAiSettings(takeAiEnv({ FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'stand-in-model', FORMA_LOCAL_URL: `http://127.0.0.1:${port}/v1` }, 'cli').aiEnv, { voice: 'cli' });
    expect(local.ready).toBe(true);
    const gen = workerGenerator({ setup: { mock: false, userFolder: SETUP.userFolder, paddleModels: null }, log: () => {} });
    try {
      const plan = await planGenerate({ description: DESCRIPTION, output: join('worker', 'invoice.repx') }, policy(), { standIn: false });
      const failure = await failedWith(runGenerate(plan, { ...run(gen).r, ai: { settings: local, generator: gen } }));
      expect(failure.limit).toEqual({ kind: 'per-minute', waitMs: 30_000, provider: 'local' });
      expect(failure.message).toMatch(/^No report was made: The local AI refused the request for its rate limit/);
      expect(seen).toEqual(['POST /v1/chat/completions']);
      expect(existsSync(at('worker'))).toBe(false);
    } finally {
      await gen.close();
      await new Promise((done) => server.close(done));
    }
  });

  /*
   * The wave's review (W3R-1): the AI designs the report, and the
   * translation the words ask for then meets a limit. With nothing to stand
   * in, a report in the language it was made in is not the report asked
   * for: refused, the limit as data, nothing written, so a rerun makes it.
   * By default, as the server has it, the report is written and says why it
   * is not translated, with the limit. The design is a stand-in; the
   * translation goes to a stand-in Local AI on this computer that answers
   * 429.
   */
  it("refuses a report whose translation met a limit when nothing is to stand in, by default writes it saying so, and a revise's carries it too", { timeout: 60_000 }, async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      req.on('end', () => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
      });
      req.resume();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const local = readAiSettings(takeAiEnv({ FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'stand-in-model', FORMA_LOCAL_URL: `http://127.0.0.1:${port}/v1` }, 'cli').aiEnv, { voice: 'cli' });
    const gen = answering({ ask: asking({ answer: () => ({ model: 'stand-in-model' }) }) });
    const chatting = answering({ chat: async (_history, _config, _signal, _partial, report) => ({ ...buildMockReportReply('Make the title bold', report!.outline), tools: [{ name: 'translate', language: 'German' }] }) });
    const IN_GERMAN = 'An invoice with a title and a table of items, in German.';
    try {
      const none = await planGenerate({ description: IN_GERMAN, output: join('untranslated', 'invoice.repx') }, policy(), { standIn: false });
      const failure = await failedWith(runGenerate(none, { ...run(gen).r, ai: { settings: local, generator: gen } }));
      expect(failure.limit).toEqual({ kind: 'per-minute', waitMs: 30_000, provider: 'local' });
      expect(failure.message).toMatch(/^No report was made: the translation into German the request asks for did not answer: .+ Nothing was written\.$/);
      expect(failure.message).not.toMatch(MODEL_WORDS);
      expect(seen).toEqual(['POST /v1/chat/completions']);
      expect(existsSync(at('untranslated'))).toBe(false);

      const kept = await runGenerate(await planGenerate({ description: IN_GERMAN, output: join('as-built', 'invoice.repx') }, policy()), { ...run(gen).r, ai: { settings: local, generator: gen } });
      expect(kept.data).toMatchObject({ ai: 'local', standIn: null, translated: null, model: 'stand-in-model', limit: { kind: 'per-minute', waitMs: 30_000, provider: 'local' } });
      expect(kept.data.notices).toContain('The report could not be translated into German; it stays in the language it was made in.');
      expect(kept.data.written).toMatchObject({ path: at('as-built', 'invoice.repx'), status: 'written' });
      expect(seen).toHaveLength(2);

      // revise_report's translation, asked by the chat beside an edit: the edit written as it was, the limit carried.
      put(at('revise-translate', 'inv.repx'), INVOICE);
      const plan = await planRevise({ path: join('revise-translate', 'inv.repx'), request: 'Make the title bold and translate it into German' }, policy());
      const revised = await runRevise(plan, { ...run(chatting).r, ai: { settings: local, generator: chatting } });
      expect(revised.data).toMatchObject({ action: 'edit', applied: 1, ai: 'local', translated: null, limit: { kind: 'per-minute', waitMs: 30_000, provider: 'local' } });
      expect(revised.data.notices).toContain('The report could not be translated into German; it stays as it was.');
      expect(seen).toHaveLength(3);
    } finally {
      await gen.close();
      await chatting.close();
      await new Promise((done) => server.close(done));
    }
  });
});

describe('failureSaid', () => {
  it('takes the keys out before it cuts, so no part of a key past the cut goes out', () => {
    const shapeless = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
    const scrub = redactorFor([shapeless], FORMA_KEYS);
    const said = failureSaid(`API key not valid: ${'y'.repeat(270)} ${shapeless} rejected`, scrub);
    expect(said).toBe(`API key not valid: ${'y'.repeat(270)} (a key)...`);
    expect(failureSaid('', scrub)).toBe('the AI did not answer.');
  });
});

describe('what a caller shows of a result', () => {
  // The wave-2 review's SEC-W2-3: a result comes back unscrubbed, and the one order that makes it safe to show, keys out and
  // then the clip (W8C-1), lives in caller.ts, which loads no zod, so the command line shares it with toolShape.ts.
  const shapeless = ['gq', '00'].join('') + 'f4aba7fbd7a9'.repeat(3);
  const scrub = redactorFor([shapeless], FORMA_KEYS);

  it('takes the keys out of every string, keeping the shape, and out of text read from files before it is folded and clipped', () => {
    expect(scrubbed({ notices: [`saw ${shapeless}`], ai: null, errors: 2, nested: { reply: shapeless } }, scrub)).toEqual({ notices: ['saw (a key)'], ai: null, errors: 2, nested: { reply: '(a key)' } });
    // The key starts ten characters before the clip: cut first, its first ten characters would go out, a value no scrubber knows.
    const quoted = `${'y'.repeat(MAX_FILE_TEXT - 10)} ${shapeless} rejected`;
    expect(clippedFromFile({ reply: [quoted] }, scrub)).toEqual({ reply: [`${'y'.repeat(MAX_FILE_TEXT - 10)} (a key) r...`] });
    expect(JSON.stringify(clippedFromFile({ reply: [quoted] }, scrub))).not.toContain(shapeless.slice(0, 6));
    expect(clippedFromFile({ brief: ['two\n\n  lines'] }, scrub)).toEqual({ brief: ['two lines'] });
  });

  it("leaves the AI's failure in a result as it came, and shows it with the key out and then cut, as a command is to", { timeout: 60_000 }, async () => {
    const failing = inThreadGenerator({ ...SETUP, mock: false }, {
      ask: async () => {
        throw new Error(`API key not valid for ${'the request '.repeat(13)}key ${shapeless} rejected.`);
      },
      log: () => {},
    });
    try {
      const made = await runGenerate(await planGenerate({ description: 'An invoice with a title and a table of items.', output: join('shown', 'invoice.repx') }, policy()), { ...run(failing).r, redact: scrub });
      expect(made.data.standIn).toBe('offline');
      // As reportCalls.ts's header says: unscrubbed until the caller shows it.
      expect(made.fromFile.aiError).toContain(shapeless);
      const shown = clippedFromFile(made.fromFile, scrub) as { aiError: string };
      expect(shown.aiError).toMatch(/^API key not valid for the request .*\(a k/);
      expect(shown.aiError.length).toBeLessThanOrEqual(MAX_FILE_TEXT + 3);
      expect(JSON.stringify(shown)).not.toContain(shapeless.slice(0, 6));
    } finally {
      await failing.close();
    }
  });
});
