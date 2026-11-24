/**
 * The command line's batch plan (2026-11-24, the CLI and Forma Designer
 * work's wave 4; findings CLI-5, SEC-1, GAP1-3, GAP1-4, GAP3-3 and CLI-12 of
 * its design audit, the owner's OC2 and OC5): folderBatch.ts's walk, routes,
 * names and limit rule, with a folder of the test's own in memory on both
 * platforms' path rules (so the Windows cases run on CI's Linux), and on the
 * real disk with a link and a junction leading out of the folder, which the
 * walk must never follow (SEC-1: Node's recursive readdir does). No file is
 * read here; no AI is asked.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { stopsTheBatch } from '../lib/batchCheckpoint';
import { BATCH_DEPTH, KEY_REFUSED, LIMIT_WAIT_MS, OUTPUT_SUFFIXES, afterLimit, endsTheBatch, isFormaOutput, kindOf, planBatch, routeOf, skipWords, walkBatch, type ListFolder, type ListedEntry } from './folderBatch';

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_WORK = resolve(CLONE, '..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const scratch = realpathSync.native(mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'folder-batch-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A folder tree in memory: each folder's entries, by its full path; a name ending in '/' a folder, '@' a link, else a file. */
function listing(tree: Record<string, string[]>): ListFolder & { listed: string[] } {
  const listed: string[] = [];
  const list = ((dir: string) => {
    listed.push(dir);
    const names = tree[dir];
    if (!names) throw Object.assign(new Error(`EACCES: ${dir}`), { code: 'EACCES' });
    return names.map((raw): ListedEntry => {
      const link = raw.endsWith('@');
      const folder = raw.endsWith('/');
      const name = raw.replace(/[/@]$/, '');
      return { name, file: !link && !folder, folder, link };
    });
  }) as ListFolder & { listed: string[] };
  list.listed = listed;
  return list;
}

