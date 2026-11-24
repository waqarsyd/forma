/**
 * Forma's command line (2026-11-24, the CLI and Forma Designer work's wave
 * 4; findings CLI-1, CLI-7, CLI-10, CLI-11, GAP1-2, GAP1-3, SEC-3, TEST-1 and
 * TEST-3 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`, and the owner's
 * decision OC5). Two halves:
 *
 * - **In process**: commandLine.ts's `main` called as the entry calls it, with a
 *   working folder in a scratch folder, the AI's values the test's, the
 *   report commands' work run in this thread (testClient.ts `inThread`) and
 *   the AI's too (`inThreadGenerator`, the AI stood in), so coverage
 *   measures it. Every command, every exit code, the usage errors, `--json`
 *   lines parsed, the stand-in written apart only when allowed, a stop
 *   writing nothing, the key never printed, control characters never
 *   reaching a terminal, and every word said held to none of a host's.
 * - **Spawned**: the exact command the docs give, `node <clone>/` +
 *   cliCommands.ts's `CLI_LAUNCHER`, from process.execPath with no shell,
 *   from a fresh folder outside the clone, with the home and the temp folder
 *   scratch ones, as stdio.test.ts spawns the server: the help, an audit
 *   under --json, no AI set up (exit 3, nothing on stdout), a mocked generate
 *   from a folder whose tsconfig.json would break Forma if tsx applied it
 *   (CLI-8), every stdout line JSON, no key on either stream, and a usage
 *   error. A mock that is not read never becomes a request: every AI case
 *   also chooses Local AI at 127.0.0.1:1, a port fetch refuses to open
 *   (stdio.test.ts's `NOWHERE_AI`). Off Windows, Ctrl+C reaches a run
 *   waiting on an AI that never answers (a stand-in server on this
 *   computer) and ends it with 130, nothing written; on Windows a spawned
 *   child's SIGINT is a kill that skips the handler (TEST-3, measured in the
 *   design audit), so the stop is held there in process, through the
 *   signal, and by `stopOnSignals` on a stand-in process.
 *
 * Since the wave's second part (GAP1-1, CLI-5, SEC-1, GAP1-3, GAP1-4,
 * GAP3-3, OC5, OC7): convert, in process, on made-up SSRS and FastReport
 * reports (the version said, the notices, the same bytes the next time, a
 * file that will not convert failed); and the batch, in process on a folder
 * of every kind it meets (pictures and a PDF with one stem, SSRS and
 * FastReport reports, a report, a data file, a Crystal file, a dot-folder,
 * node_modules, a last run's output, and a junction or directory link out of
 * it), the mock for generation: each route and name, --dry-run, the gate
 * only when a route asks the AI, --skip-existing resuming, a minute's limit
 * waited out and the day's stopping the rest through the runner, the kept
 * parks read before a file, the key refused, Ctrl+C, --allow-stand-in's
 * draft, --max and --data; and spawned from outside the clone, through the
 * real worker threads, stdout JSON Lines alone.
 *
 * Since that wave's review (U1 to U15, SEC-W4-1 to SEC-W4-5): what a run
 * prints a person and a CI step (a finding whole under --json, a path
 * quoted plainly, a name with a line break one line, a taken name's
 * refusal on stderr alone, the file system's refusals as failures), what
 * --force never reaches (a login's report in place, a file a report is made
 * from), the draft's own status, a report the words leave as it was still
 * written, each file a stop leaves listed, the batch's outputs and data
 * judged in the working folder's mode, the key's refusal read only in the
 * AI's own failure, and, spawned, the entry's scrubber and rejection rule.
 * A case whose AI could fall through to a request chooses Local AI on a port
 * nothing listens on and stands the design call in with one that throws.
 *
 * No key is real and no request leaves this computer; every key is built at
 * run time (TST-10). Paths are built with join, so the cases run on CI's
 * Linux as here.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyGeminiError } from '../lib/geminiErrors';
import { keyTag } from '../lib/modelCache';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { encodeBase64 } from '../lib/repxSqlDataSource';
import { mockAnswer, type ChatOutcome } from '../services/geminiService';
import type { AiEnv } from './aiSettings';
import { EDIT_COMMAND_OPS, EXIT, aiMark, editsFrom, fileSystemRefusal, helpText, limitWords, main, parseArgs, plainWords, stopOnSignals, unfolded, worstExit, type CliIo, type SignalSource } from './commandLine';
import { CLI_COMMANDS, CLI_LAUNCHER } from './cliCommands';
import type { GenHooks } from './genJobs';
import type { Generator } from './generator';
import { formaUserFolder } from './nodeGeneration';
import { nodeWriteFs, type PathSystem, type WriteFs } from './paths';
import { inThread, inThreadGenerator } from './testClient';
import { TOOL_LIST } from './toolList';
import { formaVersion } from './version';
import type { Pipeline } from './workerPool';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'cli-')));
const userFolder = join(scratch, 'forma-user');

/** A key of AI Studio's form, and one in a shape no pattern knows, built at run time (TST-10). */
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'D'.repeat(33);
const shapelessKey = ['gq', '00'].join('') + 'b7c1d2e3f4a5'.repeat(3);
/** The key the cases that meet a limit use: the models a limit parks are kept by the key's tag (modelParks.ts), so no other case meets them. */
const limitKey = ['AI', 'za', 'Sy'].join('') + 'L'.repeat(33);
const redact = redactorFor([geminiKey, shapelessKey, limitKey], FORMA_KEYS);
/** An AI set up, for the gate: Gemini with the stand-in key. */
const GEMINI: AiEnv = { FORMA_GEMINI_KEY: geminiKey };
const LIMITED: AiEnv = { FORMA_GEMINI_KEY: limitKey };
/** An AI that cannot leave this computer, chosen beside the mock so a mock not read is never a request (stdio.test.ts's NOWHERE_AI). */
const NOWHERE: AiEnv = { FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'forma-test-model', FORMA_LOCAL_URL: 'http://127.0.0.1:1/v1' };

/** An AI that must never be asked: a batch's case that asks none, or stops before asking. */
const NEVER_ASKED: GenHooks = {
  ask: async () => {
    throw new Error('the AI must not be asked');
  },
  chat: async () => {
    throw new Error('the AI must not be asked');
  },
};

/** "MCP" as a word, and the rest of what a host's model is told and a person never is (cliVoice.test.ts's rule). */
const forAHost = (text: string) => /\bMCP\b/.test(text) || new RegExp(String.raw`\b(?:assistant|hosts?|tools?)\b|fromFile|this server|${TOOL_LIST.map((t) => t.name).join('|')}`, 'i').test(text);

/** Everything the command line said in these cases, read once more at the end. */
const said: string[] = [];

