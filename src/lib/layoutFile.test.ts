/**
 * A database's layout read from a file (2026-11-24, the CLI and Forma
 * Designer work's wave 5; findings D1-8, D1-3, D1-4, D1-1 and D1-12 of its
 * design audit): lib/layoutFile.ts. The files are written here, from the
 * FormaSample captures (sqlFixtures.ts, real engine output over a made-up
 * database), in each form a layout reaches Forma in, and read back from disk,
 * so the reading of a file is what is tested: UTF-8 with and without a byte
 * order mark, UTF-16LE with one (sqlcmd's `-u`, Windows PowerShell's `>`),
 * UTF-16BE, UTF-16 without one, Latin-1, cut short, and a layout and its
 * sample rows in one file. They are written into the owner's work folder
 * beside the repository where it exists, else the system's, and removed.
 *
 * And the layout among a report's files (`stepFromFiles`, D1-1): the step
 * built from it when none was handed in, and every other case said.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { layoutFromFile, MAX_LAYOUT_BYTES, stepFromFiles, type FoundDatabase } from './layoutFile';
import { EMITTED_REPX, SAMPLE_EXPORT, SCHEMA_EXPORT } from './sqlFixtures';
import { readDatabaseText, readSampleExport, readSchemaExport } from './sqlSchema';
import { SCHEMA_SCRIPT } from './sqlSchemaScript';

const OWNER_WORK = resolve('..', 'forma-model-data-kept-not-in-git', 'forma-model-data', 'work');
const folder = mkdtempSync(join(existsSync(OWNER_WORK) ? OWNER_WORK : tmpdir(), 'layout-file-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** A file written in this folder, and its bytes read back from disk. */
function file(name: string, bytes: Buffer): { bytes: Uint8Array; name: string } {
  const path = join(folder, name);
  writeFileSync(path, bytes);
  return { bytes: new Uint8Array(readFileSync(path)), name: path };
}

const utf8 = (text: string) => Buffer.from(text, 'utf8');
const utf8Mark = (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(text)]);
const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
const SAID = 'Database layout read from "forma-schema.txt": FormaSample: 3 tables, 1 view, 5 procedures (1 whose result cannot be read: a temp table).';

