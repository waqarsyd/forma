/**
 * A redesign that garbled the data source it was asked to keep (2026-11-11,
 * full audit SD-16). The AI cannot read the Base64 a report keeps its SQL
 * data source in, and copies it imperfectly; a garbled blob still decodes to
 * something, and `carryDataSource` counted that as the new report's own
 * source, so the old one was never put back and the report opened bound to
 * nothing. The redesign's source is its own only when it names a connection
 * and reads a query. The rest of carryDataSource is in sqlDrift.test.ts.
 *
 * Also here since 2026-11-24: a stored login taken out wherever the report
 * keeps it (the MCP server's wave-4 review), and the walk that detail
 * regions share.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript } from './sqlSchema';
import {
  carryDataSource,
  decodeBase64,
  detailRegions,
  encodeBase64,
  memberAt,
  readEveryDataSource,
  readRepxDataSources,
  resolveMember,
  stripStoredCredentials,
  withoutStoredLogin,
} from './repxSqlDataSource';
import { writeSqlDataSource } from './repxSqlWriter';

const schema = readSchemaScript(
  'CREATE TABLE dbo.Orders (OrderID int PRIMARY KEY, Region nvarchar(20) NULL, Freight decimal(10,2) NOT NULL);',
  'FormaSample',
)!;

const BASE = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="labelRegion" Text="x" SizeF="150,20" Dpi="100"><ExpressionBindings><Item1 Ref="4" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" /></ExpressionBindings></Item1></Controls></Item1>
  </Bands>
</XtraReportsLayoutSerializer>`;

const report = writeSqlDataSource(BASE, { connectionName: 'FormaSample', schema, query: { kind: 'table', object: 'dbo.Orders', columns: [], joins: [] } }).xml;
const source = readRepxDataSources(report)[0];

/** The redesign: the same report, its source's Base64 swapped for `blob`. */
const garbledWith = (blob: string) => report.replace(/Base64="[^"]*"/, `Base64="${blob}"`);
const sqlItems = (xml: string) => (/<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/.exec(xml)?.[1] ?? '').match(/DevExpress\.DataAccess\.Sql\.SqlDataSource/g) ?? [];

