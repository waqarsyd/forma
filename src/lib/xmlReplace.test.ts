/**
 * A dollar sign in the data never rewrites the report (2026-11-11, full
 * audit PX-01 and PX-02b).
 *
 * `String.prototype.replace` reads its replacement string as a pattern:
 * `$&` is the whole match, `$'` what follows it, `` $` `` what precedes it,
 * `$$` one dollar and `$1` a group. Every writer here once spliced the
 * person's or the model's text into the report through such a string, so a
 * label retyped as "Fee: $1,000" lost the control, and a style lifted off a
 * label reading "Amount ($&...)" wrote every attribute twice, two `Ref="11"`
 * among them, which makes DevExpress's loader discard content with no error.
 * Each writer now passes a function, whose return is taken literally; this
 * runs each one over text holding every pattern.
 */
import { describe, expect, it } from 'vitest';
import { parseReportStructure } from './reportPreview';
import { setControlText } from './repxEdit';
import { liftStyles } from './repxStyles';
import { groupHeaderFields, setGroupField } from './repxGroupField';
import { bindDetailRow, bindFooterTotals } from './repxBindingPlan';
import { readSchemaScript } from './sqlSchema';
import { writeSqlDataSource } from './repxSqlWriter';
import { carryDataSource, readRepxDataSources, stripStoredCredentials } from './repxSqlDataSource';
import { escapeXmlAttribute } from './xmlEscape';

const DOLLARS = ['$&', "$'", '$`', '$$', '$1', '$<x>'];

/** The value of one attribute in a tag, with XML's entities read back. */
const attrIn = (tag: string, name: string): string | undefined => {
  const raw = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return raw === undefined
    ? undefined
    : raw
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&amp;/g, '&');
};

/** Every `Ref` in the document is used once. */
const refsUnique = (xml: string) => {
  const refs = [...xml.matchAll(/\sRef="(\d+)"/g)].map((m) => m[1]);
  return new Set(refs).size === refs.length;
};

const ROOT = '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1">';

describe('retyping a label (repxEdit)', () => {
  const report = `<?xml version="1.0" encoding="utf-8"?>\n${ROOT}<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="40"><Controls><Item1 Ref="2" ControlType="XRLabel" Name="a" Text="x" LocationFloat="0,0" SizeF="100,20" /><Item2 Ref="3" ControlType="XRLabel" Name="b" Text="y" LocationFloat="0,20" SizeF="100,20" /></Controls></Item1></Bands></XtraReportsLayoutSerializer>`;

  it('keeps every pattern as typed, and every control', () => {
    for (const d of DOLLARS) {
      const out = setControlText(report, { band: 0, control: 0 }, `Fee ${d} due`);
      const controls = parseReportStructure(out.xml).bands[0].controls;
      expect(controls.map((c) => c.name), d).toEqual(['a', 'b']);
      expect(controls[0].text, d).toBe(`Fee ${d} due`);
      expect(refsUnique(out.xml), d).toBe(true);
    }
  });
});