describe('a layout read from a file', () => {
  it('reads the layout script’s answer in every encoding it is saved in, as SSMS’s cell holds it', () => {
    // SSMS shows the cell under a column name like this one; a copy of the cell carries only the instruction.
    const cell = `XML_F52E2B61-18A1-11d1-B105-00805F49916B\n${SCHEMA_EXPORT}`;
    for (const [form, bytes] of Object.entries({ utf8: utf8(SCHEMA_EXPORT), utf8Mark: utf8Mark(cell), utf16le: utf16le(cell), utf16be: utf16be(SCHEMA_EXPORT) })) {
      const read = layoutFromFile(file('forma-schema.txt', bytes).bytes, file('forma-schema.txt', bytes).name);
      expect(read, form).toMatchObject({ ok: true, said: [SAID], notices: [] });
      expect(read.ok && read.schema).toEqual(readSchemaExport(SCHEMA_EXPORT));
    }
  });

  it('refuses the layout cut short, and never reads it as a one-table script', () => {
    const read = layoutFromFile(file('forma-schema.txt', utf16le(SCHEMA_EXPORT.slice(0, -3))).bytes, 'forma-schema.txt');
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/^"forma-schema\.txt" holds Forma's database layout cut short or damaged, so none of it was read: run Forma's layout script again and save its whole answer\./);
    expect(!read.ok && read.reason).not.toContain('#t');
  });

  it('says what lost characters on the way, with the fix', () => {
    const latin1 = layoutFromFile(file('latin1.txt', Buffer.from(SCHEMA_EXPORT.replace('"name":"City"', '"name":"Città"'), 'latin1')).bytes, 'latin1.txt');
    expect(latin1).toEqual({
      ok: false,
      reason:
        "\"latin1.txt\" holds names with characters that are not UTF-8, as a file written in a code page does (sqlcmd without -f 65001 writes one), so they would be read wrong: write it again as UTF-8 from the start, with sqlcmd's -f 65001 (or -u) or SSMS saving its answer as UTF-8, since the letters are not in this file to recover.",
    });
    const unmarked = layoutFromFile(file('unmarked.txt', Buffer.from(SCHEMA_EXPORT, 'utf16le')).bytes, 'unmarked.txt');
    expect(unmarked).toEqual({ ok: false, reason: '"unmarked.txt" holds NUL characters, as UTF-16 does when it has no byte order mark: save it again as UTF-8, or as UTF-16 with its mark.' });
  });

  /*
   * The wave-5 review (BT-5, 2026-11-25) captured FormaSample with an
   * Arabic table through sqlcmd without -f 65001: the code page had no
   * letters for it, so the file held `"name":"??????"`, plain ASCII, read
   * without complaint as `dbo.??????[???????,??????]`. Rebuilt here from the
   * capture's form: the names as the code page wrote them.
   */
  it('refuses names a code page turned into question marks, which nothing can bring back, and keeps a name with one', () => {
    const arabic = SCHEMA_EXPORT.replace('"name":"Customers"', '"name":"??????"').replace('"name":"City"', '"name":"???????"');
    const lost = layoutFromFile(utf8(arabic), 'layout-cp-ar.txt');
    expect(lost).toEqual({
      ok: false,
      reason:
        "\"layout-cp-ar.txt\" holds names whose letters were lost to a code page, so they read as question marks (sqlcmd without -f 65001 writes a name in another script so): write it again as UTF-8 from the start, with sqlcmd's -f 65001 (or -u) or SSMS saving its answer as UTF-8, since the letters are not in this file to recover.",
    });
    // A column an Access migration named `Paid?` is a name, read as it is.
    const paid = layoutFromFile(utf8(SCHEMA_EXPORT.replace('"name":"City"', '"name":"Paid?"')), 'forma-schema.txt');
    expect(paid.ok && paid.schema.objects.flatMap((o) => o.columns.map((c) => c.name))).toContain('Paid?');
  });

  it("says Forma's own script given in place of its answer, and sqlcmd's error written into it, each with what to do", () => {
    const script = layoutFromFile(utf8(SCHEMA_SCRIPT), 'forma-schema.sql');
    expect(script).toEqual({ ok: false, reason: "\"forma-schema.sql\" is Forma's layout script, not what it answers: run it against the database (in SSMS, or with sqlcmd) and give the answer it writes." });
    const failed = "﻿Msg 208, Level 16, State 1, Server DESKTOP\\LOCALDB, Line 6\nInvalid object name 'dbo.Gone'.\n";
    const error = layoutFromFile(utf8(failed), 'layout.txt');
    expect(error).toEqual({ ok: false, reason: '"layout.txt" holds an error from sqlcmd or SQL Server rather than the script\'s answer: open it to read the error, run the script again, and give the answer it writes.' });
    expect(!error.ok && error.reason).not.toContain('Gone');
    const rows = layoutFromFile(utf8(SCHEMA_EXPORT), 'forma-schema.txt', [file('sample.txt', utf8(failed))]);
    expect(rows).toEqual({ ok: false, reason: '"sample.txt" holds an error from sqlcmd or SQL Server rather than the script\'s answer: open it to read the error, run the script again, and give the answer it writes.' });
  });

  it('reads an SSMS script, its database from USE or else the file’s name', () => {
    const script = layoutFromFile(file('shop.sql', utf8('CREATE TABLE dbo.Customers (CustomerID int NOT NULL PRIMARY KEY, CompanyName nvarchar(80));')).bytes, join(folder, 'shop.sql'));
    expect(script).toMatchObject({ ok: true, said: ['Database layout read from "shop.sql": shop: 1 table, 0 views, 0 procedures.'] });
  });

  it('reads a report’s own data source as the part of the database it reads', () => {
    const own = layoutFromFile(file('orders.repx', utf8(EMITTED_REPX)).bytes, 'orders.repx');
    expect(own).toMatchObject({ ok: true, said: ['Database layout read from "orders.repx", the part of the database this report reads: FormaSample: 3 tables, 0 views, 1 procedure.'] });
    expect(own.ok && own.schema.source).toBe('repx');
    const none = layoutFromFile(file('plain.repx', utf8('<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" />')).bytes, 'plain.repx');
    expect(none).toEqual({ ok: false, reason: '"plain.repx" has no SQL data source to read a database\'s layout from.' });
  });

  it('refuses what is no layout, and a file larger than a layout runs to', () => {
    expect(layoutFromFile(file('rows.csv', utf8('OrderID,Freight\n1001,12.50')).bytes, 'rows.csv')).toEqual({ ok: false, reason: '"rows.csv" is not a database layout: give the answer of Forma\'s layout script, an SSMS "Generate Scripts" file, or a report (.repx) with a data source.' });
    expect(layoutFromFile(file('samples.txt', utf8(SAMPLE_EXPORT)).bytes, 'samples.txt')).toEqual({ ok: false, reason: '"samples.txt" holds sample rows, not a layout: give the layout, and these rows beside it as sample rows.' });
    const large = layoutFromFile(new Uint8Array(MAX_LAYOUT_BYTES + 1), 'huge.txt');
    expect(large).toEqual({ ok: false, reason: '"huge.txt" is larger than 64 MB, more than a database\'s layout runs to, so it was not read.' });
  });
});

