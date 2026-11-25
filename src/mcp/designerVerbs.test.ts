/**
 * Forma Designer's command-line verbs, started from Forma's Node side
 * (2026-11-25, the CLI and Forma Designer work's wave 6; findings D2-1,
 * D2-5, D2-6, D2-10, D2-11 and SEC-5 of its design audit,
 * `DevFiles/forma-audit/cli-designer-2026-11-24-findings.md`). No test
 * starts Forma Designer, and CI runs on Linux with no .exe at all, so the
 * program is stood in for by a Node script written here at run time and
 * started through the helper's seam (`DesignerStart`), with exactly the
 * arguments, options and environment the helper hands Node's spawn; a
 * second seam reads the version, or the real reader reads a program built
 * here byte by byte (`fakePe`). The stand-in answers as each verb does, as
 * Forma Designer 1.1.0 does (`--check`'s JSON), with something that is not
 * JSON, with too much, with nothing until it is killed, and with every
 * failure the verbs say. Three halves:
 *
 * - **Its version, read from the file** (`peFileVersion`): PE32 and PE32+
 *   built here, every way of being something else, and on Windows Node's
 *   own program, whose file version is Node's.
 * - **The helper**: where Forma Designer is (`designerPlace`), what is
 *   started and how (the sentinel last, no shell, stdin closed, its own
 *   folder, the entry's environment), what is never started (an older
 *   install, an unreadable version, a link, a name that could read as a
 *   switch), the envelope trusted before the exit code, the byte cap, the
 *   deadline and a stop each killing the child, which is then gone.
 * - **The command line**: `connections`, and `--connection` with
 *   `--sample-objects` on bind and generate as `main` runs them (the
 *   report work and the AI's in this thread, the AI the mock or a hook that
 *   records what it was shown), the report's connection the name Forma
 *   Designer keeps (D2-10), sample values sent only when named and never
 *   printed (OC6), and every refusal before anything else is read.
 *
 * Its one run against the real Forma Designer, on LocalDB's made-up
 * FormaSample, is recorded in docs/notes/mcp.md, *Forma Designer's verbs
 * from the command line*. No key is real and no request leaves this
 * computer: every key is built at run time (TST-10), and every AI case
 * chooses Local AI at 127.0.0.1:1 beside the mock or a hook that answers.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DESIGNER_VERBS_SINCE } from '../lib/designerRelease';
import { FORMA_KEYS, redactorFor } from '../lib/keyRedact';
import { readRepxDataSources } from '../lib/repxSqlDataSource';
import { SAMPLE_EXPORT, SCHEMA_EXPORT } from '../lib/sqlFixtures';
import { mockAnswer } from '../services/geminiService';
import type { AiEnv } from './aiSettings';
import { CallStopped } from './caller';
import { EXIT, main, parseArgs, type CliIo } from './commandLine';
import {
  DESIGNER_CHECK_SINCE,
  DESIGNER_ENV,
  DESIGNER_EXIT,
  DESIGNER_SENTINEL,
  DESIGNER_VERBS,
  DRAIN_MS,
  DesignerRefusal,
  RENAME_TO_USE,
  designerConnections,
  designerEnvFrom,
  designerPlace,
  designerRead,
  fileVersionOf,
  peFileVersion,
  unquoted,
  type DesignerSetup,
  type DesignerStart,
} from './designerVerbs';
import type { GenHooks } from './genJobs';
import { inThread, inThreadGenerator } from './testClient';

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'designer-verbs-')));
const userFolder = join(scratch, 'forma-user');

/**
 * The stand-in for RepxDesigner.exe: started as `node stand-in.mjs <mode> <the helper's arguments>`, it notes each start
 * in calls.jsonl beside it (its arguments, its working folder, its environment's names) and answers as `mode` says. Its
 * one line is ASCII, every character above 126 written as \uXXXX, as Forma Designer's is (Verbs.cs, D2-2).
 */
