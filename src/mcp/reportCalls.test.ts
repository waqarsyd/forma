/**
 * The calls that ask an AI, as the command line is to make them (2026-11-24,
 * the CLI and Forma Designer work's wave 2; findings CLI-2, CLI-3, CLI-6 and
 * SEC-4 of its design audit): reportCalls.ts's `planGenerate`,
 * `runGenerate`, `planRevise` and `runRevise` with a working-folder policy
 * in the command line's voice, on files in a scratch folder, the AI stood in
 * by the mock or by a stub that fails the test if it is asked. No key is real
 * and no request leaves the process; every key is built at run time (TST-10).
 * aiTools.test.ts drives the same functions through the MCP server, its
 * expectations unchanged by the move.
 *
 * What is held: relative paths judged against the working folder and the
 * output beside the first file or where named; generate_report's and
 * revise_report's own output objects, field for field and in order; a taken
 * name refused and nothing written, or replaced when the person said so; the
 * refusals before any request in a person's words; a file that went after
 * the plan refused at its turn; a link out of the working folder refused; a
 * stop writing nothing; the gate; a failure's keys out before its cut; and a
 * result, unscrubbed as it comes back, shown through caller.ts with its keys
 * out before any string is clipped (the wave-2 review's SEC-W2-3).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SET_UP_AI } from '../lib/aiProvider';
import { MAX_ATTACHMENTS } from '../lib/attachmentBudget';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { readAiSettings, takeAiEnv, type AiSettings } from './aiSettings';
import { CallStopped, MAX_FILE_TEXT, ToolRefusal, clippedFromFile, scrubbed } from './caller';
import type { GenEvent, GenSetup } from './genJobs';
import type { Generator } from './generator';
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
/** The settings as the command line's entry is to read them: its environment taken in its voice, the mock its --mock flag. */
const settings: AiSettings = readAiSettings(takeAiEnv({ FORMA_GEMINI_KEY: geminiKey }, 'cli').aiEnv, { voice: 'cli', mock: true });
const redact = redactorFor(settings.secrets, FORMA_KEYS);

/** The words a host's model is told, never a person at a command line. */
const MODEL_WORDS = /\bsend\b|this server|forma_status|\ba tool\b/i;

let mock: Generator;
beforeAll(() => {
  // The pipeline logs freely, as in the browser; the command line will send that to stderr.
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
    expect(Object.keys(made.data)).toEqual(['written', 'ai', 'switched', 'standIn', 'notices', 'pictures', 'errors', 'warnings', 'summary', 'findings', 'printFindings', 'translated']);
    expect(made.data).toMatchObject({ written: { path: at('described', 'invoice.repx'), status: 'written' }, ai: 'mock', switched: false, standIn: null, pictures: 0 });
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
    expect(await refusal(runGenerate(plan, run().r))).toBe(`${JSON.stringify(at('gone', 'page.png'))} could not be read when its turn came: it was moved, removed or locked meanwhile. Nothing was written.`);
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
    expect(Object.keys(made.data)).toEqual(['path', 'kind', 'loginRemoved', 'action', 'applied', 'declined', 'ai', 'switched', 'notices', 'translated', 'written', 'errors', 'warnings', 'summary', 'findings']);
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