describe('the walk', () => {
  for (const [platform, path, root] of [
    ['win32', win32, 'C:\\work\\reports'],
    ['posix', posix, '/home/me/reports'],
  ] as const) {
    it(`takes report sources level by level and leaves out links, dot-folders, node_modules, the --out folder, Forma's outputs and other files (${platform})`, () => {
      const j = (...parts: string[]) => path.join(root, ...parts);
      const list = listing({
        [root]: ['b.png', 'a.pdf', 'Invoice (1).repx', 'x.generated.repx', 'x.revised (2).repx', 'y.repaired.vsrepx', 'z.repx.forma-partial-ab12cd', 'data.csv', 'notes.txt', '.env', 'away@', 'sub/', '.git/', 'node_modules/', 'out/', 'locked/'],
        [j('sub')]: ['c.rdl', 'deeper/', 'shortcut.rdl@', 'Thumbs.db'],
        [j('sub', 'deeper')]: ['d.frx', 'e.docx', 'f.rpt'],
        [j('.git')]: ['never.repx'],
        [j('node_modules')]: ['never.png'],
        [j('out')]: ['never.generated.repx', 'made-by-a-person.png'],
      });
      const walked = walkBatch(root, { path, list, skip: [j('out')] });
      expect(walked.files).toEqual([j('a.pdf'), j('b.png'), j('Invoice (1).repx'), j('sub', 'c.rdl'), j('sub', 'deeper', 'd.frx'), j('sub', 'deeper', 'e.docx'), j('sub', 'deeper', 'f.rpt')]);
      expect(walked.links).toEqual([j('away'), j('sub', 'shortcut.rdl')]);
      expect(walked.outputs).toBe(4);
      expect(walked.other).toBe(4);
      expect(walked.unreadable).toEqual([j('locked')]);
      // Neither a dot-folder, node_modules nor the out folder was ever listed, and no link was gone through.
      expect(list.listed.sort()).toEqual([root, j('locked'), j('sub'), j('sub', 'deeper')].sort());
    });
  }

  it(`opens no folder deeper than ${BATCH_DEPTH} levels, browser Batch's depth, and says which`, () => {
    const tree: Record<string, string[]> = {};
    let dir = '/r';
    for (let level = 0; level <= BATCH_DEPTH + 1; level++) {
      tree[dir] = [`p${level}.png`, 'next/'];
      dir = posix.join(dir, 'next');
    }
    const walked = walkBatch('/r', { path: posix, list: listing(tree) });
    expect(walked.files).toHaveLength(BATCH_DEPTH + 1);
    expect(walked.deep).toEqual([posix.join('/r', ...Array(BATCH_DEPTH + 1).fill('next'))]);
  });

  it('never follows a link or a junction out of the folder on the real disk, where Node\'s recursive readdir does', () => {
    const outside = join(scratch, 'outside');
    mkdirSync(join(outside, 'deep'), { recursive: true });
    writeFileSync(join(outside, 'deep', 'secret-invoice.png'), 'x');
    writeFileSync(join(outside, 'environ.txt'), 'FORMA_GEMINI_KEY=a-stand-in');
    const root = join(scratch, 'batch');
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(join(root, 'reports', 'a.png'), 'x');
    // A junction on Windows (no privilege needed), a directory link elsewhere: a checkout can carry either (SEC-1).
    symlinkSync(outside, join(root, 'reports', 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    let fileLink = false;
    try {
      // A file link named as a report source, as a pull request on Linux can carry one (x.rdl -> /proc/self/environ).
      symlinkSync(join(outside, 'environ.txt'), join(root, 'reports', 'x.rdl'), 'file');
      fileLink = true;
    } catch {
      // Windows refuses a file link without the privilege to make one; the junction above still holds the rule there.
    }
    // The shape the design audit measured on Windows: the naive walk goes through the junction. (On Linux a file link is the
    // danger: listed by name, then followed by whatever reads it, which the walk below never hands on.)
    if (process.platform === 'win32') expect(readdirSync(root, { recursive: true }).map(String).some((p) => p.includes('secret-invoice'))).toBe(true);
    const walked = walkBatch(root, { path: process.platform === 'win32' ? win32 : posix });
    expect(walked.files).toEqual([join(root, 'reports', 'a.png')]);
    expect(walked.links.sort()).toEqual([join(root, 'reports', 'jn'), ...(fileLink ? [join(root, 'reports', 'x.rdl')] : [])].sort());
  });
});

describe('the names a batch never takes as its inputs', () => {
  it("recognises every name Forma writes, with a copy's counter, and a write's temporary file; never a person's own copy", () => {
    for (const suffix of OUTPUT_SUFFIXES) {
      expect(isFormaOutput(`invoice.${suffix}.repx`), suffix).toBe(true);
      expect(isFormaOutput(`Invoice.${suffix.toUpperCase()}.VSREPX`), suffix).toBe(true);
      expect(isFormaOutput(`invoice.${suffix} (12).repx`), suffix).toBe(true);
      expect(isFormaOutput(`invoice.pdf.${suffix}.repx`), suffix).toBe(true);
    }
    expect(isFormaOutput('invoice.repx.forma-partial-x1y2z3')).toBe(true);
    for (const own of ['invoice.repx', 'Invoice (1).repx', 'generated.repx', 'invoice.generated.pdf', 'my.generated report.repx']) expect(isFormaOutput(own), own).toBe(false);
  });
});

describe('the routes', () => {
  it('reads a kind from the name alone, and routes it by what was asked', () => {
    expect(['a.PNG', 'b.jpeg', 'c.tif', 'd.heic', 'e.pdf', 'f.repx', 'g.vsrepx', 'h.rdl', 'i.RDLC', 'j.frx', 'k.docx', 'l.xlsx', 'm.rpt', 'n.csv', 'o.json', 'p'].map(kindOf)).toEqual([
      'picture',
      'picture',
      'picture',
      'picture',
      'pdf',
      'report',
      'report',
      'foreign',
      'foreign',
      'foreign',
      'template',
      'template',
      'crystal',
      null,
      null,
      null,
    ]);
    const none = { words: false, repair: false };
    expect(routeOf('picture', none)).toEqual({ route: 'generate' });
    expect(routeOf('pdf', { words: true, repair: true })).toEqual({ route: 'generate' });
    expect(routeOf('report', none)).toEqual({ route: 'skip', skip: 'nothing asked' });
    expect(routeOf('report', { words: false, repair: true })).toEqual({ route: 'repair' });
    expect(routeOf('report', { words: true, repair: true })).toEqual({ route: 'revise' });
    expect(routeOf('foreign', none)).toEqual({ route: 'convert' });
    expect(routeOf('foreign', { words: true, repair: false })).toEqual({ route: 'convert-revise' });
    expect(routeOf('template', { words: true, repair: true })).toEqual({ route: 'skip', skip: 'template' });
    expect(routeOf('crystal', none)).toEqual({ route: 'skip', skip: 'crystal' });
    expect(skipWords('nothing asked', 'r.repx')).toMatch(/^"r\.repx" is a report, and nothing was asked of it: give --words to change it, or --repair/);
    expect(skipWords('crystal', 'c.rpt')).toMatch(/export it as a PDF \(File > Export\)/);
  });
});

describe('the names a batch writes, decided before the run', () => {
  const root = 'C:\\in';
  const out = 'C:\\out';
  const at = (...p: string[]) => win32.join(root, ...p);
  const plan = (files: string[], asked = { words: false, repair: false, allowStandIn: false }) => planBatch(files.map((f) => at(...f.split('/'))), root, out, win32, asked);

  it('writes each under --out, its subfolder kept, with its route\'s suffix', () => {
    const items = plan(['a.png', 'sub/b.rdl', 'sub/deeper/c.repx', 'd.xlsx'], { words: false, repair: true, allowStandIn: false });
    expect(items.map((i) => [i.rel, i.route, i.needsAi, i.target])).toEqual([
      ['a.png', 'generate', true, 'C:\\out\\a.generated.repx'],
      ['sub\\b.rdl', 'convert', false, 'C:\\out\\sub\\b.converted.repx'],
      ['sub\\deeper\\c.repx', 'repair', false, 'C:\\out\\sub\\deeper\\c.repaired.repx'],
      ['d.xlsx', 'skip', false, null],
    ]);
    expect(items[3].skip).toBe('template');
  });

  it('keeps both extensions when two inputs would claim one name, whichever comes first, and the draft each may write', () => {
    const items = plan(['invoice.png', 'invoice.PDF', 'other.png', 'invoice.rdl'], { words: true, repair: false, allowStandIn: true });
    expect(items.map((i) => [i.target, i.draft])).toEqual([
      ['C:\\out\\invoice.png.generated.repx', 'C:\\out\\invoice.png.draft.repx'],
      ['C:\\out\\invoice.PDF.generated.repx', 'C:\\out\\invoice.PDF.draft.repx'],
      ['C:\\out\\other.generated.repx', 'C:\\out\\other.draft.repx'],
      // Its draft's name would have been invoice.draft.repx, as the pictures' were: so it keeps its extension too.
      ['C:\\out\\invoice.rdl.revised.repx', 'C:\\out\\invoice.rdl.draft.repx'],
    ]);
    // Two that the same disk takes for one name, even with their extensions kept, are each a row that says so.
    const twice = plan(['a.png', 'A.PNG']);
    expect(twice.map((i) => [i.route, i.skip, i.target])).toEqual([
      ['skip', 'same name', null],
      ['skip', 'same name', null],
    ]);
    // A report revised and its .vsrepx twin keep theirs; files in different folders never meet.
    expect(plan(['r.repx', 'r.vsrepx', 'x/r.repx'], { words: true, repair: false, allowStandIn: false }).map((i) => i.target)).toEqual([
      'C:\\out\\r.repx.revised.repx',
      'C:\\out\\r.vsrepx.revised.repx',
      'C:\\out\\x\\r.revised.repx',
    ]);
  });
});

describe('what a batch does at a limit', () => {
  it("waits a minute's out (its wait, or a fixed one) and makes the file once more; stops at the day's, one past ten minutes, or a second", () => {
    expect(afterLimit({ kind: 'per-minute', waitMs: 41_000, provider: 'gemini' }, false, false)).toEqual({ stop: false, waitMs: 42_000, retry: true });
    expect(afterLimit({ kind: 'unknown', waitMs: null, provider: 'openrouter' }, false, false)).toEqual({ stop: false, waitMs: LIMIT_WAIT_MS + 1000, retry: true });
    expect(afterLimit({ kind: 'per-minute', waitMs: 41_000, provider: 'gemini' }, false, true)).toEqual({ stop: true });
    expect(afterLimit({ kind: 'daily', waitMs: 3_600_000, provider: 'gemini' }, false, false)).toEqual({ stop: true });
    expect(afterLimit({ kind: 'unknown', waitMs: 11 * 60_000, provider: 'gemini' }, false, false)).toEqual({ stop: true });
    // A report written though a later step met the minute's limit: no second try, a wait before the next file.
    expect(afterLimit({ kind: 'per-minute', waitMs: 5000, provider: 'gemini' }, true, false)).toEqual({ stop: false, waitMs: 6000, retry: false });
    expect(afterLimit({ kind: 'daily', waitMs: null, provider: 'gemini' }, true, false)).toEqual({ stop: true });
    expect(endsTheBatch({ kind: 'per-minute', waitMs: 10 * 60_000, provider: 'gemini' })).toBe(false);
  });

  it("stops at the AI refusing the key as browser Batch does, by the same words", () => {
    for (const message of [
      'No report was made: Your API key is not valid. Check it in Settings.',
      'No report was made: Permission denied for this key.',
      'No report was made: The AI rejected the key.',
      'No report was made: The AI did not answer in time.',
      'No report was made: The model answered with nothing.',
    ]) {
      expect(KEY_REFUSED.test(message), message).toBe(stopsTheBatch(message, false) === 'key');
    }
  });
});