const STAND_IN = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [mode, ...args] = process.argv.slice(2);
const here = dirname(process.argv[1]);
appendFileSync(join(here, 'calls.jsonl'), JSON.stringify({ mode, args, cwd: process.cwd(), env: Object.keys(process.env).sort() }) + '\n');
const ascii = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const out = (text, code) => process.stdout.write(text + '\n', () => process.exit(code));
const verb = args[0];
const say = (fields, code = 0, as = verb) => out(ascii({ formaDesignerVerb: 1, verb: as, version: '1.2.0', ok: code === 0, ...fields }), code);
const hang = () => setInterval(() => {}, 1000);
const named = args[args.indexOf('--connection') + 1];
const kept = JSON.parse(readFileSync(join(here, 'kept.json'), 'utf8'));
const found = kept.find((c) => c.name.toLowerCase() === String(named).toLowerCase());
// A process the program starts that inherits its pipes and outlives it, as one SqlClient or Windows could start (N6-2).
if (mode.startsWith('grandchild')) {
  const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { detached: true, stdio: 'inherit', windowsHide: true });
  writeFileSync(join(here, 'grandchild-' + process.pid + '.pid'), String(g.pid));
  g.unref();
}
if (mode === 'old') out(JSON.stringify({ app: 'RepxDesigner', bin: 'C:\\x', devexpress: null, found: [] }), 0);
else if (mode === 'grandchild-hang') hang();
else if (mode === 'garbage') out('Unhandled Exception: System.IO.FileNotFoundException', 0);
else if (mode === 'crash') process.exit(255);
else if (mode === 'silent') hang();
else if (mode === 'huge') {
  const chunk = 'x'.repeat(64 * 1024);
  let n = 0;
  const go = () => {
    while (n++ < 64) if (!process.stdout.write(chunk)) return process.stdout.once('drain', go);
    process.exit(0);
  };
  go();
} else if (args.at(-2) !== '--check' || args.at(-1) !== '--no-load') say({ problem: 'usage', error: 'Every call ends with --check --no-load.' }, 2);
else if (verb === 'sql-list') say({ connections: kept.map((c) => ({ name: c.name, mode: c.mode, database: c.database })) });
else if (!found) say({ problem: 'not-kept', error: 'Forma Designer keeps no connection named ' + named + ' on this PC.' }, 4);
else if (mode === 'schema-hang') hang();
else if (mode === 'sql-fail') say({ problem: 'sign-in', error: 'SQL Server refused the saved sign-in.', number: 18456 }, 5);
else if (mode === 'sql-245') say({ problem: 'sql', error: "Conversion failed when converting the varchar value 'Jane Doe, 12 Hidden Lane' to data type int.", number: 245 }, 5);
else if (mode === 'failed-cut') say({ problem: 'failed', error: "InvalidOperationException: the value 'Jane Doe, 12 Hid" }, 5);
else if (mode === 'mismatch') out(ascii({ formaDesignerVerb: 1, verb, ok: true, connection: found.name, layout: 'x' }), 3);
else if (mode === 'wrong-verb') say({ connections: [] }, 0, 'sql-list');
else if (verb === 'sql-schema') {
  if (mode === 'stderr') process.stderr.write('a line on stderr\r\n');
  say({ connection: found.name, layout: readFileSync(join(here, 'layout.txt'), 'utf8') });
} else if (verb === 'sql-sample') {
  const unread = mode === 'unread' ? [{ object: 'dbo.RvBad', number: 8134 }, { object: 'dbo.vGone', number: 208 }, { object: 'dbo.Odd' }] : [];
  say({ connection: found.name, samples: readFileSync(join(here, 'samples.txt'), 'utf8'), unread });
}
else say({ problem: 'usage', error: 'no such verb' }, 2);
`;

/** A Windows program's bytes with only the parts its version is read from: the headers, one section and the version resource. */
function fakePe([a, b, c, d]: readonly number[], plus = false): Uint8Array {
  const bytes = new Uint8Array(0x400);
  const v = new DataView(bytes.buffer);
  v.setUint16(0, 0x5a4d, true);
  const pe = 0x40;
  v.setUint32(0x3c, pe, true);
  v.setUint32(pe, 0x4550, true);
  v.setUint16(pe + 4, plus ? 0x8664 : 0x14c, true);
  v.setUint16(pe + 6, 1, true);
  const optionalSize = plus ? 240 : 224;
  v.setUint16(pe + 20, optionalSize, true);
  const optional = pe + 24;
  v.setUint16(optional, plus ? 0x20b : 0x10b, true);
  v.setUint32(optional + (plus ? 108 : 92), 16, true);
  const directories = optional + (plus ? 112 : 96);
  v.setUint32(directories + 16, 0x1000, true);
  v.setUint32(directories + 20, 0x100, true);
  const section = optional + optionalSize;
  bytes.set([...'.rsrc'].map((ch) => ch.charCodeAt(0)), section);
  v.setUint32(section + 8, 0x200, true);
  v.setUint32(section + 12, 0x1000, true);
  v.setUint32(section + 16, 0x200, true);
  v.setUint32(section + 20, 0x200, true);
  const root = 0x200;
  const level = (at: number, id: number, field: number) => {
    v.setUint16(root + at + 14, 1, true);
    v.setUint32(root + at + 16, id, true);
    v.setUint32(root + at + 20, field >>> 0, true);
  };
  level(0, 16, 0x80000000 | 0x18);
  level(0x18, 1, 0x80000000 | 0x30);
  level(0x30, 0x409, 0x48);
  v.setUint32(root + 0x48, 0x1000 + 0x58, true);
  v.setUint32(root + 0x48 + 4, 92, true);
  const info = root + 0x58;
  v.setUint16(info, 92, true);
  v.setUint16(info + 2, 52, true);
  for (let i = 0; i < 'VS_VERSION_INFO'.length; i++) v.setUint16(info + 6 + i * 2, 'VS_VERSION_INFO'.charCodeAt(i), true);
  const fixed = info + 40;
  v.setUint32(fixed, 0xfeef04bd, true);
  v.setUint32(fixed + 4, 0x10000, true);
  v.setUint32(fixed + 8, ((a << 16) | b) >>> 0, true);
  v.setUint32(fixed + 12, ((c << 16) | d) >>> 0, true);
  return bytes;
}

/** A folder with a "RepxDesigner.exe" of these bytes, the stand-in, its connections and the layout and rows it prints. */
function install(name: string, exe: Uint8Array | string, kept = [{ name: 'FormaSample', mode: 'windows', database: 'FormaSample' }, { name: 'Sales', mode: 'login', database: 'ERP_Prod' }]): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RepxDesigner.exe'), exe);
  writeFileSync(join(dir, 'stand-in.mjs'), STAND_IN);
  writeFileSync(join(dir, 'kept.json'), JSON.stringify(kept));
  writeFileSync(join(dir, 'layout.txt'), SCHEMA_EXPORT);
  writeFileSync(join(dir, 'samples.txt'), SAMPLE_EXPORT);
  return join(dir, 'RepxDesigner.exe');
}

/** Each start's record, as the stand-in noted it. */
function calls(exe: string): { mode: string; args: string[]; cwd: string; env: string[] }[] {
  const file = join(dirname(exe), 'calls.jsonl');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  rmSync(file);
  return lines.map((l) => JSON.parse(l));
}

/** The environment the entry builds (cliEntry.ts), here from the tests' own. */
const ENTRY_ENV = designerEnvFrom(process.env);

interface Started {
  file: string;
  args: readonly string[];
  options: Parameters<DesignerStart>[2];
  child: ChildProcess;
}

/** A setup whose program is the stand-in in `mode`, started with what the helper hands spawn, each start kept. */
function standIn(exe: string, mode: string, o: { from?: 'install' | 'override'; version?: string | null; started?: Started[] } = {}): DesignerSetup {
  const start: DesignerStart = (file, args, options) => {
    const child = spawn(process.execPath, [join(dirname(file), 'stand-in.mjs'), mode, ...args], options);
    o.started?.push({ file, args, options, child });
    return child;
  };
  return {
    place: { ok: true, exe, from: o.from ?? 'install' },
    env: ENTRY_ENV,
    start,
    ...(o.version !== undefined ? { versionOf: async () => o.version as string | null } : {}),
  };
}

/** Whether a process is still running. */
function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits for a child to be gone, at most a few seconds. */
async function gone(child: ChildProcess): Promise<boolean> {
  for (let i = 0; i < 50 && alive(child.pid); i++) await new Promise((done) => setTimeout(done, 100));
  return !alive(child.pid);
}

const CLI: { voice: 'cli' } = { voice: 'cli' };
let current = '';

beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'debug', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  current = install('current', fakePe([1, 2, 0, 0]));
});
afterAll(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("its version, read from the file (D2-1)", () => {
  it('reads PE32 and PE32+ programs built here, as a.b.c', () => {
    expect(peFileVersion(fakePe([1, 2, 0, 0]))).toBe('1.2.0');
    expect(peFileVersion(fakePe([20, 1, 3, 0], true))).toBe('20.1.3');
    expect(peFileVersion(fakePe([1, 10, 65535, 9]))).toBe('1.10.65535');
  });

  it('reads nothing from what is not such a program, or reads outside itself, rather than guess', () => {
    const good = fakePe([1, 2, 0, 0]);
    expect(peFileVersion(new Uint8Array(0))).toBeNull();
    expect(peFileVersion(new TextEncoder().encode('#!/usr/bin/env node\n'))).toBeNull();
    expect(peFileVersion(good.subarray(0, 0x260))).toBeNull();
    const noSignature = good.slice();
    noSignature[0x280] = 0;
    expect(peFileVersion(noSignature)).toBeNull();
    const farAway = good.slice();
    new DataView(farAway.buffer).setUint32(0x3c, 0x7fffffff, true);
    expect(peFileVersion(farAway)).toBeNull();
    // A version resource whose key is not VS_VERSION_INFO is not one.
    const otherKey = good.slice();
    otherKey[0x258 + 6] = 'X'.charCodeAt(0);
    expect(peFileVersion(otherKey)).toBeNull();
  });

  it('reads the file itself, without starting it, and nothing from a file that is not there', async () => {
    expect(await fileVersionOf(current)).toBe('1.2.0');
    expect(await fileVersionOf(join(scratch, 'nowhere', 'RepxDesigner.exe'))).toBeNull();
  });

  it.runIf(process.platform === 'win32')("reads Node's own program as Node's version, as Windows shows it", async () => {
    expect(await fileVersionOf(process.execPath)).toBe(process.versions.node);
  });
});

describe('where Forma Designer is (D2-11)', () => {
  it("is the per-user install under LOCALAPPDATA, or FORMA_DESIGNER's copy built from source, as a full Windows path", () => {
    expect(designerPlace({ platform: 'win32', localAppData: 'C:\\Users\\a\\AppData\\Local' })).toEqual({ ok: true, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Forma Designer\\RepxDesigner.exe', from: 'install' });
    expect(designerPlace({ platform: 'win32', localAppData: 'C:\\Users\\a\\AppData\\Local', override: 'G:\\forma\\tools\\RepxDesigner\\bin\\Release\\RepxDesigner.exe' })).toEqual({
      ok: true,
      exe: 'G:\\forma\\tools\\RepxDesigner\\bin\\Release\\RepxDesigner.exe',
      from: 'override',
    });
    expect(designerPlace({ platform: 'win32', override: 'G:/forma/bin/../bin/RepxDesigner.exe' })).toMatchObject({ ok: true, exe: 'G:\\forma\\bin\\RepxDesigner.exe' });
  });

  it('is said in words off Windows, and never found by a bare name, a share, a relative path or another program', () => {
    expect(designerPlace({ platform: 'linux', localAppData: '/home/a', override: '/opt/RepxDesigner.exe' })).toEqual({ ok: false, reason: 'Forma Designer runs on Windows, and this computer is not running Windows.' });
    for (const override of ['RepxDesigner.exe', '.\\RepxDesigner.exe', '\\\\server\\share\\RepxDesigner.exe', '//server/share/RepxDesigner.exe', '\\\\?\\C:\\x\\RepxDesigner.exe', 'C:RepxDesigner.exe']) {
      expect(designerPlace({ platform: 'win32', localAppData: 'C:\\L', override }), override).toMatchObject({ ok: false, reason: expect.stringMatching(/^FORMA_DESIGNER is not a full path on a drive/) });
    }
    expect(designerPlace({ platform: 'win32', override: 'C:\\Windows\\System32\\cmd.exe' })).toMatchObject({ ok: false, reason: expect.stringMatching(/^FORMA_DESIGNER names a program other than RepxDesigner\.exe/) });
    for (const localAppData of [undefined, '', '\\\\server\\profiles\\a', 'AppData']) {
      expect(designerPlace({ platform: 'win32', localAppData }), String(localAppData)).toMatchObject({ ok: false, reason: expect.stringMatching(/^LOCALAPPDATA is not a folder on a drive/) });
    }
  });

  it("is handed an environment of Windows' own variables alone: no key of any program, whatever the entry's holds", () => {
    const env = designerEnvFrom({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\T', FORMA_GEMINI_KEY: 'k1', GEMINI_API_KEY: 'k2', OPENAI_API_KEY: 'k3', AWS_SECRET_ACCESS_KEY: 'k4', FORMA_DESIGNER: 'C:\\x\\RepxDesigner.exe' });
    expect(env).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\T' });
    expect(DESIGNER_ENV).toContain('SystemRoot');
  });
});

describe('starting a verb', () => {
  it('starts the program with the verb first and the sentinel last, no shell, stdin closed, its own folder, the entry\'s environment, no window', async () => {
    const started: Started[] = [];
    const list = await designerConnections(standIn(current, 'verbs', { started }), CLI);
    expect(list).toEqual([
      { name: 'FormaSample', signIn: 'windows', database: 'FormaSample', usable: true },
      { name: 'Sales', signIn: 'login', database: 'ERP_Prod', usable: true },
    ]);
    expect(started).toHaveLength(1);
    expect(started[0].file).toBe(current);
    expect(started[0].args).toEqual(['sql-list', ...DESIGNER_SENTINEL]);
    expect(started[0].options).toEqual({ cwd: dirname(current), env: ENTRY_ENV, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const [call] = calls(current);
    expect(realpathSync.native(call.cwd)).toBe(realpathSync.native(dirname(current)));
    // What the child saw is what the entry built, and no key's name among it.
    expect(call.env.filter((n) => /KEY|TOKEN|SECRET|PASSWORD/i.test(n))).toEqual([]);
  });

  it("reads a connection's layout under the name Forma Designer keeps, after finding it in its list, with every verb's seconds, and the rows only when asked", async () => {
    const started: Started[] = [];
    const setup = standIn(current, 'verbs', { started });
    const read = await designerRead(setup, 'formasample', { ...CLI, seconds: 300 });
    expect(read).toEqual({ connection: 'FormaSample', layout: SCHEMA_EXPORT, samples: null, unread: [], notFound: [] });
    expect(started.map((s) => s.args)).toEqual([
      ['sql-list', ...DESIGNER_SENTINEL],
      ['sql-schema', '--connection', 'FormaSample', '--seconds', '300', ...DESIGNER_SENTINEL],
    ]);
    calls(current);
    const both = await designerRead(setup, 'Sales', CLI, { objects: [{ schema: 'dbo', name: 'Orders' }, { schema: 'Sales', name: 'Order Lines' }], rows: 3 });
    // The stand-in's rows hold dbo.Orders and no Sales.Order Lines, which Forma Designer leaves out with no word when its
    // catalog lacks it: named as passed (the wave-7 review's W7-MCP-4).
    expect(both).toEqual({ connection: 'Sales', layout: SCHEMA_EXPORT, samples: SAMPLE_EXPORT, unread: [], notFound: ['Sales.Order Lines'] });
    expect(started.slice(2).map((s) => s.args)).toEqual([
      ['sql-list', ...DESIGNER_SENTINEL],
      ['sql-schema', '--connection', 'Sales', '--seconds', '120', ...DESIGNER_SENTINEL],
      ['sql-sample', '--connection', 'Sales', '--objects', 'dbo.Orders,Sales.Order Lines', '--rows', '3', '--seconds', '120', ...DESIGNER_SENTINEL],
    ]);
    calls(current);
  });

  it('keeps every name and value whole through the \\u escapes of its ASCII line', async () => {
    const exe = install('unicode', fakePe([1, 2, 0, 0]), [{ name: 'Shop', mode: 'windows', database: 'Shop' }]);
    const layout = SCHEMA_EXPORT.replace('"Customers"', '"\u0641\u0648\u0627\u062a\u064a\u0631 \u91d1\u984d Soci\u00e9t\u00e9 \ud83d\ude00"');
    writeFileSync(join(dirname(exe), 'layout.txt'), layout);
    expect((await designerRead(standIn(exe, 'verbs'), 'Shop', CLI)).layout).toBe(layout);
  });

  it('never starts an installed Forma Designer older than the verbs, or one whose version cannot be read, and says so', async () => {
    const old = install('old-install', fakePe([1, 1, 0, 0]));
    const started: Started[] = [];
    await expect(designerConnections(standIn(old, 'verbs', { started }), CLI)).rejects.toThrow(`Forma Designer 1.1.0 is installed, and reading a database through it needs Forma Designer ${DESIGNER_VERBS_SINCE} or later, so it was not started.`);
    const unreadable = install('unreadable', '#!/bin/sh\necho hi\n');
    await expect(designerConnections(standIn(unreadable, 'verbs', { started }), CLI)).rejects.toThrow(/^The version of ".*" cannot be read from the file, so it was not started/);
    // The seam answers for the reader too.
    await expect(designerConnections(standIn(current, 'verbs', { started, version: '1.0.0' }), CLI)).rejects.toThrow(/Forma Designer 1\.0\.0 is installed/);
    expect(started).toEqual([]);
    expect([...calls(old), ...calls(unreadable)]).toEqual([]);
  });

  it("starts FORMA_DESIGNER's copy built from source at 1.0.0 or later, since it says 1.1.0 until the owner packs it", async () => {
    const source = install('source-build', fakePe([1, 1, 0, 0]));
    expect(await designerConnections(standIn(source, 'verbs', { from: 'override' }), CLI)).toHaveLength(2);
    calls(source);
  });

  it('never starts a FORMA_DESIGNER copy older than 1.0.0, which has no --check to answer the sentinel, or one whose version cannot be read (R6-6)', async () => {
    expect(DESIGNER_CHECK_SINCE).toBe('1.0.0');
    const started: Started[] = [];
    // A build from before 2026-11-09: no AssemblyInfo.cs, so its file says 0.0.0.0, and no --check either.
    const ancient = install('ancient-source', fakePe([0, 0, 0, 0]));
    await expect(designerConnections(standIn(ancient, 'verbs', { from: 'override', started }), CLI)).rejects.toThrow(
      /^FORMA_DESIGNER names ".*", a Forma Designer 0\.0\.0, so it was not started: a Forma Designer older than 1\.0\.0 has no --check, which keeps one without the verbs from opening a window\. Name a RepxDesigner\.exe built from this clone's source\.$/,
    );
    const unreadable = install('unreadable-source', '#!/bin/sh\necho hi\n');
    await expect(designerConnections(standIn(unreadable, 'verbs', { from: 'override', started }), CLI)).rejects.toThrow(/^FORMA_DESIGNER names ".*", whose version cannot be read from the file, so it was not started/);
    await expect(designerConnections(standIn(current, 'verbs', { from: 'override', started, version: '0.9.9' }), CLI)).rejects.toThrow(/a Forma Designer 0\.9\.9, so it was not started/);
    expect(started).toEqual([]);
    expect([...calls(ancient), ...calls(unreadable)]).toEqual([]);
  });

  it('says a missing install or copy, a link and off Windows in words, starting nothing', async () => {
    const started: Started[] = [];
    const missing = join(scratch, 'no-install', 'RepxDesigner.exe');
    await expect(designerConnections(standIn(missing, 'verbs', { started }), CLI)).rejects.toThrow(`Forma Designer is not installed for this Windows user: there is no "${missing}". Reading a database through it needs Forma Designer ${DESIGNER_VERBS_SINCE} or later.`);
    await expect(designerConnections(standIn(missing, 'verbs', { started, from: 'override' }), CLI)).rejects.toThrow(`FORMA_DESIGNER names "${missing}", which is not there.`);
    await expect(designerConnections({ place: { ok: false, reason: 'Forma Designer runs on Windows, and this computer is not running Windows.' }, env: {} }, CLI)).rejects.toThrow(/^Forma Designer runs on Windows/);
    // A folder that is a link (a junction on Windows, which needs no administrator), and a program that is one where links can be made.
    const linked = join(scratch, 'linked-folder');
    symlinkSync(dirname(current), linked, 'junction');
    await expect(designerConnections(standIn(join(linked, 'RepxDesigner.exe'), 'verbs', { started }), CLI)).rejects.toThrow(/is a link, or in a folder that is one, so it was not started/);
    const fileLink = join(dirname(current), 'Linked.exe');
    let madeFileLink = true;
    try {
      symlinkSync(current, fileLink, 'file');
    } catch {
      madeFileLink = false; // Windows without the right to make one.
    }
    if (madeFileLink) await expect(designerConnections(standIn(fileLink, 'verbs', { started }), CLI)).rejects.toThrow(/is a link/);
    expect(started).toEqual([]);
    expect(calls(current)).toEqual([]);
  });

  it('refuses a connection or table name that could read as a switch, or that Forma Designer would refuse, before anything starts (SEC-2)', async () => {
    const started: Started[] = [];
    const setup = standIn(current, 'verbs', { started });
    for (const name of ['--install', '-x', '.hidden', 'has space', 'a;b', '', 'x'.repeat(129)]) {
      await expect(designerRead(setup, name, CLI), name).rejects.toMatchObject({ problem: 'usage' });
    }
    for (const objects of [[{ schema: 'dbo', name: '-x' }], [{ schema: 'a.b', name: 'c' }], [{ schema: 'dbo', name: 'a,b' }], [{ schema: 'dbo', name: '' }], []]) {
      await expect(designerRead(setup, 'FormaSample', CLI, { objects, rows: 2 }), JSON.stringify(objects)).rejects.toMatchObject({ problem: 'usage' });
    }
    await expect(designerRead(setup, 'FormaSample', CLI, { objects: [{ schema: 'dbo', name: 'A' }], rows: 51 })).rejects.toMatchObject({ problem: 'usage' });
    await expect(designerRead(setup, 'FormaSample', { ...CLI, seconds: 0 })).rejects.toMatchObject({ problem: 'usage' });
    expect(started).toEqual([]);
  });

  it('asks for no layout of a connection Forma Designer does not keep', async () => {
    const started: Started[] = [];
    const refused = await designerRead(standIn(current, 'verbs', { started }), 'Gone', CLI).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(DesignerRefusal);
    expect(refused).toMatchObject({ problem: 'not-kept', message: 'Forma Designer keeps no connection named Gone for this Windows user. Add it from its tray menu, SQL Server connections.' });
    expect(started.map((s) => s.args[0])).toEqual(['sql-list']);
    calls(current);
  });

  it('trusts its envelope before its exit code: an older build answering the sentinel with --check, a line of no JSON, a crash, another verb, done with a failing exit', async () => {
    const cases: [string, RegExp][] = [
      ['old', new RegExp(`answered as a Forma Designer older than ${DESIGNER_VERBS_SINCE.replace(/\./g, '\\.')} does, without the verbs that read a database, so nothing was read\\.$`)],
      ['garbage', /^Forma Designer's answer to list the connections it keeps is not the one line it gives \(it ended with exit code 0\), so nothing was read\.$/],
      ['crash', /is not the one line it gives \(it ended with exit code 255\)/],
    ];
    for (const [mode, said] of cases) await expect(designerConnections(standIn(current, mode), CLI), mode).rejects.toThrow(said);
    await expect(designerRead(standIn(current, 'wrong-verb'), 'FormaSample', CLI)).rejects.toThrow(/^Forma Designer's answer to read the layout of the connection FormaSample is not the one line it gives/);
    await expect(designerRead(standIn(current, 'mismatch'), 'FormaSample', CLI)).rejects.toThrow('Forma Designer said it could read the layout of the connection FormaSample, but ended with exit code 3, so nothing it printed was read.');
    calls(current);
  });

  it("says Forma Designer's own words for a failure, with its problem and SQL Server's number as data", async () => {
    const refused = await designerRead(standIn(current, 'sql-fail'), 'FormaSample', CLI).catch((e: unknown) => e);
    expect(refused).toMatchObject({ problem: 'sign-in', number: 18456, message: 'Forma Designer could not read the layout of the connection FormaSample: SQL Server refused the saved sign-in.' });
    calls(current);
  });

  it("never repeats what SQL Server's own words quote, which can be a row's value, even cut short (N6-3)", async () => {
    const refused = await designerRead(standIn(current, 'sql-245'), 'FormaSample', CLI).catch((e: unknown) => e);
    expect(refused).toMatchObject({ problem: 'sql', number: 245, message: "Forma Designer could not read the layout of the connection FormaSample: Conversion failed when converting the varchar value '...' to data type int." });
    const cut = await designerRead(standIn(current, 'failed-cut'), 'FormaSample', CLI).catch((e: unknown) => e);
    expect((cut as Error).message).toBe("Forma Designer could not read the layout of the connection FormaSample: InvalidOperationException: the value '...'");
    for (const e of [refused, cut]) expect((e as Error).message).not.toMatch(/Jane|Hidden/);
    // From the first quote to the last, so a value holding a quote goes whole; to the end when none closes it.
    expect(unquoted("The conversion of the varchar value 'O'Brien' overflowed an int column.")).toBe("The conversion of the varchar value '...' overflowed an int column.");
    expect(unquoted('Divide by zero error encountered.')).toBe('Divide by zero error encountered.');
    expect(unquoted("Invalid object name 'dbo.X'.")).toBe("Invalid object name '...'.");
    // Forma Designer does the same before it prints (Verbs.cs Unquoted), for any other caller.
    const verbs = readFileSync('tools/RepxDesigner/Verbs.cs', 'utf8');
    expect(verbs).toContain('f.Problem == "sql" || f.Problem == "failed" ? Unquoted(f.Words) : f.Words');
    calls(current);
  });

  it('names a table SQL Server could not sample by its number alone, the rest read (R6-2)', async () => {
    const read = await designerRead(standIn(current, 'unread'), 'FormaSample', CLI, { objects: [{ schema: 'dbo', name: 'Customers' }, { schema: 'dbo', name: 'RvBad' }], rows: 2 });
    expect(read.samples).toBe(SAMPLE_EXPORT);
    expect(read.unread).toEqual([{ object: 'dbo.RvBad', number: 8134 }, { object: 'dbo.vGone', number: 208 }, { object: 'dbo.Odd', number: null }]);
    // Neither among the rows nor unread: not in the database (W7-MCP-4), case aside for the rest.
    expect(read.notFound).toEqual(['dbo.Customers']);
    const cased = await designerRead(standIn(current, 'unread'), 'FormaSample', CLI, { objects: [{ schema: 'DBO', name: 'orders' }, { schema: 'dbo', name: 'rvbad' }], rows: 2 });
    expect(cased.notFound).toEqual([]);
    calls(current);
  });

  it('passes what it writes on stderr to the log alone, one line, its control characters out', async () => {
    const log: string[] = [];
    expect((await designerRead(standIn(current, 'stderr'), 'FormaSample', { ...CLI, log: (line) => log.push(line) })).layout).toBe(SCHEMA_EXPORT);
    expect(log).toEqual(['Forma Designer wrote on stderr: a line on stderr']);
    calls(current);
  });

  it('kills it past the byte cap, at the deadline, and on a stop, and it is gone each time (D2-5, D2-6)', { timeout: 30_000 }, async () => {
    const started: Started[] = [];
    await expect(designerConnections(standIn(current, 'huge', { started }), { ...CLI, maxOutput: 256 * 1024 })).rejects.toThrow(/answer to list the connections it keeps passed 0\.25 MB, so it was stopped and nothing was read\./);
    expect(await gone(started[0].child)).toBe(true);
    await expect(designerConnections(standIn(current, 'silent', { started }), { ...CLI, deadlineMs: 400 })).rejects.toThrow('Forma Designer did not list the connections it keeps within 1 second, so it was stopped and nothing was read.');
    expect(await gone(started[1].child)).toBe(true);
    // A stop while the layout is read: the call says it was stopped, and the child is ended with it.
    const stop = new AbortController();
    const reading = designerRead(standIn(current, 'schema-hang', { started }), 'FormaSample', { ...CLI, signal: stop.signal });
    while (started.length < 4) await new Promise((done) => setTimeout(done, 50));
    setTimeout(() => stop.abort(), 300);
    await expect(reading).rejects.toBeInstanceOf(CallStopped);
    expect(await gone(started[3].child)).toBe(true);
    // Stopped before it starts, it never starts.
    await expect(designerConnections(standIn(current, 'verbs', { started }), { ...CLI, signal: AbortSignal.abort() })).rejects.toBeInstanceOf(CallStopped);
    expect(started).toHaveLength(4);
    calls(current);
  });

  it('ends the call soon after the program exits or is killed, though a process it started holds its pipes open (N6-2)', { timeout: 60_000 }, async () => {
    expect(DRAIN_MS).toBeLessThanOrEqual(2_000);
    const holders = () => readdirSync(dirname(current)).filter((f) => /^grandchild-\d+\.pid$/.test(f));
    const reap = () => {
      for (const f of holders()) {
        const pid = Number(readFileSync(join(dirname(current), f), 'utf8'));
        try {
          process.kill(pid);
        } catch {
          // Gone already.
        }
        rmSync(join(dirname(current), f));
      }
    };
    try {
      // It answered and exited 0; the pipe is held for 15 seconds more, and the answer is read at once.
      let at = Date.now();
      expect(await designerConnections(standIn(current, 'grandchild'), CLI)).toHaveLength(2);
      expect(Date.now() - at).toBeLessThan(DRAIN_MS + 4_000);
      expect(holders()).toHaveLength(1);
      // Its deadline and a stop end the call within seconds, not when the holder lets go.
      at = Date.now();
      await expect(designerConnections(standIn(current, 'grandchild-hang'), { ...CLI, deadlineMs: 2_000 })).rejects.toThrow('Forma Designer did not list the connections it keeps within 2 seconds, so it was stopped and nothing was read.');
      expect(Date.now() - at).toBeLessThan(2_000 + DRAIN_MS + 4_000);
      expect(holders()).toHaveLength(2);
      const stop = new AbortController();
      at = Date.now();
      const stopped = designerConnections(standIn(current, 'grandchild-hang'), { ...CLI, signal: stop.signal });
      // Stopped once the holder is there.
      while (holders().length < 3 && Date.now() - at < 10_000) await new Promise((done) => setTimeout(done, 50));
      const asked = Date.now();
      stop.abort();
      await expect(stopped).rejects.toBeInstanceOf(CallStopped);
      expect(holders()).toHaveLength(3);
      expect(Date.now() - asked).toBeLessThan(DRAIN_MS + 4_000);
    } finally {
      reap();
      calls(current);
    }
  });

  it('says a program that cannot be started in words', async () => {
    const setup: DesignerSetup = { place: { ok: true, exe: current, from: 'override' }, env: ENTRY_ENV, start: (_file, args, options) => spawn(join(scratch, 'no-such-program'), [...args], options) };
    await expect(designerConnections(setup, CLI)).rejects.toThrow(/^Forma Designer could not be started to list the connections it keeps \(ENOENT\)\.$/);
  });

  it("holds its verbs, sentinel and exit codes to Forma Designer's own (Verbs.cs)", () => {
    const verbs = readFileSync('tools/RepxDesigner/Verbs.cs', 'utf8');
    expect(/Names = \{ ([^}]*) \}/.exec(verbs)![1]).toBe(DESIGNER_VERBS.map((v) => `"${v}"`).join(', '));
    expect(/Sentinel = \{ ([^}]*) \}/.exec(verbs)![1]).toBe(DESIGNER_SENTINEL.map((v) => `"${v}"`).join(', '));
    const exits = Object.fromEntries([...verbs.matchAll(/public const int (\w+) = (\d+);/g)].map((m) => [m[1], Number(m[2])]));
    expect({ done: exits.Done, usage: exits.Usage, notKept: exits.NotKept, sqlFailed: exits.SqlFailed, deadline: exits.DeadlinePassed }).toEqual(DESIGNER_EXIT);
    expect({ seconds: exits.DefaultSeconds, max: exits.MaxSeconds, rows: exits.MaxRows, objects: exits.MaxObjects }).toEqual({ seconds: 120, max: 3600, rows: 50, objects: 20 });
    // The per-user install is where Installer.cs puts it.
    expect(readFileSync('tools/RepxDesigner/Installer.cs', 'utf8')).toContain('Environment.SpecialFolder.LocalApplicationData), @"Programs\\Forma Designer")');
  });
});

/* ------------------------------------------------------------ the command line */

/** A key of AI Studio's form, built at run time (TST-10). */
const geminiKey = ['AI', 'za', 'Sy'].join('') + 'D'.repeat(33);
const redact = redactorFor([geminiKey], FORMA_KEYS);
/** An AI set up, for the gate, and one that cannot leave this computer, chosen beside the mock. */
const AI: AiEnv = { FORMA_GEMINI_KEY: geminiKey, FORMA_PROVIDER: 'local', FORMA_LOCAL_MODEL: 'forma-test-model', FORMA_LOCAL_URL: 'http://127.0.0.1:1/v1' };
const NEVER: GenHooks = {
  ask: async () => {
    throw new Error('the AI must not be asked');
  },
  chat: async () => {
    throw new Error('the AI must not be asked');
  },
};

/** An AI's design that records the database section it was shown and answers as the mock, never a request. */
function recording(seen: (string | undefined)[], query?: unknown): GenHooks {
  return {
    ...NEVER,
    ask: async (_prompt, _parts, _config, previous, _signal, _onProgress, options) => {
      seen.push(options?.database);
      const answer = mockAnswer('true', previous, options);
      return (query === undefined ? answer : { ...answer, dataQuery: query }) as never;
    },
  };
}

/** A report whose Detail band prints `fields`, bound to nothing yet. */
const report = (fields: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>${fields.map((f, i) => `<Item${i + 1} Ref="${10 + i}" ControlType="XRLabel" Name="label${f}" Text="${f}" Font="Arial, 9pt" LocationFloat="${i * 150}, 0" SizeF="150, 23" Dpi="100"><ExpressionBindings><Item1 Ref="${30 + i}" EventName="BeforePrint" PropertyName="Text" Expression="[${f}]" /></ExpressionBindings></Item${i + 1}>`).join('')}</Controls></Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

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

let folders = 0;
function folder(): string {
  const dir = join(scratch, `cli-${++folders}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `main` as the entry calls it, Forma Designer the stand-in, the work in this thread, the AI stood in by `hooks`. */