describe('lifting a style sheet (repxStyles)', () => {
  const HEAD = 'Font="Arial, 9pt, style=Bold" ForeColor="#1A2B3C"';
  it('moves the appearance and leaves each label its own text, written once', () => {
    for (const d of DOLLARS) {
      const text = escapeXmlAttribute(`Amount (${d}\nUSD)`);
      const labels = [1, 2, 3].map((n) => `<Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="l${n}" Text="${text}" SizeF="100,20" LocationFloat="0,${n * 20}" ${HEAD} />`).join('');
      const report = `${ROOT}<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="200"><Controls>${labels}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
      const out = liftStyles(report);
      expect(out.applied, d).toBe(true);
      expect(refsUnique(out.xml), d).toBe(true);
      for (const n of [1, 2, 3]) {
        const tag = new RegExp(`<Item${n} Ref="${n + 10}"[^>]*>`).exec(out.xml)![0];
        expect(tag.match(/\sText=/g), d).toHaveLength(1);
        expect(attrIn(tag, 'Text'), d).toBe(`Amount (${d}\r\nUSD)`);
        expect(attrIn(tag, 'StyleName'), d).toBe('HeadingStyle');
      }
    }
  });
});

describe('changing what a group breaks on (repxGroupField)', () => {
  const report = (fields: string) =>
    `${ROOT}<Bands><Item1 Ref="2" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25">${fields}<Controls><Item1 Ref="4" ControlType="XRLabel" Name="g" SizeF="200, 20"><ExpressionBindings><Item1 Ref="5" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" /></ExpressionBindings></Item1></Controls></Item1><Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands></XtraReportsLayoutSerializer>`;

  it('writes the field as named, whether the group had one or not', () => {
    for (const d of DOLLARS) {
      const field = `Region${d}`;
      for (const start of ['<GroupFields><Item1 Ref="3" FieldName="Region" /></GroupFields>', '<GroupFields><Item1 Ref="3" /></GroupFields>']) {
        const out = setGroupField(report(start), 'GroupHeader1', field);
        expect(out.applied, d).toBe(true);
        expect(groupHeaderFields(out.xml), d).toEqual([{ band: 'GroupHeader1', field }]);
        expect(refsUnique(out.xml), d).toBe(true);
      }
      // The heading that printed the old field follows it.
      const moved = setGroupField(report('<GroupFields><Item1 Ref="3" FieldName="Region" /></GroupFields>'), 'GroupHeader1', field).xml;
      expect(attrIn(/<Item1 Ref="5"[^>]*>/.exec(moved)![0], 'Expression'), d).toBe(`[${field}]`);
    }
  });
});

describe('binding a table row and its totals (repxBindingPlan)', () => {
  // Cells with a closing tag, so the binding goes in before it: the branch that spliced through a string.
  const cell = (n: number, text: string) => `<Item${n} Ref="${20 + n}" ControlType="XRTableCell" Name="c${n}" Text="${text}" Weight="1"></Item${n}>`;
  const band = (type: string, cells: string, ref: number) =>
    `<Item1 Ref="${ref}" ControlType="${type}" Name="${type}" HeightF="20"><Controls><Item1 Ref="${ref + 1}" ControlType="XRTable" Name="t${type}" LocationFloat="0,0" SizeF="750,20"><Rows><Item1 Ref="${ref + 2}" ControlType="XRTableRow" Name="r${type}" Weight="1"><Cells>${cells}</Cells></Item1></Rows></Item1></Controls></Item1>`;
  const report =
    `${ROOT}<Bands>` +
    band('PageHeaderBand', cell(1, 'Description') + cell(2, 'Amount'), 100) +
    band('DetailBand', cell(1, 'Widget') + cell(2, '1240.00'), 200) +
    band('ReportFooterBand', cell(1, 'Total') + cell(2, '1240.00'), 300) +
    '</Bands></XtraReportsLayoutSerializer>';

  it('writes an expression entry holding a pattern as it was given', () => {
    for (const d of DOLLARS) {
      const expression = `[Amount] + '${d}'`;
      const out = bindDetailRow(report, [null, `=${expression}`]);
      expect(out.applied, d).toBe(true);
      const bound = [...out.xml.matchAll(/<Item1 EventName="BeforePrint" PropertyName="Text" Expression="[^"]*" \/>/g)].map((m) => attrIn(m[0], 'Expression'));
      expect(bound, d).toEqual([expression]);
      expect(out.xml.match(/Text="Widget"/g), d).toHaveLength(1);
    }
  });

  it('totals a column named with one', () => {
    for (const d of DOLLARS) {
      const out = bindFooterTotals(report, [null, `Net${d}`]);
      expect(out.applied, d).toBe(true);
      expect(out.xml, d).toContain(`Expression="sumSum([Net${d}])"`);
      expect(out.xml.match(/<Summary Running="Report" \/>/g), d).toHaveLength(1);
      expect(out.xml.match(/Text="Total"/g), d).toHaveLength(1);
    }
  });
});

describe('writing a SQL data source (repxSqlWriter)', () => {
  const tsql = (s: string) => s.replace(/'/g, "''");
  const schemaFor = (d: string) => {
    const schema = readSchemaScript(`CREATE PROCEDURE dbo.usp_Fees @Label nvarchar(40) = N'Fee ${tsql(d)}' AS SELECT 1;`, 'ShopDemo')!;
    schema.procedures[0].result = [{ name: 'Amount', type: 'decimal', precision: 10, scale: 2 }];
    return schema;
  };
  const base = `${ROOT}<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="25" /></Bands></XtraReportsLayoutSerializer>`;
  const withParameters = base.replace('<Bands>', '<Parameters><Item1 Ref="7" Name="Other" /></Parameters><Bands>');
  const withFields = base.replace('<Bands>', '<CalculatedFields><Item1 Ref="8" Name="Old" Expression="1" /></CalculatedFields><Bands>');

  it('keeps a default, a calculated field and a connection name as they were given', () => {
    for (const d of DOLLARS) {
      for (const report of [base, withParameters, withFields]) {
        const spec = {
          connectionName: `Shop${d}`,
          schema: schemaFor(d),
          query: { kind: 'procedure' as const, procedure: 'dbo.usp_Fees' },
          calculatedFields: [{ name: 'Shown', expression: `'${d}' + [Amount]`, type: 'String' as const }],
        };
        const out = writeSqlDataSource(report, spec);
        expect(out.applied, d).toBe(true);
        expect(refsUnique(out.xml), d).toBe(true);
        const label = /<Item\d+ [^>]*Name="Label"[^>]*\/>/.exec(out.xml)![0];
        expect(attrIn(label, 'ValueInfo'), d).toBe(`Fee ${d}`);
        const shown = /<Item\d+ [^>]*Name="Shown"[^>]*\/>/.exec(out.xml)![0];
        expect(attrIn(shown, 'Expression'), d).toBe(`'${d}' + [Amount]`);
        expect(readRepxDataSources(out.xml).map((s) => s.connectionName), d).toEqual([`Shop${d}`]);
        expect(out.xml.match(/<XtraReportsLayoutSerializer\b/g), d).toHaveLength(1);
        expect(out.xml.match(/<Parameters>/g), d).toHaveLength(1);
        // Written again, the source is replaced in place.
        const again = writeSqlDataSource(out.xml, spec);
        expect(readRepxDataSources(again.xml), d).toHaveLength(1);
        expect(refsUnique(again.xml), d).toBe(true);
      }
    }
  });
});

describe('a stored login removed, and a source carried through a redesign (repxSqlDataSource)', () => {
  const base = `${ROOT}<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="25" /></Bands></XtraReportsLayoutSerializer>`;

  it('keeps a connection named with a pattern when its login is taken out', () => {
    for (const d of DOLLARS) {
      const doc = `<SqlDataSource Name="s"><Connection Name="${escapeXmlAttribute(`Main${d}`)}" ProviderKey="MSSqlServer"><Parameters><Parameter Name="userid" Value="u" /><Parameter Name="password" Value="p" /></Parameters></Connection></SqlDataSource>`;
      const b64 = Buffer.from(doc, 'utf8').toString('base64');
      const report = base.replace('</XtraReportsLayoutSerializer>', `<ComponentStorage><Item1 Ref="9" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="s" Base64="${b64}" /></ComponentStorage></XtraReportsLayoutSerializer>`);
      const fixed = stripStoredCredentials(report);
      expect(fixed.applied, d).toBe(true);
      expect(readRepxDataSources(fixed.xml), d).toMatchObject([{ connectionName: `Main${d}`, fromAppConfig: true, storesCredentials: false }]);
      expect(fixed.xml.match(/<ComponentStorage>/g), d).toHaveLength(1);
    }
  });

  it('puts back the query the report read, named with a pattern', () => {
    const schema = readSchemaScript('CREATE PROCEDURE dbo.usp_Fees AS SELECT 1;', 'ShopDemo')!;
    schema.procedures[0].result = [{ name: 'Amount', type: 'decimal', precision: 10, scale: 2 }];
    const written = writeSqlDataSource(base, { connectionName: 'ShopDemo', schema, query: { kind: 'procedure', procedure: 'dbo.usp_Fees' } }).xml;
    for (const d of DOLLARS) {
      const member = escapeXmlAttribute(`Fees${d}`);
      // A function here too: the fixture is spliced the same way the writers are.
      const before = written.replace('DataMember="Fees"', () => `DataMember="${member}"`);
      const after = before.replace(/<ComponentStorage>[\s\S]*?<\/ComponentStorage>/, '').replace(/\sDataSource="[^"]*"/, '').replace(/\sDataMember="[^"]*"/, '');
      const kept = carryDataSource(before, after);
      expect(kept.applied, d).toBe(true);
      expect(kept.xml, d).toMatch(new RegExp(`<XtraReportsLayoutSerializer [^>]*DataMember="${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" DataSource="#Ref-\\d+">`));
      expect(kept.xml.match(/<XtraReportsLayoutSerializer\b/g), d).toHaveLength(1);
    }
  });
});