beforeAll(() => {
  // The pipeline logs freely, as in the browser; in a real run that goes to stderr through the guard.
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

let folders = 0;
/** A fresh working folder for a case. */
function folder(): string {
  const dir = join(scratch, `work-${++folders}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function put(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

interface Ran {
  code: number;
  out: string;
  err: string;
  /** stdout's lines. */
  lines: string[];
  /** stdout's lines parsed, under --json. */
  json(): Record<string, any>[];
}

/**
 * `main` as the entry calls it: the work in this thread, the AI stood in by
 * `hooks` (the mock when the run asks for it), or by a generator of the
 * case's own; a batch's waits recorded and never slept (`waits`), unless the
 * case hands its own `sleep`.
 */
async function cli(
  argv: string[],
  o: { cwd: string; env?: AiEnv; signal?: AbortSignal; hooks?: GenHooks; pipeline?: Pipeline; generator?: () => Generator; userFolder?: string; sleep?: CliIo['sleep']; waits?: number[]; sys?: PathSystem; wfs?: WriteFs },
): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: o.cwd,
    ...(o.sys ? { sys: o.sys } : {}),
    ...(o.wfs ? { wfs: o.wfs } : {}),
    aiEnv: o.env ?? {},
    out: (text) => out.push(text),
    err: (line) => err.push(line),
    redact,
    signal: o.signal ?? new AbortController().signal,
    pipeline: () => o.pipeline ?? inThread,
    generator: (setup, log) => (o.generator ? o.generator() : inThreadGenerator({ ...setup, userFolder: o.userFolder ?? userFolder, paddleModels: null }, { log, ...o.hooks })),
    userFolder: o.userFolder ?? userFolder,
    sleep:
      o.sleep ??
      (async (ms) => {
        o.waits?.push(ms);
      }),
  };
  const code = await main(argv, io);
  const text = out.join('');
  said.push(text, ...err);
  const lines = text.split('\n').filter(Boolean);
  return { code, out: text, err: err.join('\n'), lines, json: () => lines.map((l) => JSON.parse(l)) };
}

const INVOICE = (extra = '', text = 'Invoice') => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" Margins="100, 100, 100, 100" PageWidth="850" PageHeight="1100" Version="20.1"${extra}>
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60">
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="title" Text="${text}" LocationFloat="0, 10" SizeF="300, 30" Font="Arial, 14pt" Padding="2,2,0,0,100" />
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="25" />
    <Item4 Ref="6" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>
`;
/** A report with code of its own, which the audit names as an error (report-has-scripts). */
const SCRIPTED = INVOICE(' ScriptsSource="private void x() {}"');
/** A report with no band, which the draft PDF cannot draw. */
const NO_BANDS = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Empty" Version="20.1" />
`;
/** A report whose SQL data source stores a login (reportTools.test.ts's LOGIN, made up): server db01, user sa, password Secret123. */
const LOGIN = '<Connection Name="Sales" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="database" Value="Sales" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="Secret123" /></Parameters></Connection>';
const WITH_LOGIN = INVOICE(' DataMember="Orders" DataSource="#Ref-0"').replace(
  '</XtraReportsLayoutSerializer>',
  `  <ComponentStorage><Item1 Ref="0" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${encodeBase64(`<SqlDataSource Name="sqlDataSource1">${LOGIN}<Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`)}" /></ComponentStorage>\n</XtraReportsLayoutSerializer>`,
);

describe('the arguments, the help and the exit codes', () => {
  it('lists every command in its help, the AI ones marked, every option, the exit codes and the documented command, and gives its version', async () => {
    const dir = folder();
    for (const flag of ['--help', '-h']) {
      const ran = await cli([flag], { cwd: dir });
      expect(ran.code).toBe(EXIT.done);
      expect(ran.out).toBe(helpText(formaVersion()));
    }
    const help = helpText('9.9.9');
    expect(help).toContain(`node <clone>/${CLI_LAUNCHER} <command> [options]`);
    for (const c of CLI_COMMANDS) {
      expect(help).toContain(`  ${c.name} ${c.usage}${aiMark(c)}\n`);
      for (const option of c.options) expect(help, option).toContain(`  ${option}`);
    }
    expect(CLI_COMMANDS.filter((c) => c.needsAi === true).map((c) => c.name)).toEqual(['generate', 'revise']);
    expect(CLI_COMMANDS.filter((c) => c.needsAi === 'by route').map((c) => c.name)).toEqual(['batch']);
    expect(help).toContain('  batch <folder> --out <folder> ');
    expect(help).toContain('[AI for some files]');
    expect(help).toContain('Exit codes: 0 done; 1 a report written or audited with audit errors; 2 a usage error; 3 no AI set up; 4 ');
    expect(help).toContain('with at most 15 minutes and 2048 MB of memory, so one bad file cannot end the batch');
    // Every command is built since the wave's second part: none is marked as still to come.
    expect(CLI_COMMANDS.filter((c) => 'soon' in c)).toEqual([]);
    expect(help).not.toContain('(not built yet)');
    const version = await cli(['--version'], { cwd: dir });
    expect(version).toMatchObject({ code: 0, out: `${formaVersion()}\n` });
  });

  it.each([
    [[], /^Name a command\./],
    [['nope'], /^"nope" is not a command\./],
    [['audit'], /^Name a report, or a folder of reports, to audit\./],
    [['audit', 'a.repx', '--force'], /^--force is not an option of audit\./],
    [['audit', '-x', 'a.repx'], /is not an option; options are written in full/],
    [['audit', 'a.repx', '--fail-on', 'maybe'], /^--fail-on takes errors or never\./],
    [['audit', 'a.repx', '--json=1'], /^--json takes no value\./],
    [['audit', 'a.repx', '--colour'], /^"--colour" is not an option of Forma's command line\./],
    [['convert'], /^Name an SSRS or FastReport report \(\.rdl, \.rdlc or \.frx\), or a folder of them, to convert\./],
    [['convert', 'a.rdl', '--words', 'x'], /^--words is not an option of convert\./],
    [['batch'], /^batch takes one folder; 0 were named\./],
    [['batch', 'a', 'b', '--out', 'o'], /^batch takes one folder; 2 were named\./],
    [['batch', 'in'], /^Name the folder to write the reports in with --out/],
    [['batch', 'in', '--out', 'o', '--force', '--skip-existing'], /^--force makes a report again where one is already there, and --skip-existing leaves it; give one of them\./],
    [['batch', 'in', '--out', 'o', '--edits-only'], /^--edits-only goes with --words/],
    [['batch', 'in', '--out', 'o', '--words', ' '], /^--words needs a value after it\./],
    [['batch', 'in', '--out', 'o', '--max', '0'], /^--max takes a whole number of files, 1 or more\./],
    [['batch', 'in', '--out', 'o', '--max', 'many'], /^--max takes a whole number/],
    [['repair', 'a.repx', '--repair'], /^--repair is not an option of repair\./],
    [['repair', 'a.repx', 'b.repx'], /^repair takes one report; 2 were named\./],
    [['repair', 'a.repx', '--out'], /^--out needs a value after it\./],
    [['repair', 'a.repx', '--out', '--force'], /^--out needs a value after it\./],
    [['repair', 'a.repx', '--out', ' '], /^--out needs a value after it\./],
    [['repair', 'a.repx', '--out', 'a.repx', '--out', 'b.repx'], /^--out is given 2 times; give it once\./],
    [['edit', 'a.repx'], /^Give the edits with --edits/],
    [['revise', 'a.repx'], /^Give the request with --words/],
    [['revise', 'a.repx', '--words', '  '], /^Give the request with --words/],
    [['generate'], /^Name files to make the report from, give --description/],
    [['generate', '--description', 'An invoice'], /^Name where to write the report with --out/],
  ])('refuses %j as a usage error, exit 2, saying how to see the help', async (argv, why) => {
    const ran = await cli(argv as string[], { cwd: folder() });
    expect(ran.code).toBe(EXIT.usage);
    expect(ran.out).toBe('');
    expect(ran.err).toMatch(why);
    expect(ran.err).toMatch(/Run with --help for the commands and their options\.$/);
  });

  it('reads options anywhere, in either form, repeats --data, and takes everything after -- as an input', () => {
    const read = parseArgs(['--json', 'generate', 'a.png', '--data=d.csv', '--data', 'e.json', '--out=x.repx', '--description', 'An invoice', '--', '--odd.pdf']);
    expect(read).toMatchObject({ kind: 'run', inputs: ['a.png', '--odd.pdf'], options: { json: true, data: ['d.csv', 'e.json'], out: 'x.repx', description: 'An invoice', failOn: 'errors' } });
    expect(parseArgs(['audit', '--', '--help'])).toMatchObject({ kind: 'run', inputs: ['--help'] });
    expect(parseArgs(['audit', 'x.repx', '--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version', 'audit'])).toEqual({ kind: 'version' });
  });

  it('chooses the run\'s exit code in the order 130, 70, 5, 4, 1, 0', () => {
    expect(worstExit([])).toBe(0);
    expect(worstExit([0, 1, 0])).toBe(1);
    expect(worstExit([1, 4, 0])).toBe(4);
    expect(worstExit([4, 5, 1])).toBe(5);
    expect(worstExit([5, 70, 4])).toBe(70);
    expect(worstExit([70, 130, 0])).toBe(130);
  });

  it('says a limit in words: which AI, which limit, and when it lifts', () => {
    expect(limitWords({ kind: 'daily', waitMs: 3 * 3600_000, provider: 'gemini' })).toBe('Gemini reached its daily limit, which lifts in about 3 hours.');
    expect(limitWords({ kind: 'per-minute', waitMs: 41_000, provider: 'openrouter' })).toBe('OpenRouter reached its per-minute limit, which lifts in about 41 seconds.');
    expect(limitWords({ kind: 'unknown', waitMs: 600_000, provider: 'gemini' })).toBe('Gemini reached its limit, which lifts in about 10 minutes.');
    expect(limitWords({ kind: 'unknown', waitMs: null, provider: 'local' })).toMatch(/reached its limit\.$/);
  });
});

describe('the report commands, which need no AI', () => {
  it('audits a report, and every report directly in a folder, as JSON Lines under --json, and never looks at the AI', async () => {
    const dir = folder();
    put(dir, join('reports', 'a.repx'), INVOICE());
    put(dir, join('reports', 'b.vsrepx'), INVOICE());
    put(dir, join('reports', 'notes.txt'), 'not a report');
    put(dir, join('reports', '.hidden.repx'), INVOICE());
    put(dir, join('reports', 'deeper', 'c.repx'), INVOICE());
    const plain = await cli(['audit', 'reports'], { cwd: dir });
    expect(plain.code).toBe(EXIT.done);
    expect(plain.lines.filter((l) => l.startsWith('Audited')).map((l) => l.slice(0, l.indexOf('": ') + 1))).toEqual([`Audited "${join(dir, 'reports', 'a.repx')}"`, `Audited "${join(dir, 'reports', 'b.vsrepx')}"`]);
    expect(plain.lines.at(-1)).toBe('2 inputs: 2 done.');
    const json = await cli(['audit', join('reports', 'a.repx'), '--json'], { cwd: dir });
    const [line, summary] = json.json();
    expect(json.lines).toHaveLength(2);
    expect(line).toMatchObject({ type: 'input', command: 'audit', input: join('reports', 'a.repx'), status: 'done', exitCode: 0, path: join(dir, 'reports', 'a.repx'), kind: 'repx', loginRemoved: false, errors: 0 });
    expect(summary).toEqual({ type: 'summary', command: 'audit', inputs: 1, done: 1, errors: 0, skipped: 0, draft: 0, unbound: 0, exists: 0, refused: 0, failed: 0, declined: 0, limit: 0, notStarted: 0, stopped: 0, internal: 0, exitCode: 0 });
  });

  it('gives each finding under --json as one string, whole, beside its code, where the plain lines keep their folding (U9)', async () => {
    const dir = folder();
    // A label holding an expression as plain text, its finding naming it; the name long enough that the finding runs past
    // the 200 characters a folded line holds.
    const long = `a${'very'.repeat(60)}LongName`;
    put(dir, 'r.repx', INVOICE('', '[Products.Name].Substring(0,1)').replace('Name="title"', `Name="${long}"`));
    const json = await cli(['audit', 'r.repx', '--json'], { cwd: dir });
    const [line] = json.json();
    expect(line.findings.length).toBeGreaterThan(0);
    expect(line.fileText.findings).toHaveLength(line.findings.length);
    line.findings.forEach((f: { severity: string; code: string }, i: number) => expect(line.fileText.findings[i].startsWith(`${f.severity} ${f.code}:`)).toBe(true));
    expect(line.fileText.findings.some((s: string) => s.length > 200)).toBe(true);
    // Cut inside the name, it is joined back with no space; cut at a space, the space comes back.
    expect(line.fileText.findings.join('\n')).toContain(`"${long}" holds an expression as plain text, so the brackets print as they are.`);
    const plain = await cli(['audit', 'r.repx'], { cwd: dir });
    expect(plain.lines.some((l) => l.startsWith('  ... '))).toBe(true);
  });

  it('exits 1 for a report with audit errors, 0 with --fail-on never, and 4 for a file that is missing or not a report, the highest winning', async () => {
    const dir = folder();
    put(dir, 'scripted.repx', SCRIPTED);
    put(dir, 'broken.repx', '<XtraReportsLayoutSerializer><Bands>');
    const errors = await cli(['audit', 'scripted.repx'], { cwd: dir });
    expect(errors.code).toBe(EXIT.auditErrors);
    expect(errors.out).toContain('error report-has-scripts:');
    expect((await cli(['audit', 'scripted.repx', '--fail-on', 'never'], { cwd: dir })).code).toBe(EXIT.done);
    const mixed = await cli(['audit', 'scripted.repx', 'missing.repx', 'broken.repx', '--json'], { cwd: dir });
    expect(mixed.code).toBe(EXIT.failed);
    expect(mixed.json().map((l) => l.status)).toEqual(['errors', 'refused', 'refused', undefined]);
    expect(mixed.json()[1].message).toMatch(/^There is no file at /);
    expect(mixed.json()[2].message).toMatch(/is not well-formed XML/);
    expect(mixed.json()[3]).toMatchObject({ type: 'summary', inputs: 3, errors: 1, refused: 2, exitCode: 4 });
  });

  it('refuses a folder with no report in it, and one reached through a link out of the working folder, judged before it is listed', async () => {
    const dir = folder();
    mkdirSync(join(dir, 'empty'));
    const empty = await cli(['audit', 'empty'], { cwd: dir });
    expect(empty.code).toBe(EXIT.failed);
    expect(empty.err).toMatch(/holds no report \(\.repx or \.vsrepx\) directly in it/);
    const outside = folder();
    put(outside, 'secret.repx', INVOICE());
    // A junction on Windows (no privilege needed), a directory link elsewhere: a checkout can carry either out of its folder (SEC-1).
    symlinkSync(outside, join(dir, 'away'), process.platform === 'win32' ? 'junction' : 'dir');
    const away = await cli(['audit', 'away'], { cwd: dir });
    expect(away.code).toBe(EXIT.failed);
    expect(away.err).toMatch(/Forma follows no link out of it/);
    expect(away.out).not.toContain('secret');
    const dotted = await cli(['audit', '.git'], { cwd: dir });
    expect(dotted.code).toBe(EXIT.failed);
  });

  it('outlines a report, with no control character from the report reaching the screen', async () => {
    const dir = folder();
    // Written raw into the attribute, as a hostile report can carry them (an escape sequence, a right-to-left override).
    put(dir, 'r.repx', INVOICE('', `Red ${String.fromCharCode(27)}[31m and ${String.fromCharCode(0x202e)}reversed`));
    const ran = await cli(['outline', 'r.repx'], { cwd: dir });
    expect(ran.code).toBe(EXIT.done);
    expect(ran.lines[0]).toBe(`Outlined "${join(dir, 'r.repx')}": 4 bands, 1 control, 0 fields printed, 0 parameters and 0 SQL data sources.`);
    expect(ran.out).toContain('title: XRLabel');
    expect(ran.out).not.toMatch(/[\u001b\u202e]/);
    const json = await cli(['outline', 'r.repx', '--json'], { cwd: dir });
    expect(json.out).not.toMatch(/[\u001b\u202e]/);
    expect(json.json()[0]).toMatchObject({ status: 'done', bands: 4, controls: 1, fileText: { outline: expect.any(Array), dataSources: [] } });
  });

  it('repairs a report into a new file, finds the same bytes the next time, refuses other content there (exit 4), replaces it with --force, and writes into a folder --out names', async () => {
    const dir = folder();
    put(dir, 'r.repx', INVOICE());
    const first = await cli(['repair', 'r.repx'], { cwd: dir });
    expect(first.code).toBe(EXIT.done);
    expect(first.lines[0]).toMatch(new RegExp(`^Wrote "${join(dir, 'r.repaired.repx').replace(/[\\.]/g, '\\$&')}"\\. `));
    const again = await cli(['repair', 'r.repx'], { cwd: dir });
    expect(again.code).toBe(EXIT.done);
    expect(again.lines[0]).toMatch(/^Found the same file already at /);
    writeFileSync(join(dir, 'r.repaired.repx'), 'something else');
    const taken = await cli(['repair', 'r.repx', '--json'], { cwd: dir });
    expect(taken.code).toBe(EXIT.failed);
    expect(taken.json()[0]).toMatchObject({ status: 'exists', exitCode: 4, written: { status: 'exists' } });
    expect(readFileSync(join(dir, 'r.repaired.repx'), 'utf8')).toBe('something else');
    // Plain, the refusal is on stderr alone, never a result line that then says what was done (U6).
    const takenPlain = await cli(['repair', 'r.repx'], { cwd: dir });
    expect(takenPlain.out).toBe('');
    expect(takenPlain.err).toBe(`"${join(dir, 'r.repaired.repx')}" is already there and holds something else, so nothing was written; give --force to replace it.`);
    const forced = await cli(['repair', 'r.repx', '--force'], { cwd: dir });
    expect(forced.code).toBe(EXIT.done);
    expect(forced.lines[0]).toMatch(/^Replaced /);
    mkdirSync(join(dir, 'out'));
    expect((await cli(['repair', 'r.repx', '--out', 'out'], { cwd: dir })).code).toBe(EXIT.done);
    expect((await cli(['repair', 'r.repx', '--out', `new${sep}`], { cwd: dir })).code).toBe(EXIT.done);
    expect(readdirSync(join(dir, 'out'))).toEqual(['r.repaired.repx']);
    expect(readdirSync(join(dir, 'new'))).toEqual(['r.repaired.repx']);
    const scripted = put(dir, 's.repx', SCRIPTED);
    expect((await cli(['repair', scripted], { cwd: dir })).code).toBe(EXIT.auditErrors);
    expect(readdirSync(dir).filter((f) => f.includes('forma-partial'))).toEqual([]);
  });

  it('draws a draft PDF, and refuses a report with no band to draw, pointing at the audit command', async () => {
    const dir = folder();
    put(dir, 'r.repx', INVOICE());
    put(dir, 'empty.repx', NO_BANDS);
    const drawn = await cli(['pdf', 'r.repx', '--json'], { cwd: dir });
    expect(drawn.code).toBe(EXIT.done);
    expect(drawn.json()[0]).toMatchObject({ status: 'done', pages: 1, written: { path: join(dir, 'r.pdf'), status: 'written' } });
    expect(readFileSync(join(dir, 'r.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const empty = await cli(['pdf', 'empty.repx'], { cwd: dir });
    expect(empty.code).toBe(EXIT.failed);
    expect(empty.err).toMatch(/so there is nothing to draw; the audit command says what is wrong with it\.$/);
  });

  it('makes edits given as JSON or in a .json file, declines one it cannot make (exit 4), and refuses edits that are not the chat\'s as a usage error', async () => {
    const dir = folder();
    put(dir, 'r.repx', INVOICE());
    const inline = await cli(['edit', 'r.repx', '--edits', '[{"op":"text","control":"title","text":"Bill"}]'], { cwd: dir });
    expect(inline.code).toBe(EXIT.done);
    expect(inline.lines[0]).toMatch(/^Wrote ".*r\.edited\.repx"\. 1 edit made\.$/);
    expect(readFileSync(join(dir, 'r.edited.repx'), 'utf8')).toContain('Text="Bill"');
    put(dir, 'edits.json', '\ufeff{"op":"font","control":"title","bold":true}');
    const fromFile = await cli(['edit', 'r.repx', '--edits', 'edits.json', '--out', 'bold.repx'], { cwd: dir });
    expect(fromFile.code).toBe(EXIT.done);
    expect(readFileSync(join(dir, 'bold.repx'), 'utf8')).toMatch(/style=Bold/);
    const declined = await cli(['edit', 'r.repx', '--edits', '[{"op":"text","control":"nope","text":"X"}]', '--out', 'never.repx'], { cwd: dir });
    expect(declined.code).toBe(EXIT.failed);
    expect(declined.out).toContain('declined: text nope: no control is named "nope"');
    expect(existsSync(join(dir, 'never.repx'))).toBe(false);
    const missing = await cli(['edit', 'r.repx', '--edits', 'none.json'], { cwd: dir });
    expect(missing.code).toBe(EXIT.failed);
    for (const [edits, why] of [
      ['[{"op":', /is not JSON/],
      ['[]', /holds no edit/],
      ['[1]', /is not an object/],
      ['[{"control":"title"}]', /has no op/],
      ['[{"op":"data"}]', /its op is not one of text, /],
      ['[{"op":"text","colour":"red"}]', /has "colour", which no edit reads/],
      ['[{"op":"move","control":"title","x":"10"}]', /its x is not a number/],
      ['[{"op":"align","control":"title","align":"middle"}]', /its align is not left, center or right/],
      ['[{"op":"font","control":"title","bold":"yes"}]', /its bold is not true or false/],
    ] as const) {
      const ran = await cli(['edit', 'r.repx', '--edits', edits], { cwd: dir });
      expect(ran.code, edits).toBe(EXIT.usage);
      expect(ran.err, edits).toMatch(why);
    }
    expect(EDIT_COMMAND_OPS).not.toContain('data');
    expect(() => editsFrom('{"op":"text","control":"title","text":"A"}', 'x')).not.toThrow();
  });

  it('reads and writes nothing once stopped: the inputs left are said as not started, and the run exits 130', async () => {
    const dir = folder();
    put(dir, 'a.repx', INVOICE());
    put(dir, 'b.repx', INVOICE());
    const stop = new AbortController();
    stop.abort();
    const ran = await cli(['audit', 'a.repx', 'b.repx', '--json'], { cwd: dir, signal: stop.signal });
    expect(ran.code).toBe(EXIT.interrupted);
    expect(ran.json()).toEqual([expect.objectContaining({ type: 'summary', inputs: 2, notStarted: 2, exitCode: 130 })]);
    // A report command's work stopped under way: nothing written.
    const during = new AbortController();
    const stopping: Pipeline = {
      run: async (job) => {
        during.abort();
        return inThread.run(job as never, during.signal) as never;
      },
      close: async () => {},
    };
    const repaired = await cli(['repair', 'a.repx'], { cwd: dir, signal: during.signal, pipeline: stopping });
    expect(repaired.code).toBe(EXIT.interrupted);
    expect(repaired.err).toContain('Stopped: the report under way was not written.');
    expect(readdirSync(dir).sort()).toEqual(['a.repx', 'b.repx']);
  });

  it('says an internal error as one, exit 70, with its stack only under --verbose', async () => {
    const dir = folder();
    put(dir, 'a.repx', INVOICE());
    const broken: Pipeline = {
      run: async () => {
        throw new Error('a library broke\n    at somewhere');
      },
      close: async () => {},
    };
    const ran = await cli(['audit', 'a.repx'], { cwd: dir, pipeline: broken });
    expect(ran.code).toBe(EXIT.internal);
    expect(ran.err).toBe(`Forma stopped on an internal error with "a.repx": a library broke`);
    const verbose = await cli(['audit', 'a.repx', '--verbose'], { cwd: dir, pipeline: broken });
    expect(verbose.err).toContain('at ');
  });

  it('says a file system that refuses the write as a failure naming the file, exit 4, never as an internal error or by its temporary name (U3)', async () => {
    const dir = folder();
    put(dir, 'r.repx', INVOICE());
    const fsError = (code: string, syscall: string, path: string, dest?: string) => Object.assign(new Error(`${code}: operation not permitted, ${syscall} '${path}'`), { code, syscall, path, ...(dest ? { dest } : {}) });
    // A folder that allows no file: the temporary file cannot be made.
    const readOnly: WriteFs = { ...nodeWriteFs, writeNew: (p) => { throw fsError('EPERM', 'open', p); } };
    const ran = await cli(['repair', 'r.repx', '--json'], { cwd: dir, wfs: readOnly });
    expect(ran.code).toBe(EXIT.failed);
    expect(ran.json()[0]).toMatchObject({
      status: 'failed',
      exitCode: 4,
      message: `Forma cannot write "${join(dir, 'r.repaired.repx')}": the system does not allow it (the file is read-only, or its folder does not allow it). Nothing was written; choose another --out, or make room or allow it, and run the command again.`,
    });
    // A read-only file replaced with --force: the rename is refused, and the file stays as it was.
    writeFileSync(join(dir, 'r.repaired.repx'), 'mine');
    const locked: WriteFs = { ...nodeWriteFs, rename: (from, to) => { throw fsError('EPERM', 'rename', from, to); } };
    const forced = await cli(['repair', 'r.repx', '--force'], { cwd: dir, wfs: locked });
    expect(forced.code).toBe(EXIT.failed);
    expect(forced.err).toMatch(new RegExp(`^Forma cannot write "${join(dir, 'r.repaired.repx').replace(/[\\.]/g, '\\$&')}": `));
    expect(forced.out + forced.err).not.toContain('forma-partial');
    expect(readFileSync(join(dir, 'r.repaired.repx'), 'utf8')).toBe('mine');
    expect(readdirSync(dir).filter((f) => f.includes('forma-partial'))).toEqual([]);
    // A full disk and a read refused in their words; anything else is still an internal error.
    expect(fileSystemRefusal(fsError('ENOSPC', 'write', join(dir, 'x.repx.forma-partial-abc123')))).toMatch(new RegExp(`^Forma cannot write ".*x\\.repx": its disk is full\\.`));
    expect(fileSystemRefusal(fsError('EACCES', 'open', join(dir, 'r.repx')))).toMatch(/^Forma cannot read ".*r\.repx": the system does not allow it \(permission denied\)\.$/);
    expect(fileSystemRefusal(new Error('a library broke'))).toBeNull();
    expect(fileSystemRefusal(Object.assign(new Error('x'), { code: 'ERR_SOMETHING' }))).toBeNull();
  });

  it("quotes a path plainly in a refusal, single backslashes and all, so a person can copy it, under Windows' rules on any system (U8)", async () => {
    const touched: string[] = [];
    const fs = new Proxy({} as PathSystem['fs'], {
      get: (_target, name) => () => {
        touched.push(String(name));
        throw new Error('the disk was touched');
      },
    });
    const sys: PathSystem = { path: win32, fs, home: 'C:\\Users\\me' };
    const refused = async (raw: string) => {
      const ran = await cli(['audit', raw], { cwd: 'G:\\proj', sys });
      expect(ran.code, raw).toBe(EXIT.failed);
      return ran.err;
    };
    expect(await refused('\\\\server\\share\\x.repx')).toBe('"\\\\server\\share\\x.repx" names a path on another computer, which Forma never opens.');
    expect(await refused('\\\\.\\C:\\x.repx')).toBe('"\\\\.\\C:\\x.repx" is the long form of a path on drive C:; give it as "C:\\x.repx".');
    expect(await refused('/g/DevFiles/x.repx')).toBe('"/g/DevFiles/x.repx" is a Git Bash or WSL path; give "G:\\DevFiles\\x.repx".');
    expect(touched).toEqual([]);
  });

  it('tells how to name a new folder when --out has another kind, where a data file goes, and an edit in one sentence (U13)', async () => {
    const dir = folder();
    put(dir, 'r.repx', INVOICE());
    put(dir, 'items.csv', 'Item\nPaper\n');
    const newFolder = await cli(['repair', 'r.repx', '--out', 'newdir'], { cwd: dir });
    expect(newFolder.code).toBe(EXIT.usage);
    expect(newFolder.err).toBe(`--out names "newdir", which is not a .repx or .vsrepx file, what repair writes; to write into a new folder, end it with a separator: "newdir${sep}". Run with --help for the commands and their options.`);
    const pdf = await cli(['pdf', 'r.repx', '--out', 'y.repx'], { cwd: dir });
    expect(pdf.code).toBe(EXIT.usage);
    expect(pdf.err).toMatch(/^--out names "y\.repx", which is not a \.pdf file, what pdf writes; /);
    const data = await cli(['generate', 'items.csv', '--out', 'x.repx'], { cwd: dir, env: GEMINI, hooks: NEVER_ASKED });
    expect(data.code).toBe(EXIT.usage);
    expect(data.err).toMatch(/^"items\.csv" is a data file, whose columns become the report's fields: give it with --data "items\.csv", beside a picture, a PDF, a report or --description\./);
    const edit = await cli(['edit', 'r.repx', '--edits', '[{"op":"move","control":"title","x":"1"}]'], { cwd: dir });
    expect(edit.err).toMatch(/^Edit 1 of the edits given with --edits: its x is not a number\./);
    expect(readdirSync(dir).sort()).toEqual(['items.csv', 'r.repx']);
  });
});

describe('the commands that ask an AI', () => {
  const DESCRIPTION = 'An invoice with a title and a table of items.';
  /** Google's own 429 under the service's classified error, as analyzeReportDesign throws it (reportCalls.test.ts's). */
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
  const dayLimit = () => googleLimit('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  const minuteLimit = () => googleLimit('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '41s');
  /** An AI that fails every request with `error`. */
  const failing = (error: () => Error): GenHooks => ({
    ask: async () => {
      throw error();
    },
  });
  /** An AI that must never be asked. */
  const never: GenHooks = {
    ask: async () => {
      throw new Error('the AI must not be asked');
    },
    chat: async () => {
      throw new Error('the AI must not be asked');
    },
  };

  it('refuses with no AI set up, exit 3, before any file is read, in a person\'s words, and as a summary line under --json', async () => {
    const dir = folder();
    const ran = await cli(['generate', 'missing.png', '--out', 'x.repx'], { cwd: dir, hooks: never });
    expect(ran.code).toBe(EXIT.noAi);
    expect(ran.out).toBe('');
    expect(ran.err).toMatch(/^Set up your AI in Settings to start: .*Here, Settings are the environment the command runs in/);
    expect(ran.err).not.toContain('missing.png');
    const revise = await cli(['revise', 'missing.repx', '--words', 'Make it red', '--json', '--mock'], { cwd: dir, env: { FORMA_PROVIDER: 'gemini' }, hooks: never });
    expect(revise.code).toBe(EXIT.noAi);
    expect(revise.json()).toEqual([expect.objectContaining({ type: 'summary', command: 'revise', inputs: 0, exitCode: 3, message: expect.stringMatching(/needs FORMA_GEMINI_KEY/) })]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('generates with the mock (an AI still set up), from a description and from a report to start from, the JSON line naming the provider, model and limit', async () => {
    const dir = folder();
    const made = await cli(['generate', '--mock', '--description', DESCRIPTION, '--out', 'invoice.repx', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(made.code).toBe(EXIT.done);
    const [line, summary] = made.json();
    expect(line).toMatchObject({ type: 'input', command: 'generate', input: 'the description', status: 'done', provider: 'mock', model: null, fixModel: null, limit: null, standIn: null, written: { path: join(dir, 'invoice.repx'), status: 'written' } });
    expect(Object.keys(line)).not.toContain('config');
    expect(summary).toMatchObject({ type: 'summary', done: 1, exitCode: 0 });
    expect(made.err).toContain("Making Forma's draft.");
    put(dir, 'start.repx', INVOICE());
    const fromReport = await cli(['generate', 'start.repx', '--mock', '--description', 'Make this an invoice with items'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(fromReport.code).toBe(EXIT.done);
    expect(fromReport.lines[0]).toMatch(/^Wrote ".*start\.generated\.repx"\. Made by the mock invoice \(--mock\), with no AI asked\. The report has /);
  });

  it('refuses before asking the AI when the output is already there, at no cost in quota, and replaces it with --force', async () => {
    const dir = folder();
    put(dir, 'invoice.repx', 'mine');
    const ran = await cli(['generate', '--description', DESCRIPTION, '--out', 'invoice.repx'], { cwd: dir, env: GEMINI, hooks: never });
    expect(ran.code).toBe(EXIT.failed);
    expect(ran.err).toMatch(/is already there, so the AI was not asked and nothing was written; give --force to replace it/);
    expect(readFileSync(join(dir, 'invoice.repx'), 'utf8')).toBe('mine');
    const forced = await cli(['generate', '--mock', '--force', '--description', DESCRIPTION, '--out', 'invoice.repx'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(forced.code).toBe(EXIT.done);
    expect(forced.lines[0]).toMatch(/^Replaced /);
  });

  it('never writes over a report whose stored login it took out, --force or not, nor over a file a report is made from (SEC-W4-2)', async () => {
    const dir = folder();
    put(dir, 'orders.repx', WITH_LOGIN);
    const overLogin = `"${join(dir, 'orders.repx')}" kept a database login, which Forma removes before reading a report, so writing over it would take that out of your file. Name another file with --out to write a new one.`;
    const repaired = await cli(['repair', 'orders.repx', '--out', 'orders.repx', '--force', '--json'], { cwd: dir });
    expect(repaired.code).toBe(EXIT.failed);
    expect(repaired.json()[0]).toMatchObject({ status: 'refused', message: overLogin });
    // Never the notice that says the file named is unchanged, for a run that would have replaced it.
    expect(repaired.out + repaired.err).not.toContain('the file you named is unchanged');
    // A revise in place meets the same rule once its change is made: nothing written.
    const revised = await cli(['revise', 'orders.repx', '--mock', '--words', 'Make the title bold', '--out', 'orders.repx', '--force'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(revised.code).toBe(EXIT.failed);
    expect(revised.err).toContain(overLogin);
    // A generate over a file it is made from is refused before the AI is asked.
    const generated = await cli(['generate', 'orders.repx', '--description', DESCRIPTION, '--out', 'orders.repx', '--force'], { cwd: dir, env: GEMINI, hooks: never });
    expect(generated.code).toBe(EXIT.failed);
    expect(generated.err).toBe(`"${join(dir, 'orders.repx')}" is one of the files the report is made from, which Forma never writes over; name another file with --out.`);
    expect(readFileSync(join(dir, 'orders.repx'), 'utf8')).toBe(WITH_LOGIN);
    expect(readdirSync(dir)).toEqual(['orders.repx']);
    // A report with nothing taken out of it is repaired in place when the person says so.
    put(dir, 'plain.repx', INVOICE());
    const inPlace = await cli(['repair', 'plain.repx', '--out', 'plain.repx', '--force'], { cwd: dir });
    expect(inPlace.code).toBe(EXIT.done);
    expect(inPlace.lines[0]).toMatch(/^(Replaced|Found the same file already at) ".*plain\.repx"/);
  });

  it('writes nothing when every AI fails (exit 4), stops at a limit (exit 5) saying which, and writes Forma\'s draft apart only with --allow-stand-in', async () => {
    const dir = folder();
    const failed = await cli(['generate', '--description', DESCRIPTION, '--out', 'a.repx'], { cwd: dir, env: GEMINI, hooks: failing(() => new Error(`API key not valid: ${geminiKey} and ${shapelessKey}`)) });
    expect(failed.code).toBe(EXIT.failed);
    expect(failed.err).toMatch(/^Starting\.\n[\s\S]*No report was made: .* Nothing was written\.$/);
    const limited = await cli(['generate', '--description', DESCRIPTION, '--out', 'b.repx', '--json'], { cwd: dir, env: LIMITED, hooks: failing(dayLimit) });
    expect(limited.code).toBe(EXIT.limit);
    expect(limited.json()[0]).toMatchObject({ status: 'limit', exitCode: 5, limit: { kind: 'daily', provider: 'gemini' } });
    expect(limited.err).toMatch(/Gemini reached its daily limit, which lifts in about \d+ (hours?|minutes?)\.$/);
    const drafted = await cli(['generate', '--description', DESCRIPTION, '--out', 'c.repx', '--allow-stand-in', '--json'], { cwd: dir, env: LIMITED, hooks: failing(dayLimit) });
    // Forma's draft is written, apart, and is never taken for the report asked for: status draft, exit 4 (CLI-4, U2).
    expect(drafted.code).toBe(EXIT.failed);
    expect(drafted.json()[0]).toMatchObject({ status: 'draft', exitCode: 4, standIn: 'offline', provider: null, written: { path: join(dir, 'c.draft.repx'), status: 'written' }, limit: { kind: 'daily' } });
    expect(drafted.json()[1]).toMatchObject({ type: 'summary', draft: 1, done: 0, exitCode: 4 });
    expect(drafted.err).toContain("so Forma's own draft stands in");
    expect(readdirSync(dir).sort()).toEqual(['c.draft.repx']);
    // The keys are never printed, by their shape or, for the shapeless one, by their value.
    for (const ran of [failed, limited, drafted]) for (const key of [geminiKey, shapelessKey, limitKey]) expect(ran.out + ran.err).not.toContain(key.slice(0, 12));
    expect(failed.err).toContain('(a key)');
  });

  it("names the model that answered under --verbose, and the limit that kept the print check's fix from being asked", async () => {
    const dir = folder();
    // The first answer prints past the margin, so the print check asks for a fix, which meets a minute's limit.
    const clipped = [{ severity: 'error', code: 'clipped-at-margin', message: 'A label runs past the right margin.' }];
    let asked = 0;
    const hooks: GenHooks = {
      ask: async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
        asked += 1;
        if (asked > 1) throw minuteLimit();
        return { ...mockAnswer('true', previous, options), model: 'gemini-test-001', printFindings: clipped } as never;
      },
    };
    const ran = await cli(['generate', '--description', DESCRIPTION, '--out', 'inv.repx', '--verbose'], { cwd: dir, env: LIMITED, hooks });
    expect(ran.code).toBe(EXIT.done);
    expect(ran.lines[0]).toMatch(/^Wrote ".*inv\.repx"\. Made by Gemini\. The report has .*; printing it found 1 problem\.$/);
    expect(ran.out).toContain('The model that answered: gemini-test-001.');
    expect(ran.err).toContain('Gemini reached its per-minute limit, which lifts in about 41 seconds. The report written is the one before the step it kept from being asked.');
    // Without --verbose the plain line names the provider and never the model.
    const plain = await cli(['generate', '--description', DESCRIPTION, '--out', 'inv2.repx'], {
      cwd: dir,
      env: GEMINI,
      hooks: { ask: async (_p, _parts, _c, previous, _s, _o, options) => ({ ...mockAnswer('true', previous, options), model: 'gemini-test-001' }) as never },
    });
    expect(plain.code).toBe(EXIT.done);
    expect(plain.out + plain.err).not.toContain('gemini-test-001');
  });

  it('revises with the mock: an edit written to <name>.revised.repx, a question answered with nothing written, a different report declined (exit 4)', async () => {
    const dir = folder();
    put(dir, 'inv.repx', INVOICE());
    const edited = await cli(['revise', 'inv.repx', '--mock', '--words', 'Make the title bold'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(edited.code).toBe(EXIT.done);
    expect(edited.lines[0]).toMatch(/^Wrote ".*inv\.revised\.repx"\. 1 edit made by the mock invoice \(--mock\), with no AI asked\. The result has /);
    const answered = await cli(['revise', 'inv.repx', '--mock', '--words', 'Export it as PDF', '--out', 'never.repx'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(answered.code).toBe(EXIT.done);
    expect(answered.lines[0]).toMatch(/^Answered about ".*inv\.repx" by the mock invoice \(--mock\), with no AI asked; nothing was written\. The answer:$/);
    expect(answered.err).toContain('the pdf command draws a draft PDF');
    const other: GenHooks = { chat: async () => ({ reply: 'That is a different report.', wantsReport: false, action: 'new', brief: 'A payslip with deductions' }) as ChatOutcome };
    const declined = await cli(['revise', 'inv.repx', '--words', 'Make me a payslip instead', '--out', 'never.repx'], { cwd: dir, env: GEMINI, hooks: other });
    expect(declined.code).toBe(EXIT.failed);
    expect(declined.out).toContain('run generate with what it asks for:');
    expect(declined.out).toContain('asks for: A payslip with deductions');
    expect(existsSync(join(dir, 'never.repx'))).toBe(false);
    // With its output already there: a change is refused at the write (exit 4, the file kept), a question still answered.
    put(dir, 'taken.repx', INVOICE());
    put(dir, 'taken.revised.repx', 'mine');
    const taken = await cli(['revise', 'taken.repx', '--mock', '--words', 'Make the title bold', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(taken.code).toBe(EXIT.failed);
    expect(taken.json()[0]).toMatchObject({ status: 'exists', written: { status: 'exists' } });
    expect(readFileSync(join(dir, 'taken.revised.repx'), 'utf8')).toBe('mine');
    const asked = await cli(['revise', 'taken.repx', '--mock', '--words', 'Export it as PDF'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(asked.code).toBe(EXIT.done);
  });

  it('declines a redesign under --edits-only, writing nothing (exit 4), where without it the report is redesigned', async () => {
    const dir = folder();
    put(dir, 'inv.repx', INVOICE());
    const rebuild: GenHooks = {
      chat: async () => ({ reply: 'I will redesign it.', wantsReport: true, action: 'rebuild', brief: 'A modern invoice' }) as ChatOutcome,
      ask: async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => mockAnswer('true', previous, options),
    };
    const declined = await cli(['revise', 'inv.repx', '--words', 'Redesign it', '--edits-only', '--json'], { cwd: dir, env: GEMINI, hooks: rebuild });
    expect(declined.code).toBe(EXIT.failed);
    expect(declined.json()[0]).toMatchObject({ status: 'declined', action: 'rebuild', written: null });
    expect(declined.json()[0].notices).toContain('The request asks for a redesign of the whole report, which --edits-only declines, so nothing was written.');
    // An edit that cannot be made in place is declined the same way, never redesigned.
    const inPlace: GenHooks = { chat: async () => ({ reply: 'Done.', wantsReport: false, action: 'edit', edits: [{ op: 'text', control: 'nope', text: 'X' }] }) as ChatOutcome };
    const notMade = await cli(['revise', 'inv.repx', '--words', 'Retitle it', '--edits-only', '--json'], { cwd: dir, env: GEMINI, hooks: inPlace });
    expect(notMade.json()[0]).toMatchObject({ status: 'declined', action: 'rebuild', written: null });
    expect(notMade.json()[0].notices).toContain('That could not be changed in place, and --edits-only declines a redesign, so nothing was written.');
    expect(readdirSync(dir)).toEqual(['inv.repx']);
    const redesigned = await cli(['revise', 'inv.repx', '--words', 'Redesign it'], { cwd: dir, env: GEMINI, hooks: rebuild });
    expect(redesigned.code).toBe(EXIT.done);
    expect(redesigned.lines[0]).toMatch(/^Wrote ".*inv\.revised\.repx"\. The report was redesigned by Gemini\. /);
  });

  it('stops an AI run under way through its signal: the thread ended, nothing written, exit 130', async () => {
    const dir = folder();
    const stop = new AbortController();
    const hooks: GenHooks = {
      ask: async (_prompt, _parts, _config, _previous, signal) => {
        stop.abort();
        await new Promise((done) => setTimeout(done, 20));
        throw Object.assign(new Error(signal?.aborted ? 'The operation was aborted.' : 'not stopped'), { name: 'AbortError' });
      },
    };
    const ran = await cli(['generate', '--description', DESCRIPTION, '--out', 'x.repx', '--json'], { cwd: dir, env: GEMINI, signal: stop.signal, hooks });
    expect(ran.code).toBe(EXIT.interrupted);
    expect(ran.json()[0]).toMatchObject({ status: 'stopped', exitCode: 130 });
    expect(readdirSync(dir)).toEqual([]);
  });
});

/** A made-up SSRS report (RDL 2005): a table of people, one formula the converter prints as written. */
const RDL = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition">
  <Body>
    <ReportItems>
      <Table Name="People">
        <TableColumns><TableColumn><Width>2in</Width></TableColumn><TableColumn><Width>1in</Width></TableColumn></TableColumns>
        <Header><TableRows><TableRow><Height>0.25in</Height><TableCells>
          <TableCell><ReportItems><Textbox Name="h1"><Value>Name</Value></Textbox></ReportItems></TableCell>
          <TableCell><ReportItems><Textbox Name="h2"><Value>Age</Value></Textbox></ReportItems></TableCell>
        </TableCells></TableRow></TableRows></Header>
        <Details><TableRows><TableRow><Height>0.2in</Height><TableCells>
          <TableCell><ReportItems><Textbox Name="d1"><Value>=Fields!Name.Value</Value></Textbox></ReportItems></TableCell>
          <TableCell><ReportItems><Textbox Name="d2"><Value>=Code.Age(Fields!Age.Value)</Value></Textbox></ReportItems></TableCell>
        </TableCells></TableRow></TableRows></Details>
        <Top>0in</Top><Left>0in</Left>
      </Table>
    </ReportItems>
    <Height>1in</Height>
  </Body>
  <PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth>
  <LeftMargin>1in</LeftMargin><RightMargin>1in</RightMargin><TopMargin>1in</TopMargin><BottomMargin>1in</BottomMargin>
</Report>`;
/** A made-up FastReport report in the demos' form. */
const FRX = `<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp" ReportInfo.Name="Products">
  <ReportPage Name="Page1" PaperWidth="210" PaperHeight="297" LeftMargin="10" RightMargin="10" TopMargin="10" BottomMargin="10">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Text1" Width="718.2" Height="28.35" Text="PRODUCT LIST" HorzAlign="Center" Font="Tahoma, 14pt, style=Bold"/>
    </ReportTitleBand>
    <DataBand Name="Data1" Top="41.8" Width="718.2" Height="18.9">
      <TextObject Name="Text2" Width="300" Height="18.9" Text="[Products.ProductName]"/>
    </DataBand>
  </ReportPage>
</Report>`;

/** A one-page PDF with a text layer, Helvetica named and not embedded, as pdf.js draws it from its own standard fonts. */
function textPdf(text: string): Buffer {
  const content = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A picture of a page title, drawn here. */
function titlePng(text: string): Buffer {
  const canvas = createCanvas(640, 240);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 640, 240);
  ctx.fillStyle = '#000000';
  ctx.font = '48px sans-serif';
  ctx.fillText(text, 40, 120);
  return canvas.toBuffer('image/png');
}

/** Every file under a folder, relative to it, sorted, with '/' between folders on every system. */
const under = (dir: string) => (existsSync(dir) ? filesUnder(dir).map((f) => f.split(sep).join('/')).sort() : []);

describe('convert, which needs no AI', () => {
  it('makes an SSRS or FastReport report, and every one directly in a folder, into <name>.converted.repx, saying the version and the converter\'s notices', async () => {
    const dir = folder();
    put(dir, 'people.rdl', `\u{feff}${RDL}`);
    put(dir, join('more', 'products.frx'), FRX);
    put(dir, join('more', 'people.rdlc'), RDL);
    put(dir, join('more', 'notes.txt'), 'not a report');
    const one = await cli(['convert', 'people.rdl'], { cwd: dir });
    expect(one.code).toBe(EXIT.done);
    expect(one.lines[0]).toMatch(/^Wrote ".*people\.converted\.repx"\. Converted from SSRS with no AI, written as DevExpress 20\.1 writes a report, which later versions open\. The result has /);
    expect(one.err).toContain('"people.rdl": one formula prints as written, because DevExpress has no direct equivalent; check it in the report.');
    expect(readFileSync(join(dir, 'people.converted.repx'), 'utf8')).toContain('SerializerVersion="20.1.3.0"');
    const json = await cli(['convert', 'more', '--json'], { cwd: dir });
    expect(json.code).toBe(EXIT.done);
    const [rdlc, frx, summary] = json.json();
    expect(rdlc).toMatchObject({ type: 'input', command: 'convert', status: 'done', from: 'SSRS', version: '20.1', written: { path: join(dir, 'more', 'people.converted.repx'), status: 'written' } });
    expect(frx).toMatchObject({ status: 'done', from: 'FastReport', written: { path: join(dir, 'more', 'products.converted.repx') } });
    expect(summary).toMatchObject({ type: 'summary', command: 'convert', inputs: 2, done: 2, exitCode: 0 });
    // Deterministic: the same bytes the next time, so nothing changes; other content there is refused (4), replaced with --force.
    expect((await cli(['convert', 'people.rdl'], { cwd: dir })).lines[0]).toMatch(/^Found the same file already at /);
    writeFileSync(join(dir, 'people.converted.repx'), 'mine');
    expect((await cli(['convert', 'people.rdl'], { cwd: dir })).code).toBe(EXIT.failed);
    expect(readFileSync(join(dir, 'people.converted.repx'), 'utf8')).toBe('mine');
    expect((await cli(['convert', 'people.rdl', '--force'], { cwd: dir })).code).toBe(EXIT.done);
    // Into a folder --out names; and one file named for several reports is a usage error.
    expect((await cli(['convert', 'more', '--out', `converted${sep}`], { cwd: dir })).code).toBe(EXIT.done);
    expect(under(join(dir, 'converted'))).toEqual(['people.converted.repx', 'products.converted.repx']);
    const oneName = await cli(['convert', 'more', '--out', 'x.repx'], { cwd: dir });
    expect(oneName.code).toBe(EXIT.usage);
    expect(oneName.err).toMatch(/^--out names one file, but 2 reports are converted/);
  });

  it('fails a file that will not convert, writing nothing and naming generate for an SSRS one; refuses one that is not XML, and a folder with none', async () => {
    const dir = folder();
    put(dir, 'bare.rdl', '<Report/>');
    put(dir, 'bare.frx', '<NotAReport/>');
    put(dir, 'broken.rdl', '<Report><Body>');
    mkdirSync(join(dir, 'empty'));
    const ran = await cli(['convert', 'bare.rdl', 'bare.frx', 'broken.rdl', 'empty', '--json'], { cwd: dir });
    expect(ran.code).toBe(EXIT.failed);
    const lines = ran.json();
    expect(lines.map((l) => l.status)).toEqual(['refused', 'failed', 'failed', 'refused', undefined]);
    expect(lines[0].message).toMatch(/holds no SSRS or FastReport report \(\.rdl, \.rdlc or \.frx\) directly in it, so nothing was converted\.$/);
    expect(lines[1].message).toMatch(/^"bare\.rdl" could not be converted: .*the generate command can make a report from its text with the AI\. Nothing was written\.$/);
    expect(lines[2].message).not.toMatch(/generate/);
    expect(lines[3].message).toMatch(/is not well-formed XML/);
    expect(readdirSync(dir).sort()).toEqual(['bare.frx', 'bare.rdl', 'broken.rdl', 'empty']);
  });
});

describe('batch: a folder, one file at a time', () => {
  /** A folder of every kind a batch meets: pictures and a PDF with one stem, SSRS and FastReport reports, a report, a data file, a Crystal file, a dot-folder, node_modules, a last run's output, and a junction (a directory link off Windows) out of it. */
  function mixed(): { dir: string; outside: string } {
    const dir = folder();
    put(dir, join('in', 'a.pdf'), '');
    writeFileSync(join(dir, 'in', 'a.pdf'), textPdf('INVOICE 1001'));
    writeFileSync(join(dir, 'in', 'a.png'), titlePng('INVOICE'));
    put(dir, join('in', 'sub', 'sales.rdl'), RDL);
    put(dir, join('in', 'sub', 'products.frx'), FRX);
    put(dir, join('in', 'r.repx'), INVOICE());
    put(dir, join('in', 'data.csv'), 'Name,Age\nAda,36\n');
    put(dir, join('in', 'c.rpt'), 'binary');
    put(dir, join('in', '.hidden', 'x.png'), 'never');
    put(dir, join('in', 'node_modules', 'y.png'), 'never');
    put(dir, join('in', 'old.generated.repx'), INVOICE());
    const outside = folder();
    writeFileSync(join(outside, 'secret.png'), titlePng('SECRET'));
    symlinkSync(outside, join(dir, 'in', 'away'), process.platform === 'win32' ? 'junction' : 'dir');
    return { dir, outside };
  }

  it("routes every file by its kind and writes each under --out, its subfolder kept, one stem's two files keeping their extensions; never a link, a dot-folder, a data file or a last run's output", { timeout: 120_000 }, async () => {
    const { dir } = mixed();
    const ran = await cli(['batch', 'in', '--out', 'out', '--mock', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(ran.code, ran.err).toBe(EXIT.done);
    const lines = ran.json();
    const rows = lines.filter((l) => l.type === 'input');
    expect(rows.map((r) => [r.input, r.route, r.status])).toEqual([
      [join('in', 'a.pdf'), 'generate', 'done'],
      [join('in', 'a.png'), 'generate', 'done'],
      [join('in', 'c.rpt'), 'skip', 'skipped'],
      [join('in', 'r.repx'), 'skip', 'skipped'],
      [join('in', 'sub', 'products.frx'), 'convert', 'done'],
      [join('in', 'sub', 'sales.rdl'), 'convert', 'done'],
    ]);
    expect(rows[0]).toMatchObject({ output: join(dir, 'out', 'a.pdf.generated.repx'), provider: 'mock', written: { status: 'written' } });
    expect(rows[3].message).toMatch(/is a report, and nothing was asked of it: give --words to change it, or --repair to repair it/);
    const summary = lines.at(-1) as Record<string, any>;
    expect(summary).toMatchObject({
      type: 'summary',
      command: 'batch',
      inputs: 6,
      done: 4,
      skipped: 2,
      notStarted: 0,
      exitCode: 0,
      routes: { generate: 2, skip: 2, convert: 2 },
      providers: { mock: 2 },
      stoppedBy: null,
      resetsAt: null,
      limits: { ai: { minutes: 15, heapMb: 2048 }, layout: { seconds: 30, heapMb: 512 } },
      leftOut: { links: 1, outputs: 1, deep: 0, unreadable: 0 },
    });
    expect(summary.leftOut.other).toBeGreaterThanOrEqual(1);
    expect(under(join(dir, 'out'))).toEqual(['a.pdf.generated.repx', 'a.png.generated.repx', 'sub/products.converted.repx', 'sub/sales.converted.repx']);
    expect(ran.err).toContain('Left out 1 link (a batch follows no link or junction), 1 file named as Forma\'s own outputs.');
    expect(ran.err).toContain('Making 4 files of "in" one at a time: 2 to generate, 2 to convert. Each that asks the AI runs in a thread of its own, with at most 15 minutes and 2048 MB of memory.');
    // Numbered among the 4 files the batch makes, never the 6 it lists (U12).
    expect(ran.err).toContain(`[1/4] generate "${join('in', 'a.pdf')}"`);
    expect(ran.err).toContain(`[4/4] convert "${join('in', 'sub', 'sales.rdl')}"`);
    expect(ran.out + ran.err).not.toMatch(/secret/i);
    // Plain, the summary names who answered, the time and the bounds each file had.
    const again = await cli(['batch', 'in', '--out', 'out2', '--mock'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(again.code).toBe(EXIT.done);
    expect(again.lines.slice(-3)).toEqual([
      '6 inputs: 4 done, 2 skipped.',
      'Answered by: the mock invoice (2 files).',
      expect.stringMatching(/^Took about \d+ seconds?; each file that asked the AI ran in a thread of its own, with at most 15 minutes and 2048 MB of memory\.$/),
    ]);
    // When no file asked the AI, the threads are not said (U12).
    const made = await cli(['batch', 'in', '--out', 'out2', '--mock', '--skip-existing'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: NEVER_ASKED });
    expect(made.code).toBe(EXIT.done);
    expect(made.lines.at(-1)).toMatch(/^Took about \d+ seconds?\.$/);
  });

  it('prints the plan under --dry-run, which files need the AI and what each would be written as, reading nothing and asking no AI, with none set up', async () => {
    const { dir } = mixed();
    const ran = await cli(['batch', 'in', '--out', 'out', '--dry-run', '--json', '--repair'], { cwd: dir, hooks: NEVER_ASKED });
    expect(ran.code).toBe(EXIT.done);
    const lines = ran.json();
    expect(lines.slice(0, -1).map((l) => [l.type, l.input, l.route, l.needsAi])).toEqual([
      ['plan', join('in', 'a.pdf'), 'generate', true],
      ['plan', join('in', 'a.png'), 'generate', true],
      ['plan', join('in', 'c.rpt'), 'skip', false],
      ['plan', join('in', 'r.repx'), 'repair', false],
      ['plan', join('in', 'sub', 'products.frx'), 'convert', false],
      ['plan', join('in', 'sub', 'sales.rdl'), 'convert', false],
    ]);
    expect(lines[3]).toMatchObject({ output: join(dir, 'out', 'r.repaired.repx'), already: false });
    expect(lines.at(-1)).toMatchObject({ type: 'summary', dryRun: true, inputs: 6, needAi: 2, routes: { generate: 2, skip: 1, repair: 1, convert: 2 }, exitCode: 0 });
    expect(existsSync(join(dir, 'out'))).toBe(false);
    const plain = await cli(['batch', 'in', '--out', 'out', '--dry-run'], { cwd: dir });
    expect(plain.lines.at(-1)).toBe('6 inputs: 2 to generate, 2 to skip, 2 to convert; 2 files would ask the AI. Nothing was read, and no AI was asked.');
    expect(plain.out).toContain(`"${join('in', 'a.pdf')}": generate (AI) -> "${join(dir, 'out', 'a.pdf.generated.repx')}"`);
  });

  it('asks for the AI only when a route needs one: SSRS and FastReport reports convert with none set up, a picture exits 3 before any file is read', async () => {
    const dir = folder();
    put(dir, join('ssrs', 'people.rdl'), RDL);
    put(dir, join('ssrs', 'products.frx'), FRX);
    const converted = await cli(['batch', 'ssrs', '--out', 'out'], { cwd: dir, hooks: NEVER_ASKED });
    expect(converted.code).toBe(EXIT.done);
    expect(under(join(dir, 'out'))).toEqual(['people.converted.repx', 'products.converted.repx']);
    put(dir, join('ssrs', 'scan.png'), 'not even read');
    const gated = await cli(['batch', 'ssrs', '--out', 'out2', '--json'], { cwd: dir, hooks: NEVER_ASKED });
    expect(gated.code).toBe(EXIT.noAi);
    expect(gated.err).toMatch(/^Set up your AI in Settings to start: /);
    expect(gated.json()).toEqual([expect.objectContaining({ type: 'summary', command: 'batch', inputs: 0, exitCode: 3 })]);
    expect(existsSync(join(dir, 'out2'))).toBe(false);
  });

  it("refuses what it has made already at no cost in quota (exit 4), skips it with --skip-existing (counted as skipped, not done), and never takes its own outputs back when --out is the folder itself", async () => {
    const dir = folder();
    put(dir, join('in', 'people.rdl'), RDL);
    put(dir, join('in', 'more', 'products.frx'), FRX);
    expect((await cli(['batch', 'in', '--out', 'in'], { cwd: dir })).code).toBe(EXIT.done);
    expect(under(join(dir, 'in'))).toEqual(['more/products.converted.repx', 'more/products.frx', 'people.converted.repx', 'people.rdl']);
    writeFileSync(join(dir, 'in', 'people.converted.repx'), 'kept by the person');
    const refused = await cli(['batch', 'in', '--out', 'in', '--json'], { cwd: dir });
    expect(refused.code).toBe(EXIT.failed);
    expect(refused.json().filter((l) => l.type === 'input').map((l) => l.status)).toEqual(['exists', 'exists']);
    expect(refused.json()[0].message).toMatch(/is already there, so ".*" was not made again; give --skip-existing to carry on past what is made, or --force to make it again\.$/);
    const resumed = await cli(['batch', 'in', '--out', 'in', '--skip-existing', '--json'], { cwd: dir });
    expect(resumed.code).toBe(EXIT.done);
    expect(resumed.json().at(-1)).toMatchObject({ inputs: 2, done: 0, skipped: 2, exitCode: 0, leftOut: { outputs: 2 } });
    expect(readFileSync(join(dir, 'in', 'people.converted.repx'), 'utf8')).toBe('kept by the person');
    const forced = await cli(['batch', 'in', '--out', 'in', '--force'], { cwd: dir });
    expect(forced.code).toBe(EXIT.done);
    expect(readFileSync(join(dir, 'in', 'people.converted.repx'), 'utf8')).toContain('XtraReportsLayoutSerializer');
    // A generate's report already there is refused before the AI is asked.
    put(dir, join('pics', 'a.pdf'), '');
    writeFileSync(join(dir, 'pics', 'a.pdf'), textPdf('A'));
    put(dir, join('made', 'a.generated.repx'), 'mine');
    const before = await cli(['batch', 'pics', '--out', 'made'], { cwd: dir, env: GEMINI, hooks: NEVER_ASKED });
    expect(before.code).toBe(EXIT.failed);
    expect(readFileSync(join(dir, 'made', 'a.generated.repx'), 'utf8')).toBe('mine');
  });

  it('revises each report with --words (an SSRS one converted first), declines a redesign under --edits-only, repairs with --repair, and fails a FastReport file that will not convert', { timeout: 60_000 }, async () => {
    const dir = folder();
    put(dir, join('in', 'inv.repx'), INVOICE());
    put(dir, join('in', 'people.rdl'), RDL);
    put(dir, join('in', 'bare.frx'), '<NotAReport/>');
    const landscape: GenHooks = { chat: async () => ({ reply: 'Turned it.', wantsReport: false, action: 'edit', edits: [{ op: 'paper', landscape: true }] }) as ChatOutcome };
    const ran = await cli(['batch', 'in', '--out', 'out', '--words', 'Make it landscape', '--json'], { cwd: dir, env: GEMINI, hooks: landscape });
    expect(ran.code).toBe(EXIT.failed);
    const rows = ran.json().filter((l) => l.type === 'input');
    expect(rows.map((r) => [r.route, r.status])).toEqual([
      ['convert-revise', 'failed'],
      ['revise', 'done'],
      ['convert-revise', 'done'],
    ]);
    expect(rows[0].message).toMatch(/^"in.{1,2}bare\.frx" could not be converted: Forma reads SSRS reports from RDL 2005 to 2016 and FastReport's \.frx\. Nothing was written\.$/);
    expect(rows[1]).toMatchObject({ provider: 'gemini', applied: 1, written: { path: join(dir, 'out', 'inv.revised.repx') } });
    expect(rows[2]).toMatchObject({ applied: 1, notices: expect.arrayContaining(['Converted from SSRS with no AI, written as DevExpress 20.1 writes a report, which later versions open, then revised.']) });
    expect(readFileSync(join(dir, 'out', 'people.revised.repx'), 'utf8')).toMatch(/Landscape="true"/);
    const rebuild: GenHooks = { chat: async () => ({ reply: 'I will redesign it.', wantsReport: true, action: 'rebuild', brief: 'A modern invoice' }) as ChatOutcome };
    const declined = await cli(['batch', 'in', '--out', 'declined', '--words', 'Redesign it', '--edits-only', '--json'], { cwd: dir, env: GEMINI, hooks: rebuild });
    expect(declined.json().filter((l) => l.type === 'input').map((l) => [l.input, l.status])).toEqual([
      [join('in', 'bare.frx'), 'failed'],
      [join('in', 'inv.repx'), 'declined'],
      [join('in', 'people.rdl'), 'declined'],
    ]);
    expect(under(join(dir, 'declined'))).toEqual([]);
    const repaired = await cli(['batch', 'in', '--out', 'repaired', '--repair'], { cwd: dir, hooks: NEVER_ASKED });
    expect(repaired.code).toBe(EXIT.failed);
    expect(under(join(dir, 'repaired'))).toEqual(['inv.repaired.repx', 'people.converted.repx']);
  });

  it("waits a minute's limit out and makes the file once more, then stops at the day's limit: the rest not started, exit 5, the same command with --skip-existing to carry on", async () => {
    const dir = folder();
    for (const name of ['r1', 'r2', 'r3']) put(dir, join('in', `${name}.repx`), INVOICE());
    const minute = classifyGeminiError(Object.assign(new Error(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }] } })), { status: 429 }));
    const day = classifyGeminiError(Object.assign(new Error(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } })), { status: 429 }));
    let asked = 0;
    const hooks: GenHooks = {
      chat: async () => {
        asked += 1;
        if (asked === 1) throw minute;
        if (asked === 3) throw day;
        return { reply: 'It lists the items.', wantsReport: false, action: 'answer' } as ChatOutcome;
      },
    };
    const waits: number[] = [];
    const ran = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold', '--json'], { cwd: dir, env: LIMITED, hooks, waits });
    expect(ran.code, ran.err).toBe(EXIT.limit);
    expect(asked).toBe(3);
    expect(waits).toEqual([42_000]);
    const lines = ran.json();
    // The file the stop left is listed, a line of its own, with its route, its name and the limit's exit (OC5, U4).
    expect(lines.filter((l) => l.type === 'input').map((l) => [l.input, l.status, l.exitCode])).toEqual([
      [join('in', 'r1.repx'), 'done', 0],
      [join('in', 'r2.repx'), 'limit', 5],
      [join('in', 'r3.repx'), 'notStarted', 5],
    ]);
    expect(lines.at(-2)).toMatchObject({ route: 'revise', output: join(dir, 'out', 'r3.revised.repx'), message: `"${join('in', 'r3.repx')}" was not started: the batch stopped asking the AI when it met its limit.` });
    expect(lines.at(-1)).toMatchObject({ type: 'summary', inputs: 3, done: 1, limit: 1, notStarted: 1, exitCode: 5, stoppedBy: 'daily-limit', resetsAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    expect(ran.err).toContain(`Gemini reached its per-minute limit, which lifts in about 41 seconds. Waiting about 42 seconds, then making "${join('in', 'r1.repx')}" once more.`);
    expect(ran.err).toMatch(/The batch stopped asking the AI at its limit; each file after this one that asks it is listed as not started, and any that need no AI are still made\. Once it lifts, in about \d+ (hours?|minutes?), run the same command with --skip-existing to carry on\./);
    // Plain, the file left is named on stderr, and the time it lifts is said in words and the clock's UTC time, never an instant (U12).
    asked = 2;
    const plain = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold', '--skip-existing'], { cwd: dir, env: LIMITED, hooks, waits: [] });
    expect(plain.code).toBe(EXIT.limit);
    expect(plain.err).toContain(`"${join('in', 'r3.repx')}" was not started: the batch stopped asking the AI when it met its limit.`);
    expect(plain.out).toMatch(/Stopped at an AI limit, which lifts in about \d+ (hours?|minutes?) \(\d\d:\d\d UTC\); the same command with --skip-existing carries on\./);
    expect(plain.out).not.toMatch(/\d{4}-\d\d-\d\dT/);
  });

  it("stops a second limit on one file, and the AI refusing the key, before the next file, saying why; a Ctrl+C stops the file under way and writes nothing", async () => {
    const dir = folder();
    for (const name of ['r1', 'r2']) put(dir, join('in', `${name}.repx`), INVOICE());
    const minute = () => classifyGeminiError(Object.assign(new Error(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' }] } })), { status: 429 }));
    const twice = await cli(['batch', 'in', '--out', 'out', '--words', 'Bold title', '--json'], {
      cwd: dir,
      env: LIMITED,
      hooks: {
        chat: async () => {
          throw minute();
        },
      },
      waits: [],
    });
    expect(twice.code).toBe(EXIT.limit);
    expect(twice.json().at(-1)).toMatchObject({ limit: 1, notStarted: 1, stoppedBy: 'limit' });
    const key = await cli(['batch', 'in', '--out', 'out', '--words', 'Bold title', '--json'], {
      cwd: dir,
      env: GEMINI,
      hooks: {
        chat: async () => {
          throw new Error(`API key not valid. Please pass a valid API key: ${geminiKey}`);
        },
      },
    });
    expect(key.code).toBe(EXIT.failed);
    expect(key.json().at(-1)).toMatchObject({ failed: 1, notStarted: 1, stoppedBy: 'key' });
    // The file the key's refusal left is listed with the key's exit, 4, never the limit's.
    expect(key.json().at(-2)).toMatchObject({ input: join('in', 'r2.repx'), status: 'notStarted', exitCode: 4 });
    expect(key.err).toContain('The AI refused the key, so every file after this one that asks it would fail the same way: the batch stopped asking it; each file after this one that asks it is listed as not started, and any that need no AI are still made.');
    expect(key.out + key.err).not.toContain(geminiKey.slice(0, 12));
    const stop = new AbortController();
    const stopped = await cli(['batch', 'in', '--out', 'out', '--words', 'Bold title', '--json'], {
      cwd: dir,
      env: GEMINI,
      signal: stop.signal,
      hooks: {
        chat: async () => {
          stop.abort();
          throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
        },
      },
    });
    expect(stopped.code).toBe(EXIT.interrupted);
    expect(stopped.json().at(-1)).toMatchObject({ stopped: 1, notStarted: 1, exitCode: 130, stoppedBy: 'interrupted' });
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it("reads the parks the threads before kept: a key spent for the day stops the batch before any request, and a minute's park is waited out first", async () => {
    const dir = folder();
    put(dir, join('in', 'r.repx'), INVOICE());
    const forma = join(dir, 'forma');
    mkdirSync(forma);
    const now = Date.now();
    // As Forma writes them (modelParks.test.ts holds the choice's form to modelCache.ts's own writer).
    const choice = JSON.stringify({ 'geminiModel:day': JSON.stringify({ tag: keyTag(limitKey), model: 'model-a', usable: ['model-a', 'model-b'], at: now }) });
    writeFileSync(join(forma, 'model-choice.json'), choice);
    const parks = (b: { kind: string; until: number }) => JSON.stringify({ [keyTag(limitKey)]: { 'model-a': { kind: 'daily', until: now + 5 * 3_600_000 }, 'model-b': b } });
    writeFileSync(join(forma, 'model-parks.json'), parks({ kind: 'daily', until: now + 4 * 3_600_000 }));
    const spent = await cli(['batch', 'in', '--out', 'out', '--words', 'Bold title', '--json'], { cwd: dir, env: LIMITED, hooks: NEVER_ASKED, userFolder: forma });
    expect(spent.code).toBe(EXIT.limit);
    expect(spent.json()).toEqual([
      expect.objectContaining({ type: 'input', input: join('in', 'r.repx'), status: 'notStarted', exitCode: 5 }),
      expect.objectContaining({ type: 'summary', inputs: 1, notStarted: 1, exitCode: 5, stoppedBy: 'daily-limit' }),
    ]);
    expect(spent.err).toContain('Gemini reached its daily limit, which lifts in about 4 hours. Every model the key can call is spent until then, so the batch stopped before asking again.');
    writeFileSync(join(forma, 'model-parks.json'), parks({ kind: 'per-minute', until: now + 30_000 }));
    const waits: number[] = [];
    const answer: GenHooks = { chat: async () => ({ reply: 'Fine.', wantsReport: false, action: 'answer' }) as ChatOutcome };
    const waited = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold'], { cwd: dir, env: LIMITED, hooks: answer, userFolder: forma, waits });
    expect(waited.code).toBe(EXIT.done);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(25_000);
    expect(waits[0]).toBeLessThanOrEqual(31_000);
    expect(waited.err).toMatch(/Gemini reached its per-minute limit, which lifts in about \d+ seconds\. Every model the key can call is resting until then, so the batch waits before /);
  });

  it("writes Forma's draft apart with --allow-stand-in when the day's limit is met, and stops the rest; refuses a folder past --max, and --out inside a dot-folder", { timeout: 60_000 }, async () => {
    const dir = folder();
    // Pictures: OCR's reading is Forma's draft of each (a PDF with a text layer is not read by OCR, so it has none to stand in).
    mkdirSync(join(dir, 'in'));
    for (const name of ['a', 'b']) writeFileSync(join(dir, 'in', `${name}.png`), titlePng(`REPORT ${name.toUpperCase()}`));
    // After the AI's stop, a file that needs no AI is still made.
    put(dir, join('in', 'z.rdl'), RDL);
    const dayLimit = () =>
      classifyGeminiError(Object.assign(new Error(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } })), { status: 429 }));
    const ran = await cli(['batch', 'in', '--out', 'out', '--allow-stand-in', '--json'], {
      cwd: dir,
      env: LIMITED,
      hooks: {
        ask: async () => {
          throw dayLimit();
        },
      },
    });
    expect(ran.code, ran.err).toBe(EXIT.limit);
    expect(ran.json()[0]).toMatchObject({ route: 'generate', status: 'draft', exitCode: 4, standIn: expect.any(String), written: { path: join(dir, 'out', 'a.draft.repx') }, limit: { kind: 'daily' } });
    expect(ran.json().filter((l) => l.type === 'input').map((l) => [l.route, l.input, l.status])).toEqual([
      ['generate', join('in', 'a.png'), 'draft'],
      ['generate', join('in', 'b.png'), 'notStarted'],
      ['convert', join('in', 'z.rdl'), 'done'],
    ]);
    expect(ran.json().at(-1)).toMatchObject({ inputs: 3, draft: 1, notStarted: 1, stoppedBy: 'daily-limit', exitCode: 5 });
    expect(under(join(dir, 'out'))).toEqual(['a.draft.repx', 'z.converted.repx']);
    const over = await cli(['batch', 'in', '--out', 'out', '--max', '1'], { cwd: dir });
    expect(over.code).toBe(EXIT.usage);
    expect(over.err).toMatch(/^"in" holds 3 files a batch makes, more than 1; give --max 3 to make them all, or a smaller folder\./);
    const dotted = await cli(['batch', 'in', '--out', '.out'], { cwd: dir });
    expect(dotted.code).toBe(EXIT.failed);
    expect(dotted.err).toMatch(/dot-folder/);
    expect(existsSync(join(dir, '.out'))).toBe(false);
    put(dir, 'afile', 'x');
    const aFile = await cli(['batch', 'in', '--out', 'afile'], { cwd: dir });
    expect(aFile.code).toBe(EXIT.failed);
    expect(aFile.err).toMatch(/is a file; --out names the folder the reports go in\.$/);
    const notAFolder = await cli(['batch', 'afile', '--out', 'out'], { cwd: dir });
    expect(notAFolder.code).toBe(EXIT.failed);
    expect(notAFolder.err).toMatch(/is not a folder\. batch takes a folder\.$/);
  });

  it("hands every picture and PDF the data files --data names, each read from the working folder as everywhere on the command line, and refuses one the rules refuse", { timeout: 60_000 }, async () => {
    const dir = folder();
    put(dir, join('in', 'a.pdf'), '');
    writeFileSync(join(dir, 'in', 'a.pdf'), textPdf('INVOICE 1001'));
    put(dir, 'items.csv', 'Item,Qty,Price\nPaper,2,3.50\n');
    put(dir, join('.private', 'items.csv'), 'Item\nx\n');
    const ran = await cli(['batch', 'in', '--out', 'out', '--data', 'items.csv', '--mock', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.json()[0]).toMatchObject({ route: 'generate', status: 'done', data: ['items.csv'], files: [join('in', 'a.pdf')] });
    const hidden = await cli(['batch', 'in', '--out', 'out2', '--data', join('.private', 'items.csv'), '--mock', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(hidden.code).toBe(EXIT.failed);
    expect(hidden.json()[0]).toMatchObject({ status: 'refused', message: expect.stringMatching(/dot-folder/) });
  });

  it('writes a report its words change nothing in as it reads, and an SSRS or FastReport report as converted, so --out holds every report and --skip-existing asks the AI nothing again (U1)', { timeout: 60_000 }, async () => {
    const dir = folder();
    put(dir, join('in', 'inv.repx'), INVOICE());
    put(dir, join('in', 'products.frx'), FRX);
    // No case here may reach an AI: a redesign would ask, and the AI chosen is Local AI on a port nothing listens on.
    const noRedesign = async () => {
      throw new Error('the AI must not be asked for a redesign');
    };
    // An answer in place of a change: the report is written as it reads, and the FastReport report as converted, never lost.
    const answer: GenHooks = { chat: async () => ({ reply: 'There is no title to make bold.', wantsReport: false, action: 'answer' }) as ChatOutcome, ask: noRedesign };
    const ran = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: answer });
    expect(ran.code, ran.err).toBe(EXIT.done);
    const rows = ran.json().filter((l) => l.type === 'input');
    expect(rows.map((r) => [r.input, r.route, r.action, r.status, r.kept])).toEqual([
      [join('in', 'inv.repx'), 'revise', 'answer', 'done', 'as it reads'],
      [join('in', 'products.frx'), 'convert-revise', 'answer', 'done', 'as converted'],
    ]);
    expect(rows[1]).toMatchObject({ written: { path: join(dir, 'out', 'products.revised.repx'), status: 'written' }, errors: expect.any(Number) });
    expect(under(join(dir, 'out'))).toEqual(['inv.revised.repx', 'products.revised.repx']);
    expect(readFileSync(join(dir, 'out', 'products.revised.repx'), 'utf8')).toContain('<XtraReportsLayoutSerializer');
    expect(readFileSync(join(dir, 'out', 'inv.revised.repx'), 'utf8')).toContain('Name="title"');
    // The same command again asks the AI nothing: every report is under --out.
    const again = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold', '--skip-existing', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: NEVER_ASKED });
    expect(again.code).toBe(EXIT.done);
    expect(again.json().at(-1)).toMatchObject({ inputs: 2, skipped: 2, done: 0 });
    // Plain, the converted report is named as converted, the answer said; never "it already reads that way" of an .frx.
    const answered = await cli(['batch', 'in', '--out', 'answered', '--words', 'Make the title bold'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: answer });
    expect(answered.code, answered.err).toBe(EXIT.done);
    expect(answered.out).toContain(`The request was answered by Local AI rather than carried out, so the report converted from "${join('in', 'products.frx')}" is written as converted; the result has `);
    expect(answered.out).toContain('There is no title to make bold.');
    expect(answered.out).not.toMatch(/it already reads that way/);
    expect(under(join(dir, 'answered'))).toEqual(['inv.revised.repx', 'products.revised.repx']);
    // An edit that is made and changes nothing: the report already reads that way, and is written as it reads.
    const same: GenHooks = { chat: async () => ({ reply: 'It already says that.', wantsReport: false, action: 'edit', edits: [{ op: 'text', control: 'title', text: 'Invoice' }] }) as ChatOutcome, ask: noRedesign };
    const unchanged = await cli(['batch', 'in', '--out', 'same', '--words', 'Title it Invoice', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: same });
    expect(unchanged.json()[0]).toMatchObject({ input: join('in', 'inv.repx'), action: 'unchanged', status: 'done', kept: 'as it reads', written: { path: join(dir, 'same', 'inv.revised.repx') } });
    const plain = await cli(['batch', 'in', '--out', 'same2', '--words', 'Title it Invoice'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: same });
    expect(plain.out).toContain(`Nothing needed changing, so "${join('in', 'inv.repx')}" is written as it reads; the result has no problems.`);
  });

  it("judges every output and data file in the working folder's mode: a link under --out, or on the way to a --data file, out of that folder is refused as the single commands refuse it (SEC-W4-1)", async () => {
    const dir = folder();
    const outside = folder();
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    put(dir, join('reports', 'sub', 'a.repx'), INVOICE());
    mkdirSync(join(dir, 'out'));
    symlinkSync(outside, join(dir, 'out', 'sub'), kind);
    const ran = await cli(['batch', 'reports', '--out', 'out', '--repair', '--json'], { cwd: dir, hooks: NEVER_ASKED });
    expect(ran.code).toBe(EXIT.failed);
    expect(ran.json()[0]).toMatchObject({ input: join('reports', 'sub', 'a.repx'), status: 'refused', message: expect.stringMatching(/outside the folder the command is run in; Forma follows no link out of it\.$/) });
    expect(readdirSync(outside)).toEqual([]);
    const single = await cli(['repair', join('reports', 'sub', 'a.repx'), '--out', join('out', 'sub', 'b.repaired.repx')], { cwd: dir });
    expect(single.code).toBe(EXIT.failed);
    expect(single.err).toMatch(/Forma follows no link out of it/);
    // A data file reached through a link out of the folder: refused once, before any file, and nothing made.
    const secret = folder();
    put(secret, 'rows.csv', 'Name\nAda\n');
    symlinkSync(secret, join(dir, 'data'), kind);
    put(dir, join('pics', 'z.pdf'), '');
    writeFileSync(join(dir, 'pics', 'z.pdf'), textPdf('Z'));
    const data = await cli(['batch', 'pics', '--out', 'made', '--data', join('data', 'rows.csv'), '--mock', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: NEVER_ASKED });
    expect(data.code).toBe(EXIT.failed);
    expect(data.json()[0]).toMatchObject({ input: join('data', 'rows.csv'), status: 'refused', message: expect.stringMatching(/Forma follows no link out of it\. --data names a data file/) });
    expect(existsSync(join(dir, 'made'))).toBe(false);
    const generated = await cli(['generate', join('pics', 'z.pdf'), '--data', join('data', 'rows.csv'), '--mock', '--out', 'z.repx'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: NEVER_ASKED });
    expect(generated.code).toBe(EXIT.failed);
    expect(generated.err).toMatch(/Forma follows no link out of it/);
  });

  it("stops for the key only on the AI's own failure, never on a file's name, and never for Local AI, which has no key (SEC-W4-3)", { timeout: 60_000 }, async () => {
    const dir = folder();
    put(dir, join('in', 'permission.frx'), '<Nothing/>');
    put(dir, join('in', 'z.repx'), INVOICE());
    const ran = await cli(['batch', 'in', '--out', 'out', '--words', 'Make the title bold', '--mock', '--json'], { cwd: dir, env: { ...GEMINI, ...NOWHERE } });
    expect(ran.json().filter((l) => l.type === 'input').map((l) => [l.input, l.status])).toEqual([
      [join('in', 'permission.frx'), 'failed'],
      [join('in', 'z.repx'), 'done'],
    ]);
    expect(ran.json().at(-1)).toMatchObject({ notStarted: 0, stoppedBy: null, exitCode: 4 });
    expect(ran.err).not.toMatch(/refused the key/);
    // Local AI's failure in words that would be a key's stops nothing.
    put(dir, join('local', 'a.repx'), INVOICE());
    put(dir, join('local', 'b.repx'), INVOICE());
    const local = await cli(['batch', 'local', '--out', 'out2', '--words', 'Bold title', '--json'], {
      cwd: dir,
      env: NOWHERE,
      hooks: {
        chat: async () => {
          throw new Error('permission denied: the model file cannot be read');
        },
      },
    });
    expect(local.json().filter((l) => l.type === 'input').map((l) => l.status)).toEqual(['failed', 'failed']);
    expect(local.json().at(-1)).toMatchObject({ failed: 2, notStarted: 0, stoppedBy: null });
  });

  it.skipIf(process.platform === 'win32')("prints a file name that holds a line break as one line, in the plan and in the run, so no name forges a line (SEC-W4-5; off Windows, whose file system takes no such name)", async () => {
    const dir = folder();
    put(dir, join('in', 'x\nforged line.png'), 'not a picture');
    const plan = await cli(['batch', 'in', '--out', 'out', '--dry-run'], { cwd: dir });
    expect(plan.code).toBe(EXIT.done);
    expect(plan.lines).toHaveLength(2);
    expect(plan.lines[0].startsWith(`"${join('in', 'x?forged line.png')}": `)).toBe(true);
    const ran = await cli(['batch', 'in', '--out', 'out', '--mock'], { cwd: dir, env: { ...GEMINI, ...NOWHERE }, hooks: NEVER_ASKED });
    expect(ran.code).toBe(EXIT.failed);
    expect(ran.err.split('\n').filter((line) => line.startsWith('forged line'))).toEqual([]);
    // The run refuses the output name the input gives, which holds the line break, before the
    // file is read (paths.ts refuses a control character in any path), and says so on one line
    // with the break shown as '?' (measured on CI's Linux, 2026-11-24: the first run of this case).
    expect(ran.err).toMatch(/x\?forged line\.generated\.repx" holds a control character/);
  });
});

describe('Ctrl+C', () => {
  it('aborts the run on the first signal, says so, and ends the process with 130 on the second; Ctrl+Break too on Windows', () => {
    const on = (platform: string) => {
      const listeners: Record<string, () => void> = {};
      const exits: number[] = [];
      const proc: SignalSource = { platform, on: (event, listener) => (listeners[event] = listener), exit: (code) => exits.push(code) };
      const stop = new AbortController();
      const lines: string[] = [];
      stopOnSignals(proc, stop, (line) => lines.push(line));
      return { listeners, exits, stop, lines };
    };
    const linux = on('linux');
    expect(Object.keys(linux.listeners).sort()).toEqual(['SIGINT', 'SIGTERM']);
    linux.listeners.SIGTERM();
    expect(linux.stop.signal.aborted).toBe(true);
    expect(linux.exits).toEqual([]);
    expect(linux.lines).toEqual(['Stopping: the report under way is not written. Press Ctrl+C again to end at once.']);
    linux.listeners.SIGINT();
    expect(linux.exits).toEqual([130]);
    expect(Object.keys(on('win32').listeners).sort()).toEqual(['SIGBREAK', 'SIGINT', 'SIGTERM']);
  });
});

describe('plain lines', () => {
  it("drops the chat's emphasis from a plain line, never a name's underscore (U12), and makes a folded finding whole again (U9)", () => {
    expect(plainWords('removed **c2**, kept `title`')).toBe('removed c2, kept title');
    expect(plainWords('label_1 and _x_ stay')).toBe('label_1 and _x_ stay');
    expect(plainWords('2 ** 3')).toBe('2 ** 3');
    expect(unfolded(['error a: one two', '... three four', 'warning b: x'])).toEqual(['error a: one two three four', 'warning b: x']);
    // Cut inside a word, the line before fills the 200 characters a folded line holds, and nothing goes between.
    const full = `error a: ${'w'.repeat(191)}`;
    expect(full).toHaveLength(200);
    expect(unfolded([full, '... ww more'])).toEqual([`${full}ww more`]);
  });
});

describe("the command line's words", () => {
  it("names none of the words a host's model is told, in anything said above", () => {
    // Every case above ran first (a file's cases run in order), so this reads all they printed.
    expect(said.length).toBeGreaterThan(40);
    expect(said.filter(forAHost)).toEqual([]);
  });
});

/*
 * The command as the docs give it, spawned (TEST-1, TEST-3): plain node and
 * the launcher's path in the clone, from a fresh folder outside the clone,
 * the home and the temp folder scratch ones.
 */
const LAUNCHER = join(CLONE, ...CLI_LAUNCHER.split('/'));
const fakeNewerKey = ['A', 'Q.'].join('') + 'p'.repeat(40);

/** A process started for one case, ended after it, pass or fail (stdio.test.ts's T8). */
const children: { child: ChildProcessWithoutNullStreams; exited: Promise<number | null> }[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000).unref())]);
  }
  for (const server of servers.splice(0)) server.close();
});

interface Spawned {
  cwd: string;
  home: string;
  temp: string;
  child: ChildProcessWithoutNullStreams;
  done: Promise<{ code: number | null; signal: string | null; out: string; err: string }>;
  err(): string;
}

/** The command line as a person runs it: `env` added to a clean environment (no FORMA_* of the runner's), `files` written first, then `prepare` given the folder. */
function run(args: string[], env: Record<string, string> = {}, files: Record<string, string> = {}, prepare?: (cwd: string) => void): Spawned {
  const cwd = realpathSync.native(mkdtempSync(join(scratch, 'spawned-')));
  const home = mkdtempSync(join(scratch, 'home-'));
  const temp = mkdtempSync(join(scratch, 'temp-'));
  for (const [name, content] of Object.entries(files)) put(cwd, name, content);
  prepare?.(cwd);
  const base: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home, HOME: home, TEMP: temp, TMP: temp, TMPDIR: temp, GEMINI_API_KEY: fakeNewerKey };
  for (const name of Object.keys(base)) if (name.startsWith('FORMA_') || name === 'CLAUDE_PROJECT_DIR' || name === 'TSX_TSCONFIG_PATH') delete base[name];
  const child = spawn(process.execPath, [LAUNCHER, ...args], { cwd, env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  children.push({ child, exited });
  const done = new Promise<{ code: number | null; signal: string | null; out: string; err: string }>((resolveDone) => child.on('close', (code, signal) => resolveDone({ code, signal, out, err })));
  return { cwd, home, temp, child, done, err: () => err };
}

/** Every file under a folder, relative to it. */
function filesUnder(dir: string, under = ''): string[] {
  return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(dir, join(under, e.name)) : [join(under, e.name)]));
}

/** A user's project files that would break Forma if tsx applied their tsconfig.json (stdio.test.ts's HOSTILE, CLI-8). */
const STUB_SAYS = 'FORMA-HOSTILE-TSCONFIG';
const HOSTILE: Record<string, string> = {
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { paths: { zod: ['./stub.mjs'], '@napi-rs/canvas': ['./stub.mjs'] } } }, null, 2)}\n`,
  'stub.mjs': `throw new Error('${STUB_SAYS}: a package was resolved through the tsconfig.json of the working folder');\n`,
};

describe('the command line, spawned as the docs give it', () => {
  it('prints its help and a usage error from a folder outside the clone', { timeout: 120_000 }, async () => {
    const fromClone = relative(CLONE, scratch);
    expect(fromClone.startsWith('..') || isAbsolute(fromClone)).toBe(true);
    const help = await run(['--help']).done;
    expect(help.code, help.err).toBe(0);
    expect(help.out).toContain(`node <clone>/${CLI_LAUNCHER} <command> [options]`);
    expect(help.err).toBe('');
    const usage = await run(['audit', '--force', 'x.repx']).done;
    expect(usage.code).toBe(2);
    expect(usage.out).toBe('');
    expect(usage.err).toBe('forma: --force is not an option of audit. Run with --help for the commands and their options.\n');
  });

  it('audits under --json with only JSON Lines on stdout, exit 1 for audit errors, and needs no AI at all', { timeout: 120_000 }, async () => {
    const s = run(['audit', 'a.repx', 'b.repx', '--json'], {}, { 'a.repx': INVOICE(), 'b.repx': SCRIPTED });
    const done = await s.done;
    expect(done.code, done.err).toBe(1);
    const lines = done.out.split('\n').filter(Boolean);
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(['input', 'input', 'summary']);
    expect(JSON.parse(lines[2])).toMatchObject({ inputs: 2, done: 1, errors: 1, exitCode: 1 });
    expect(readdirSync(s.cwd).sort()).toEqual(['a.repx', 'b.repx']);
  });

  it("takes a key out of a result line, a stray write and the guard's own lines by its value, and ends an unhandled rejection with 70, never 1 (SEC-W4-4)", { timeout: 120_000 }, async () => {
    // A file named with a key in a shape no pattern knows, set as FORMA_GEMINI_KEY: only the scrub by value, which the entry
    // wires to main and to the guard, takes it out; cliEntry.ts's test switch then writes it around the guard and rejects a promise.
    const named = `${shapelessKey}.repx`;
    const s = run(['audit', named, '--json'], { FORMA_GEMINI_KEY: shapelessKey, FORMA_CLI_TEST_NOISE: '1' }, { [named]: INVOICE() });
    const done = await s.done;
    expect(done.code, done.err.slice(-2000)).toBe(70);
    const lines = done.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['input', 'summary']);
    expect(lines[0]).toMatchObject({ status: 'done', input: '(a key).repx' });
    expect(done.out + done.err).not.toContain(shapelessKey.slice(0, 12));
    expect(done.err).toContain('FORMA-NOISE key on console.log (a key)');
    expect(done.err).toContain('FORMA-NOISE key on process.stdout.write (a key)');
    expect(done.err).toContain("forma: FORMA-NOISE key on the guard's log (a key)");
    expect(done.err).toContain('forma: an unhandled rejection; the run stops.');
  });

  it('refuses generate with no AI set up, exit 3, nothing on stdout and nothing written', { timeout: 120_000 }, async () => {
    const s = run(['generate', '--description', 'An invoice', '--out', 'x.repx']);
    const done = await s.done;
    expect(done.code).toBe(3);
    expect(done.out).toBe('');
    expect(done.err).toMatch(/^forma: Set up your AI in Settings to start: .*Here, Settings are the environment the command runs in/);
    expect(done.err).not.toContain(fakeNewerKey.slice(0, 12));
    expect(readdirSync(s.cwd)).toEqual([]);
  });

  it("generates with the mock from a folder whose tsconfig.json would break Forma: JSON Lines only on stdout, no key on either stream, and nothing written but the report, OCR's languages and tsx's cache", { timeout: 240_000 }, async () => {
    const s = run(['generate', '--mock', '--description', 'An invoice with a title and a table of items.', '--out', 'invoice.repx', '--json', '--verbose'], { FORMA_GEMINI_KEY: shapelessKey, ...(NOWHERE as Record<string, string>) }, HOSTILE);
    const done = await s.done;
    expect(done.code, done.err.slice(-2000)).toBe(0);
    const lines = done.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['input', 'summary']);
    expect(lines[0]).toMatchObject({ status: 'done', provider: 'mock', written: { path: join(s.cwd, 'invoice.repx'), status: 'written' } });
    for (const key of [shapelessKey, fakeNewerKey]) expect(done.out + done.err).not.toContain(key.slice(0, 12));
    expect(done.err).not.toContain(STUB_SAYS);
    expect(readdirSync(s.cwd).sort()).toEqual(['invoice.repx', 'stub.mjs', 'tsconfig.json']);
    const forma = relative(s.home, formaUserFolder(s.home));
    for (const file of filesUnder(s.home)) expect(file.startsWith(join(forma, 'tessdata') + sep), file).toBe(true);
    for (const name of readdirSync(s.temp)) expect(name).toMatch(/^tsx-/);
  });

  it("makes a folder under --mock: each file in its own bounded thread, JSON Lines only on stdout (no repair's console line), the link out of it never followed, no key on either stream", { timeout: 240_000 }, async () => {
    const s = run(
      ['batch', 'in', '--out', 'out', '--mock', '--json'],
      { FORMA_GEMINI_KEY: shapelessKey, ...(NOWHERE as Record<string, string>) },
      { [join('in', 'a.pdf')]: textPdf('INVOICE 1001').toString('latin1'), [join('in', 'sub', 'b.rdl')]: RDL, [join('in', 'r.repx')]: INVOICE(), [join('in', 'data.csv')]: 'Name,Age\n' },
      (cwd) => {
        const outside = join(cwd, 'outside');
        mkdirSync(outside);
        writeFileSync(join(outside, 'secret.rdl'), RDL);
        symlinkSync(outside, join(cwd, 'in', 'away'), process.platform === 'win32' ? 'junction' : 'dir');
      },
    );
    const done = await s.done;
    expect(done.code, done.err.slice(-2000)).toBe(0);
    const lines = done.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.type, l.input, l.route, l.status])).toEqual([
      ['input', join('in', 'a.pdf'), 'generate', 'done'],
      ['input', join('in', 'r.repx'), 'skip', 'skipped'],
      ['input', join('in', 'sub', 'b.rdl'), 'convert', 'done'],
      ['summary', undefined, undefined, undefined],
    ]);
    expect(lines.at(-1)).toMatchObject({ command: 'batch', done: 2, skipped: 1, exitCode: 0, leftOut: { links: 1 }, providers: { mock: 1 } });
    expect(done.err).toContain('Left out 1 link (a batch follows no link or junction).');
    expect(done.out).not.toContain('Repair, ');
    for (const key of [shapelessKey, fakeNewerKey]) expect(done.out + done.err).not.toContain(key.slice(0, 12));
    expect(under(join(s.cwd, 'out'))).toEqual(['a.generated.repx', 'sub/b.converted.repx']);
  });

  it.skipIf(process.platform === 'win32')('stops on Ctrl+C while the AI is asked: exit 130, nothing written (off Windows, where a signal reaches the handler)', { timeout: 240_000 }, async () => {
    // An AI on this computer that takes every connection and never answers, so the run is waiting when the signal comes.
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const s = run(['generate', '--description', 'An invoice', '--out', 'x.repx'], { FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'forma-test-model', FORMA_LOCAL_URL: `http://127.0.0.1:${port}/v1` });
    const deadline = Date.now() + 180_000;
    while (!s.err().includes('Waiting for the AI.') && Date.now() < deadline && s.child.exitCode === null) await new Promise((done) => setTimeout(done, 100));
    expect(s.err(), s.err().slice(-2000)).toContain('Waiting for the AI.');
    s.child.kill('SIGINT');
    const done = await s.done;
    expect(done.code, done.err.slice(-2000)).toBe(130);
    expect(done.err).toContain('Stopping: the report under way is not written.');
    expect(readdirSync(s.cwd)).toEqual([]);
  });
});