async function cli(argv: string[], o: { cwd: string; designer?: DesignerSetup; env?: AiEnv; hooks?: GenHooks; signal?: AbortSignal; err?: (line: string) => void }) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: o.cwd,
    aiEnv: o.env ?? {},
    out: (text) => out.push(text),
    err: (line) => {
      err.push(line);
      o.err?.(line);
    },
    redact,
    signal: o.signal ?? new AbortController().signal,
    pipeline: () => inThread,
    generator: (setup, log) => inThreadGenerator({ ...setup, userFolder, paddleModels: null }, { log, ...o.hooks }),
    userFolder,
    sleep: async () => {},
    ...(o.designer ? { designer: o.designer } : {}),
  };
  const code = await main(argv, io);
  const text = out.join('');
  const lines = text.split('\n').filter(Boolean);
  return { code, out: text, err: err.join('\n'), lines, json: () => lines.map((l) => JSON.parse(l) as Record<string, any>) };
}

describe("the command line's connections and --connection", () => {
  it('reads --connection, --sample-objects and --rows, and refuses what does not go together as a usage error', () => {
    expect(parseArgs(['generate', 'a.png', '--connection', 'Sales', '--sample-objects', 'dbo.Orders,[Sales].[Order Lines]', '--rows', '3', '--samples', 's.txt'])).toMatchObject({
      options: { connection: 'Sales', sampleObjects: [{ schema: 'dbo', name: 'Orders' }, { schema: 'Sales', name: 'Order Lines' }], rows: 3, samples: ['s.txt'] },
    });
    expect(parseArgs(['bind', 'r.repx', '--connection', 'Sales', '--object', 'dbo.Orders', '--connection-name', 'ShopLive'])).toMatchObject({ options: { connection: 'Sales', connectionName: 'ShopLive' } });
    expect(parseArgs(['connections'])).toMatchObject({ kind: 'run', inputs: [] });
    const refused: [string[], RegExp][] = [
      [['generate', 'a.png', '--database', 'd.txt', '--connection', 'Sales'], /^--database and --connection each give the database the report reads/],
      [['generate', 'a.png', '--connection', '--install'], /^--connection needs a value after it\./],
      [['generate', 'a.png', '--sample-objects', 'dbo.A'], /^--sample-objects goes with --connection/],
      [['generate', 'a.png', '--connection', 'S', '--rows', '3'], /^--rows goes with --sample-objects/],
      [['generate', 'a.png', '--connection', 'S', '--sample-objects', 'dbo.A', '--rows', '11'], /^--rows with --sample-objects takes a whole number of rows from 1 to 10, the most of each Forma keeps\./],
      [['generate', 'a.png', '--connection', 'S', '--sample-objects', Array.from({ length: 21 }, (_, i) => `dbo.T${i}`).join(',')], /^--sample-objects names 21 tables or views; Forma Designer reads at most 20 at a time\./],
      [['generate', 'a.png', '--connection', 'S', '--sample-objects', 'a.b.c'], /^--sample-objects names tables or views as schema\.name/],
      [['bind', 'r.repx', '--object', 'dbo.A'], /^--object goes with --database or --connection/],
      [['bind', 'r.repx', '--connection', 'S', '--object', 'x', '--sample-objects', 'dbo.A'], /^--sample-objects is not an option of bind\./],
      [['connections', 'x.repx'], /^connections takes no file; one was named\./],
      [['audit', 'r.repx', '--connection', 'S'], /^--connection is not an option of audit\./],
    ];
    for (const [argv, said] of refused) expect(() => parseArgs(argv), argv.join(' ')).toThrow(said);
  });

  it('connections lists the names Forma Designer keeps, each with its database and sign-in, and needs no AI', async () => {
    const dir = folder();
    const ran = await cli(['connections'], { cwd: dir, designer: standIn(current, 'verbs') });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.lines).toEqual(['connection FormaSample: database FormaSample, signing in with Windows', 'connection Sales: database ERP_Prod, signing in with a saved SQL Server login']);
    const json = await cli(['connections', '--json'], { cwd: dir, designer: standIn(current, 'verbs') });
    expect(json.json()[0]).toMatchObject({ type: 'input', command: 'connections', status: 'done', connections: [{ name: 'FormaSample', signIn: 'windows', database: 'FormaSample' }, { name: 'Sales', signIn: 'login', database: 'ERP_Prod' }] });
    calls(current);
    const none = install('none-kept', fakePe([1, 2, 0, 0]), []);
    expect((await cli(['connections'], { cwd: dir, designer: standIn(none, 'verbs') })).lines).toEqual(['Forma Designer keeps no SQL Server connection for this Windows user. Add one from its tray menu, SQL Server connections.']);
    calls(none);
  });

  it('connections says which name an older Forma Designer kept that --connection cannot name, and how to rename it, and --connection says so too (N6-6)', async () => {
    const dir = folder();
    const older = install('older-names', fakePe([1, 2, 0, 0]), [{ name: '.old', mode: 'windows', database: 'Shop' }, { name: 'Shop', mode: 'login', database: 'Shop' }]);
    const listed = await cli(['connections'], { cwd: dir, designer: standIn(older, 'verbs') });
    expect(listed.code, listed.err).toBe(EXIT.done);
    expect(listed.lines).toEqual(['connection .old: database Shop, signing in with Windows; its name begins with . or -, so --connection cannot name it', 'connection Shop: database Shop, signing in with a saved SQL Server login']);
    expect(listed.err).toContain(`A connection whose name begins with . or - was kept by an older Forma Designer. ${RENAME_TO_USE}`);
    const json = await cli(['connections', '--json'], { cwd: dir, designer: standIn(older, 'verbs') });
    expect(json.json()[0].connections).toEqual([
      { name: '.old', signIn: 'windows', database: 'Shop', usable: false },
      { name: 'Shop', signIn: 'login', database: 'Shop', usable: true },
    ]);
    calls(older);
    const refused = await cli(['bind', 'r.repx', '--connection', '.old', '--object', 'dbo.Customers'], { cwd: dir, designer: standIn(older, 'verbs') });
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.err).toContain(`".old" is not one. A connection kept under such a name by an older Forma Designer cannot be read until it is renamed: ${RENAME_TO_USE}`);
    expect(calls(older)).toEqual([]);
    // The SQL Server connections window says the rule in the verbs' words, and marks such a name (R6-5).
    const form = readFileSync('tools/RepxDesigner/ConnectionsForm.cs', 'utf8');
    expect(form).toContain('_status.Text = Verbs.NameRule');
    expect(form).toContain('unusable: add it again under a name that begins with a letter, a digit or _');
  });

  it('connections says, exit 4, when Forma Designer is not on Windows, not installed or too old', async () => {
    const dir = folder();
    const off = await cli(['connections'], { cwd: dir, designer: { place: designerPlace({ platform: 'linux' }) as DesignerSetup['place'], env: {} } });
    expect(off.code).toBe(EXIT.failed);
    expect(off.err).toContain('Forma Designer runs on Windows, and this computer is not running Windows.');
    const old = install('cli-old', fakePe([1, 1, 0, 0]));
    const tooOld = await cli(['connections'], { cwd: dir, designer: standIn(old, 'verbs') });
    expect(tooOld.code).toBe(EXIT.failed);
    expect(tooOld.err).toContain(`Forma Designer 1.1.0 is installed, and reading a database through it needs Forma Designer ${DESIGNER_VERBS_SINCE} or later`);
    expect(calls(old)).toEqual([]);
    expect((await cli(['connections'], { cwd: dir })).code).toBe(EXIT.failed);
  });

  it("bind --connection binds to the connection's layout with no AI, writing the name Forma Designer keeps, not the database's (D2-10)", async () => {
    const shop = install('shop', fakePe([1, 2, 0, 0]), [{ name: 'ShopLive', mode: 'windows', database: 'FormaSample' }]);
    const dir = folder();
    writeFileSync(join(dir, 'r.repx'), report(['CompanyName', 'City']));
    const ran = await cli(['bind', 'r.repx', '--connection', 'shoplive', '--object', 'dbo.Customers', '--json'], { cwd: dir, designer: standIn(shop, 'verbs') });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.err).toContain('Reading the layout of the connection shoplive through Forma Designer, within 10 minutes for each.');
    expect(ran.err).toContain('Database layout read from "ShopLive in Forma Designer": FormaSample:');
    expect(ran.json()[0]).toMatchObject({ status: 'done', binding: { bound: true, database: 'FormaSample', query: { table: 'dbo.Customers' }, connection: 'ShopLive' } });
    const ds = readRepxDataSources(readFileSync(join(dir, 'r.bound.repx'), 'utf8'))[0];
    expect(ds.connectionName).toBe('ShopLive');
    expect(calls(shop).map((c) => c.args[0])).toEqual(['sql-list', 'sql-schema']);
    // --connection-name names another, as with a layout file.
    const named = await cli(['bind', 'r.repx', '--connection', 'ShopLive', '--object', 'dbo.Customers', '--connection-name', 'Reporting', '--out', 'n.repx'], { cwd: dir, designer: standIn(shop, 'verbs') });
    expect(named.code, named.err).toBe(EXIT.done);
    expect(readRepxDataSources(readFileSync(join(dir, 'n.repx'), 'utf8'))[0].connectionName).toBe('Reporting');
    calls(shop);
  });

  it('generate --connection sends the layout, and sample values only for the tables named, never printing one (OC6)', { timeout: 120_000 }, async () => {
    const dir = folder();
    writeFileSync(join(dir, 'a.png'), titlePng('TOTALS'));
    const withRows: (string | undefined)[] = [];
    const sent = await cli(['generate', 'a.png', '--mock', '--connection', 'FormaSample', '--sample-objects', 'dbo.Orders,dbo.vOrderTotals', '--rows', '2', '--object', 'dbo.vOrderTotals', '--json'], {
      cwd: dir,
      env: AI,
      designer: standIn(current, 'verbs'),
      hooks: recording(withRows),
    });
    expect(sent.code, sent.err).toBe(EXIT.done);
    expect(withRows[0]).toContain('Example Traders');
    expect(sent.err).toContain('Reading the layout of the connection FormaSample, and 2 rows of each of dbo.Orders, dbo.vOrderTotals, whose values go to the AI with it, through Forma Designer');
    expect(sent.err).toContain('Sample rows read for FormaSample from "FormaSample in Forma Designer": dbo.Orders (3 rows), dbo.vOrderTotals (3 rows).');
    for (const text of [sent.out, sent.err]) expect(text).not.toMatch(/Example Traders|Sample Goods|Demo Supplies/);
    expect(sent.json()[0]).toMatchObject({ status: 'done', binding: { bound: true, connection: 'FormaSample' } });
    const started = calls(current);
    expect(started.map((c) => c.args)).toEqual([
      ['sql-list', ...DESIGNER_SENTINEL],
      ['sql-schema', '--connection', 'FormaSample', '--seconds', '600', ...DESIGNER_SENTINEL],
      ['sql-sample', '--connection', 'FormaSample', '--objects', 'dbo.Orders,dbo.vOrderTotals', '--rows', '2', '--seconds', '600', ...DESIGNER_SENTINEL],
    ]);
    // Without --sample-objects, only names go, and no row is read.
    const names: (string | undefined)[] = [];
    const none = await cli(['generate', 'a.png', '--mock', '--connection', 'FormaSample', '--object', 'dbo.vOrderTotals', '--out', 'b.repx'], { cwd: dir, env: AI, designer: standIn(current, 'verbs'), hooks: recording(names) });
    expect(none.code, none.err).toBe(EXIT.done);
    expect(names[0]).toContain('- dbo.vOrderTotals (view)');
    expect(names[0]).not.toMatch(/Example Traders|Sample Goods|Demo Supplies/);
    expect(calls(current).map((c) => c.args[0])).toEqual(['sql-list', 'sql-schema']);
  });

  it('says a table SQL Server could not sample by name and number, and goes on with the rest (R6-2)', { timeout: 120_000 }, async () => {
    const dir = folder();
    writeFileSync(join(dir, 'a.png'), titlePng('TOTALS'));
    const seen: (string | undefined)[] = [];
    const ran = await cli(['generate', 'a.png', '--mock', '--connection', 'FormaSample', '--sample-objects', 'dbo.Orders,dbo.RvBad,dbo.NoSuch', '--object', 'dbo.vOrderTotals'], { cwd: dir, env: AI, designer: standIn(current, 'unread'), hooks: recording(seen) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.err).toContain('SQL Server could not read sample rows of dbo.RvBad (its error 8134), so its rows were left out.');
    expect(ran.err).toContain('SQL Server could not read sample rows of dbo.Odd, so its rows were left out.');
    // One the database does not have, which Forma Designer leaves out with no word (W7-MCP-4).
    expect(ran.err).toContain('The database has no table or view named dbo.NoSuch, so no rows of it were read.');
    expect(ran.err).not.toContain('named dbo.Orders');
    expect(seen[0]).toContain('Example Traders');
    calls(current);
  });

  it('refuses before anything else is read, the AI never asked and nothing written: a name kept nowhere, a name that is no name, no AI set up', async () => {
    const dir = folder();
    writeFileSync(join(dir, 'a.png'), titlePng('INVOICE'));
    const gone = await cli(['generate', 'a.png', '--mock', '--connection', 'Gone'], { cwd: dir, env: AI, designer: standIn(current, 'verbs'), hooks: NEVER });
    expect(gone.code).toBe(EXIT.failed);
    expect(gone.err).toContain('Forma Designer keeps no connection named Gone for this Windows user. Add it from its tray menu, SQL Server connections.');
    expect(calls(current).map((c) => c.args[0])).toEqual(['sql-list']);
    const odd = await cli(['generate', 'a.png', '--mock', '--connection=-install'], { cwd: dir, env: AI, designer: standIn(current, 'verbs'), hooks: NEVER });
    expect(odd.code).toBe(EXIT.usage);
    expect(odd.err).toMatch(/^--connection names a connection Forma Designer keeps, whose name begins with a letter, a digit or _/);
    // No AI set up: the gate first, so Forma Designer is never started for a run that cannot use what it reads.
    expect((await cli(['generate', 'a.png', '--connection', 'FormaSample'], { cwd: dir, designer: standIn(current, 'verbs') })).code).toBe(EXIT.noAi);
    expect(calls(current)).toEqual([]);
    // Off Windows, the way on is a layout file.
    const off = await cli(['bind', 'r.repx', '--connection', 'FormaSample', '--object', 'dbo.Customers'], { cwd: dir, designer: { place: designerPlace({ platform: 'darwin' }) as DesignerSetup['place'], env: {} } });
    expect(off.code).toBe(EXIT.failed);
    expect(off.err).toContain("Forma Designer runs on Windows, and this computer is not running Windows. Give the database's layout as a file with --database instead: sql-script prints the script that reads it.");
    expect(readdirSync(dir).sort()).toEqual(['a.png']);
  });

  it('batch reads the connection once, after its plan, and --dry-run starts nothing', { timeout: 120_000 }, async () => {
    const dir = folder();
    mkdirSync(join(dir, 'in'));
    writeFileSync(join(dir, 'in', 'a.png'), titlePng('CUSTOMERS'));
    const planned = await cli(['batch', 'in', '--out', 'out', '--connection', 'FormaSample', '--dry-run'], { cwd: dir, env: AI, designer: standIn(current, 'verbs') });
    expect(planned.code, planned.err).toBe(EXIT.done);
    expect(calls(current)).toEqual([]);
    const ran = await cli(['batch', 'in', '--out', 'out', '--mock', '--connection', 'FormaSample', '--object', 'dbo.Customers', '--json'], { cwd: dir, env: AI, designer: standIn(current, 'verbs'), hooks: recording([]) });
    expect(ran.code, ran.err).toBe(EXIT.done);
    expect(ran.json().at(-1)).toMatchObject({ type: 'summary', binding: { bound: 1, unbound: 0 } });
    expect(calls(current).map((c) => c.args[0])).toEqual(['sql-list', 'sql-schema']);
  });

  it('a stop while Forma Designer reads ends it, exit 130, nothing written', { timeout: 30_000 }, async () => {
    const dir = folder();
    writeFileSync(join(dir, 'r.repx'), report(['CompanyName']));
    const stop = new AbortController();
    const started: Started[] = [];
    const ran = await cli(['bind', 'r.repx', '--connection', 'FormaSample', '--object', 'dbo.Customers'], {
      cwd: dir,
      designer: standIn(current, 'schema-hang', { started }),
      signal: stop.signal,
      err: (line) => {
        if (line.startsWith('Reading the layout')) setTimeout(() => stop.abort(), 500);
      },
    });
    expect(ran.code).toBe(EXIT.interrupted);
    expect(started).toHaveLength(2);
    expect(await gone(started[1].child)).toBe(true);
    expect(readdirSync(dir)).toEqual(['r.repx']);
    calls(current);
  });
});
