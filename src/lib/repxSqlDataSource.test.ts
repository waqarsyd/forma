/**
 * A redesign that garbled the data source it was asked to keep (2026-11-11,
 * full audit SD-16). The AI cannot read the Base64 a report keeps its SQL
 * data source in, and copies it imperfectly; a garbled blob still decodes to
 * something, and `carryDataSource` counted that as the new report's own
 * source, so the old one was never put back and the report opened bound to
 * nothing. The redesign's source is its own only when it names a connection
 * and reads a query. The rest of carryDataSource is in sqlDrift.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readSchemaScript } from './sqlSchema';
import { carryDataSource, encodeBase64, readRepxDataSources } from './repxSqlDataSource';
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