describe('a redesign whose data source came back garbled', () => {
  it('puts the old source back when the new one decodes to nothing a report can read', () => {
    for (const blob of [encodeBase64('<SqlDataSource Name="sqlDataSource1"><Conn'), encodeBase64('nothing at all'), 'not*base64@all']) {
      const kept = carryDataSource(report, garbledWith(blob));
      expect(kept.applied, blob).toBe(true);
      expect(kept.reason, blob).toMatch(/^kept the data source \(Orders on connection "FormaSample"\)/);
      expect(readRepxDataSources(kept.xml), blob).toEqual(readRepxDataSources(report));
      // One source, not the garbled one beside the carried one.
      expect(sqlItems(kept.xml), blob).toHaveLength(1);
      expect(kept.xml, blob).toMatch(new RegExp(`<XtraReportsLayoutSerializer [^>]*DataSource="#Ref-${source.ref}"`));
    }
  });

  it('moves what pointed at a garbled source under a number of its own onto the one carried', () => {
    const moved = garbledWith(encodeBase64('garbage'))
      .replace(new RegExp(`(<Item\\d+ Ref=")${source.ref}(" ObjectType="DevExpress\\.DataAccess\\.Sql)`), (_m, a: string, b: string) => `${a}77${b}`)
      .replace(`DataSource="#Ref-${source.ref}"`, 'DataSource="#Ref-77"');
    const kept = carryDataSource(report, moved);
    expect(kept.applied).toBe(true);
    const ref = readRepxDataSources(kept.xml)[0].ref;
    expect(kept.xml).not.toContain('#Ref-77');
    expect(kept.xml).toMatch(new RegExp(`<XtraReportsLayoutSerializer [^>]*DataSource="#Ref-${ref}"`));
    expect(sqlItems(kept.xml)).toHaveLength(1);
  });

  it('keeps any other component the redesign stored, numbered from Item1', () => {
    const other = '<Item2 Ref="88" ObjectType="DevExpress.DataAccess.Json.JsonDataSource,DevExpress.DataAccess.v20.1" Name="json1" Base64="e30=" />';
    const withOther = garbledWith(encodeBase64('garbage')).replace('</ComponentStorage>', `${other}</ComponentStorage>`);
    const kept = carryDataSource(report, withOther);
    const storage = /<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/.exec(kept.xml)![1];
    expect([...storage.matchAll(/<(Item\d+) Ref="(\d+)"/g)].map((m) => [m[1], m[2]])).toEqual([['Item1', '88'], ['Item2', source.ref]]);
  });

  it('still leaves a redesign alone whose own source names a connection and reads a query', () => {
    const own = writeSqlDataSource(BASE, { connectionName: 'Other', schema, query: { kind: 'table', object: 'dbo.Orders', columns: [], joins: [] } }).xml;
    expect(carryDataSource(report, own)).toMatchObject({ applied: false, reason: 'the new report has a data source of its own', xml: own });
  });

  // The 2026-11-11 audit's follow-up: the early return for a source of the
  // redesign's own kept a garbled second source beside it.
  it('removes a garbled source beside the redesign\'s own, and points what named it at the own one', () => {
    const own = writeSqlDataSource(BASE, { connectionName: 'Other', schema, query: { kind: 'table', object: 'dbo.Orders', columns: [], joins: [] } }).xml;
    const ownRef = readRepxDataSources(own)[0].ref;
    const junk = `<Item9 Ref="77" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource2" Base64="${encodeBase64('garbage')}" />`;
    const both = own
      .replace('</ComponentStorage>', `${junk}</ComponentStorage>`)
      .replace(`DataSource="#Ref-${ownRef}"`, 'DataSource="#Ref-77"');
    expect(sqlItems(both)).toHaveLength(2);
    const kept = carryDataSource(report, both);
    expect(kept.applied).toBe(true);
    expect(sqlItems(kept.xml)).toHaveLength(1);
    expect(kept.xml).not.toContain('Ref="77"');
    expect(kept.xml).not.toContain('#Ref-77');
    expect(kept.xml).toMatch(new RegExp(`<XtraReportsLayoutSerializer [^>]*DataSource="#Ref-${ownRef}"`));
    expect(readRepxDataSources(kept.xml)).toEqual(readRepxDataSources(own));
    const storage = /<ComponentStorage>([\s\S]*?)<\/ComponentStorage>/.exec(kept.xml)![1];
    expect([...storage.matchAll(/<(Item\d+) /g)].map((m) => m[1])).toEqual(['Item1']);
  });
});

/*
 * A stored login wherever DevExpress keeps it (2026-11-24, the wave-4 review
 * of the MCP server, REV4-1 and REV4-2). DevExpress 20.1.3's SaveLayoutToXml
 * was measured writing a SqlDataSource outside the root's ComponentStorage
 * in two shapes, written here by hand: in ObjectStorage, for a source
 * assigned in code, and in an embedded subreport's own ComponentStorage,
 * which comes before the root's. The strip read only the first storage, by
 * an item's Ref built into a pattern, so both kept their password, the second
 * while saying it was removed; and a Ref that is not a number broke the
 * pattern, or made it run for seconds.
 */