describe('sample rows beside a layout', () => {
  const layout = () => file('forma-schema.txt', utf8Mark(SCHEMA_EXPORT));

  it('join it when they are of the same database, said by object and count, never by value', () => {
    const rows = file('forma-sample.txt', utf16le(SAMPLE_EXPORT));
    const read = layoutFromFile(layout().bytes, 'forma-schema.txt', [rows]);
    expect(read).toMatchObject({ ok: true, said: [SAID, 'Sample rows read for FormaSample from "forma-sample.txt": dbo.Orders (3 rows), dbo.vOrderTotals (3 rows).'] });
    expect(read.ok && read.schema.samples).toEqual(readSampleExport(SAMPLE_EXPORT)!.samples);
    expect((read.ok ? read.said : []).join(' ')).not.toMatch(/Example Traders|1001|12\.5/);
  });

  it('are refused when they are of another database, cut short, a layout, or a report', () => {
    const other = file('other.txt', utf8(SAMPLE_EXPORT.replace('"database":"FormaSample"', '"database":"ShopDemo"')));
    expect(layoutFromFile(layout().bytes, 'forma-schema.txt', [other])).toEqual({ ok: false, reason: 'The sample rows in "other.txt" are of the database ShopDemo, and the layout is of FormaSample: give sample rows of the same database as the layout.' });
    // A database's name is matched as SQL Server matches it, case aside.
    expect(layoutFromFile(layout().bytes, 'forma-schema.txt', [file('lower.txt', utf8(SAMPLE_EXPORT.replace('"FormaSample"', '"formasample"')))]).ok).toBe(true);
    const cut = layoutFromFile(layout().bytes, 'forma-schema.txt', [file('cut.txt', utf8(SAMPLE_EXPORT.slice(0, -40)))]);
    expect(!cut.ok && cut.reason).toMatch(/^"cut\.txt" holds Forma's sample rows cut short or damaged/);
    expect(layoutFromFile(layout().bytes, 'forma-schema.txt', [layout()])).toEqual({ ok: false, reason: '"forma-schema.txt" is a database layout, not sample rows: give it as the layout, and the sample script\'s answer as sample rows.' });
    expect(layoutFromFile(layout().bytes, 'forma-schema.txt', [file('orders.repx', utf8(EMITTED_REPX))])).toEqual({ ok: false, reason: '"orders.repx" is a report, not sample rows: sample rows are the answer of Forma\'s sample script.' });
  });

  it('in the layout’s own file are not sent with it, and the file says so', () => {
    const both = file('both.txt', utf8(`${SCHEMA_EXPORT}\n${SAMPLE_EXPORT}`));
    const read = layoutFromFile(both.bytes, 'both.txt');
    expect(read).toMatchObject({ ok: true, notices: ['"both.txt" holds sample rows too, which were not read with the layout: give the file as sample rows as well to send their values.'] });
    expect(read.ok && read.schema.samples).toBeUndefined();
    // Given as sample rows as well, they are.
    const asked = layoutFromFile(both.bytes, 'both.txt', [both]);
    expect(asked.ok && Object.keys(asked.schema.samples ?? {})).toEqual(['dbo.Orders', 'dbo.vOrderTotals']);
  });
});

describe('a layout among a report’s files (D1-1)', () => {
  const found = (text: string, name: string): FoundDatabase => ({ ...readDatabaseText(text)!, file: name });
  const layout = found(SCHEMA_EXPORT, 'forma-schema.txt');
  const rows = found(SAMPLE_EXPORT, 'forma-sample.txt');

  it('is the request’s database step when none was handed in, and is said', async () => {
    const taken = stepFromFiles([layout], false);
    expect(taken.notices).toEqual(['"forma-schema.txt" is a database layout, given to the AI with the request so the report can be bound to it.']);
    const step = (await taken.database!('orders by customer'))!;
    expect(step.section).toContain('<database>\nDATABASE "FormaSample"');
    expect(step.section).toContain('<?forma-query');
  });

  it('leaves out sample rows the person did not allow, and takes those of the same database when they did', async () => {
    const without = stepFromFiles([layout, rows], false);
    expect(without.notices).toContain('"forma-sample.txt" holds sample rows, which go to the AI only when they are attached with the layout, so they were not read.');
    expect((await without.database!('orders'))!.section).not.toContain('e.g.');
    const words = { chose: 'as the user chose', choose: 'with --query', samples: 'when they are passed with --samples' };
    expect(stepFromFiles([layout, rows], false, { where: words }).notices).toContain('"forma-sample.txt" holds sample rows, which go to the AI only when they are passed with --samples, so they were not read.');
    const allowed = stepFromFiles([layout, rows], false, { samples: true });
    expect(allowed.notices).toEqual(['"forma-schema.txt" is a database layout, given to the AI with the request so the report can be bound to it.']);
    expect((await allowed.database!('orders'))!.section).toContain('e.g. OrderID=1001|1002|1003');
    const other = found(SAMPLE_EXPORT.replace('"FormaSample"', '"ShopDemo"'), 'other.txt');
    expect(stepFromFiles([layout, other], false, { samples: true }).notices).toContain('"other.txt" holds sample rows of another database than the layout\'s, so they were not read.');
    expect(stepFromFiles([rows], false, { samples: true })).toEqual({ notices: ['"forma-sample.txt" holds sample rows of a database whose layout was not given, so they were not read.'] });
  });

  // The wave-5 review (W5-PB-7): a file holding the layout and its rows, in either order, gives both, each by its own rule.
  it('takes the sample rows in the layout’s own file by the same rule as a file of their own', async () => {
    for (const text of [`${SCHEMA_EXPORT}\n${SAMPLE_EXPORT}`, `${SAMPLE_EXPORT}\n${SCHEMA_EXPORT}`]) {
      const both = found(text, 'both.txt');
      expect(both.kind === 'schema' && Object.keys(both.rows?.samples ?? {})).toEqual(['dbo.Orders', 'dbo.vOrderTotals']);
      const without = stepFromFiles([both], false);
      expect(without.notices).toContain('"both.txt" holds sample rows too, which go to the AI only when they are attached with the layout, so they were not read.');
      expect((await without.database!('orders'))!.section).not.toContain('e.g.');
      expect((await stepFromFiles([both], false, { samples: true }).database!('orders'))!.section).toContain('e.g. OrderID=1001|1002|1003');
    }
  });

  it('says what it did not read: a layout when one was handed in, a second layout, and one cut short', () => {
    expect(stepFromFiles([layout, rows], true)).toEqual({
      notices: [
        '"forma-schema.txt" is a database layout, and the report is bound to the database given, so it was not read.',
        '"forma-sample.txt" holds sample rows, and the report is bound to the database given, so they were not read.',
      ],
    });
    const second = stepFromFiles([layout, { ...layout, file: 'again.txt' }], false);
    expect(second.notices[0]).toBe('"again.txt" is a second database layout, and a report is bound to one, "forma-schema.txt", so it was not read.');
    expect(second.database).toBeDefined();
    const cut = stepFromFiles([found(SCHEMA_EXPORT.slice(0, -3), 'cut.txt')], false);
    expect(cut.database).toBeUndefined();
    expect(cut.notices[0]).toMatch(/^"cut\.txt" holds Forma's database layout cut short or damaged/);
  });

  it('names the connection as the caller asks, and refuses one that is a connection string', async () => {
    const named = stepFromFiles([layout], false, { connectionName: 'ShopLive' });
    const step = (await named.database!(''))!;
    const report = '<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" Name="R" Version="20.1"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="25"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="labelCity" SizeF="100,20" LocationFloat="0,0"><ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Text" Expression="[City]" /></ExpressionBindings></Item1></Controls></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(step.write(report, { table: 'dbo.Customers' }, '20.1').note).toBe('Bound it to Customers on "ShopLive".');
    expect(() => stepFromFiles([layout], false, { connectionName: 'Server=x;Password=y' })).toThrow(/^A connection name cannot hold ; or =/);
  });
});