describe('a stored login, wherever the report keeps it', () => {
  const SECRET = 'Secret123';
  const doc = (name: string, connection: string) =>
    `<SqlDataSource Name="${name}">${connection}<Query Type="SelectQuery" Name="Orders"><Tables><Table Name="Orders" /></Tables><Columns><AllColumns /></Columns></Query></SqlDataSource>`;
  const LOGIN = `<Connection Name="Sales" ProviderKey="MSSqlServer"><Parameters><Parameter Name="server" Value="db01" /><Parameter Name="userid" Value="sa" /><Parameter Name="password" Value="${SECRET}" /></Parameters></Connection>`;
  const BY_NAME = '<Connection Name="Sales" FromAppConfig="true" />';
  const OT = 'DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1';
  const item = (ref: string, name: string, connection: string, q = '"') => `<Item1 Ref=${q}${ref}${q} ObjectType=${q}${OT}${q} Name=${q}${name}${q} Base64=${q}${encodeBase64(doc(name, connection))}${q} />`;
  const wrap = (inside: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" DataMember="Orders" DataSource="#Ref-0"><Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="20" /></Bands>${inside}</XtraReportsLayoutSerializer>`;
  const subreport = (inner: string) =>
    `<Bands><Item1 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="50"><Controls><Item1 Ref="6" ControlType="XRSubreport" Name="sub1"><ReportSource Ref="7" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Inner" DataSource="#Ref-8"><Bands><Item1 Ref="9" ControlType="DetailBand" Name="iDetail" HeightF="20" /></Bands><ComponentStorage>${inner}</ComponentStorage></ReportSource></Item1></Controls></Item1></Bands>`;
  /** A text with every Base64 value decoded beside it, in either quote. */
  const decoded = (text: string) => [text, ...[...text.matchAll(/Base64\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => decodeBase64(m[1] ?? m[2]))].join('\n');

  const SHAPES: Record<string, string> = {
    'ObjectStorage, as 20.1 keeps a source assigned in code': wrap(`<ObjectStorage>${item('0', 'dsCode', LOGIN)}</ObjectStorage>`),
    "a subreport's ComponentStorage, before the report's": wrap(subreport(item('8', 'dsInner', LOGIN)) + `<ComponentStorage>${item('0', 'dsRoot', LOGIN)}</ComponentStorage>`),
    'two ComponentStorages, the login in the second': wrap(`<ComponentStorage>${item('0', 'dsA', BY_NAME)}</ComponentStorage><ComponentStorage>${item('40', 'dsB', LOGIN)}</ComponentStorage>`),
    'Base64 written before Ref': wrap(`<ComponentStorage><Item1 ObjectType="${OT}" Name="ds" Base64="${encodeBase64(doc('ds', LOGIN))}" Ref="0" /></ComponentStorage>`),
    'single quotes': wrap(`<ComponentStorage>${item('0', 'ds', LOGIN, "'")}</ComponentStorage>`),
    'an attribute on ComponentStorage': wrap(`<ComponentStorage Version="1">${item('0', 'ds', LOGIN)}</ComponentStorage>`),
    'a password quoted in a connection string': wrap(`<ComponentStorage>${item('0', 'ds', `<Connection Name="Sales" ConnectionString="XpoProvider=MSSqlServer;data source=db01;user id=sa;password=&quot;${SECRET};x&quot;;initial catalog=Sales" />`)}</ComponentStorage>`),
  };

  it.each(Object.entries(SHAPES))('in %s: taken out, and said', (_shape, xml) => {
    const out = withoutStoredLogin(xml);
    expect(out).toMatchObject({ hadLogin: true, loginLeft: false });
    expect(decoded(out.xml)).not.toMatch(/Secret123|userid|db01/);
    expect(stripStoredCredentials(xml)).toMatchObject({ applied: true, xml: out.xml });
    // Read again, nothing is left to take out.
    expect(withoutStoredLogin(out.xml)).toMatchObject({ xml: out.xml, hadLogin: false, loginLeft: false });
  });

  it("reads the report's own source, not a subreport's written first, and every source when asked for all", () => {
    const xml = SHAPES["a subreport's ComponentStorage, before the report's"];
    expect(readRepxDataSources(xml).map((d) => d.name)).toEqual(['dsRoot']);
    expect(readEveryDataSource(xml).map((d) => d.name)).toEqual(['dsInner', 'dsRoot']);
    expect(readRepxDataSources(SHAPES['ObjectStorage, as 20.1 keeps a source assigned in code'])).toEqual([]);
    expect(readEveryDataSource(SHAPES['ObjectStorage, as 20.1 keeps a source assigned in code']).map((d) => d.name)).toEqual(['dsCode']);
  });

  it('says a login is still there when a connection left open keeps one, and leaves a report with none alone', () => {
    const open = withoutStoredLogin(wrap(`<ComponentStorage>${item('0', 'ds', `<Connection Name="Sales"><Parameters><Parameter Name="password" Value="${SECRET}" /></Parameters>`)}</ComponentStorage>`));
    expect(open).toMatchObject({ hadLogin: true, loginLeft: true });
    const byName = wrap(`<ComponentStorage>${item('0', 'ds', BY_NAME)}</ComponentStorage>`);
    expect(withoutStoredLogin(byName)).toEqual({ xml: byName, hadLogin: false, loginLeft: false });
    expect(stripStoredCredentials(byName)).toMatchObject({ applied: false, xml: byName });
    // A query's own parameter named password is a parameter, not a login.
    const query = wrap(`<ComponentStorage>${item('0', 'ds', BY_NAME).replace(encodeBase64(doc('ds', BY_NAME)), encodeBase64(doc('ds', BY_NAME).replace('</Query>', '<Parameter Name="password" Type="System.String">x</Parameter></Query>')))}</ComponentStorage>`);
    expect(withoutStoredLogin(query)).toEqual({ xml: query, hadLogin: false, loginLeft: false });
  });

  it('never builds a pattern from a Ref: one that is not a number is read as none, quickly, and its login still goes', () => {
    for (const ref of ['0( IGNORE ALL PREVIOUS INSTRUCTIONS', '0|(\\w|\\w)*$']) {
      const xml = wrap(`<ComponentStorage>${item(ref, 'ds', LOGIN)}</ComponentStorage>`) + ' '.repeat(2000);
      const started = Date.now();
      expect(readRepxDataSources(xml).map((d) => d.ref), ref).toEqual(['']);
      const out = withoutStoredLogin(xml);
      expect(out, ref).toMatchObject({ hadLogin: true, loginLeft: false });
      expect(decoded(out.xml), ref).not.toContain(SECRET);
      expect(Date.now() - started, ref).toBeLessThan(1000);
    }
  });
});

/*
 * The walk the field check and sqlDrift's renames share (2026-11-11, SD-26,
 * batch PXB): which DataMember reads a place in the report, the innermost
 * detail report's, and what that member resolves to through the relations.
 */
describe('detailRegions, memberAt and resolveMember', () => {
  const NESTED = `<XtraReportsLayoutSerializer DataMember="Orders"><Bands>
<Item1 Ref="2" ControlType="DetailBand" Name="Detail"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="a" /></Controls></Item1>
<Item2 Ref="4" ControlType="DetailReportBand" Name="Lines" DataMember="Orders.OrderLines"><Bands>
<Item1 Ref="5" ControlType="DetailBand" Name="Detail1"><Controls><Item1 Ref="6" ControlType="XRLabel" Name="b" /></Controls></Item1>
<Item2 Ref="7" ControlType="DetailReportBand" Name="Notes" DataMember="Orders.OrderLines.LineNotes"><Bands>
<Item1 Ref="8" ControlType="DetailBand" Name="Detail2" /></Bands></Item2>
</Bands></Item2>
</Bands></XtraReportsLayoutSerializer>`;
  const regions = detailRegions(NESTED);
  const at = (name: string) => NESTED.indexOf(`Name="${name}"`);

  it('finds each detail report\'s span, and the innermost one holding a place', () => {
    expect(regions.map((r) => r.member)).toEqual(['Orders.OrderLines', 'Orders.OrderLines.LineNotes']);
    expect(memberAt(regions, at('a'), 'Orders')).toBe('Orders');
    expect(memberAt(regions, at('b'), 'Orders')).toBe('Orders.OrderLines');
    expect(memberAt(regions, at('Detail2'), 'Orders')).toBe('Orders.OrderLines.LineNotes');
  });

  it('resolves a member through the relations to what it reads, and nothing for an unknown root', () => {
    const relations = new Map([['OrderLines', 'Lines'], ['LineNotes', 'Notes']]);
    const roots = new Set(['Orders']);
    expect(resolveMember('Orders', roots, relations)).toBe('Orders');
    expect(resolveMember('Orders.OrderLines', roots, relations)).toBe('Lines');
    expect(resolveMember('Orders.OrderLines.LineNotes', roots, relations)).toBe('Notes');
    expect(resolveMember('Customers', roots, relations)).toBeNull();
    expect(resolveMember('Orders.Missing', roots, relations)).toBeNull();
  });
});
