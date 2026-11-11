/**
 * What may be handed to DevExpress on the person's PC unasked (2026-11-11,
 * the re-audit's R5-03): the types a report names and the files it reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectionRefusal, outsideReferences, reachesOutside } from './inspectionGuard';

const ROOT = '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R">';
const report = (inner: string) => `${ROOT}<Bands><Item1 Ref="2" ControlType="DetailBand" Name="Detail"><Controls>${inner}</Controls></Item1></Bands></XtraReportsLayoutSerializer>`;
/** A SQL data source as lib/repxSqlWriter.ts writes one, its XML in Base64. */
const sqlSource = (xml: string) =>
  `<ComponentStorage><Item1 Ref="0" ObjectType="DevExpress.DataAccess.Sql.SqlDataSource,DevExpress.DataAccess.v20.1" Name="sqlDataSource1" Base64="${btoa(xml)}" /></ComponentStorage>`;

describe('inspectionRefusal', () => {
  it('lets through what Forma writes: its controls, parameters, lookups and SQL data source', () => {
    const xml =
      report('<Item1 Ref="3" ControlType="XRLabel" Name="label1" /><Item2 Ref="4" ControlType="DevExpress.XtraReports.UI.XRRichText, DevExpress.XtraReports.v20.1" Name="rich" /><Item3 Ref="5" ControlType="XRPictureBox" Name="logo" ImageUrl="https://example.com/logo.png" />') +
      '<Parameters><Item1 Ref="6" Name="From" Type="#Ref-7" ValueInfo="2026-01-01" /></Parameters>' +
      '<ObjectStorage><Item1 ObjectType="DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.v20.1" Ref="7" Content="System.DateTime" Type="System.Type" />' +
      '<Item2 Ref="8" ObjectType="DevExpress.XtraReports.Parameters.DynamicListLookUpSettings, DevExpress.Printing.v20.1.Core" DataSource="#Ref-0" /></ObjectStorage>' +
      sqlSource('<SqlDataSource Name="sqlDataSource1"><Connection Name="Shop" FromAppConfig="true" /><Query Type="CustomSqlQuery" Name="Orders"><Parameter Name="@From" Type="DevExpress.DataAccess.Expression">(System.DateTime)(?From)</Parameter><Sql>select 1</Sql></Query><ResultSchema><DataSet Name="s"><View Name="Orders"><Field Name="Id" Type="Int32" /></View></DataSet></ResultSchema></SqlDataSource>');
    expect(inspectionRefusal(xml)).toBeNull();
  });

  it('refuses a type that is not a report type or a plain value', () => {
    expect(inspectionRefusal(report('<Item1 Ref="3" ControlType="System.Windows.Data.ObjectDataProvider, PresentationFramework" Name="x" />'))).toMatch(/names the type "System\.Windows\.Data\.ObjectDataProvider"/);
    expect(inspectionRefusal(`${ROOT}<ObjectStorage><Item1 Ref="7" ObjectType="System.Diagnostics.Process, System" /></ObjectStorage></XtraReportsLayoutSerializer>`)).toMatch(/holds a "System\.Diagnostics\.Process"/);
    expect(inspectionRefusal(`${ROOT}<ObjectStorage><Item1 Ref="7" ObjectType="DevExpress.XtraReports.Serialization.ObjectStorageInfo" Content="System.IO.FileInfo" Type="System.Type" /></ObjectStorage></XtraReportsLayoutSerializer>`)).toMatch(/System\.IO\.FileInfo/);
    expect(inspectionRefusal(`${ROOT}<ObjectStorage><Item1 Ref="7" ObjectType="DevExpress.XtraReports.Serialization.ObjectStorageInfo" Value="x" Type="System.Collections.Hashtable" /></ObjectStorage></XtraReportsLayoutSerializer>`)).toMatch(/Hashtable/);
    // Any data source but the SQL one Forma writes, and anything odd inside that one.
    expect(inspectionRefusal(`${ROOT}<ComponentStorage><Item1 Ref="0" ObjectType="DevExpress.DataAccess.ObjectBinding.ObjectDataSource,DevExpress.DataAccess.v20.1" Name="o" Base64="e30=" /></ComponentStorage></XtraReportsLayoutSerializer>`)).toMatch(/ObjectDataSource/);
    expect(inspectionRefusal(`${ROOT}${sqlSource('<SqlDataSource><Query Type="CustomSqlQuery"><Parameter Name="p" Type="System.Data.DataSet">x</Parameter></Query></SqlDataSource>')}</XtraReportsLayoutSerializer>`)).toMatch(/its data source: it names the type "System\.Data\.DataSet"/);
  });

  it('refuses a file read from another computer or from this one, however it is written', () => {
    for (const value of ['\\\\server\\share\\logo.png', '//server/share/logo.png', 'file:///C:/logo.png', 'C:\\logos\\logo.png', '&#x5C;&#x5C;server&#x5C;x.png']) {
      expect(inspectionRefusal(report(`<Item1 Ref="3" ControlType="XRPictureBox" Name="logo" ImageUrl="${value}" />`)), value).toMatch(/from outside the report/);
    }
    expect(inspectionRefusal(report(`<Item1 Ref="3" ControlType="XRSubreport" Name="sub" ReportSourceUrl='\\\\server\\r.repx' />`))).toMatch(/ReportSourceUrl|outside/);
    expect(inspectionRefusal(`<XtraReportsLayoutSerializer Ref="1" ControlType="XtraReport" StyleSheetPath="\\\\server\\s.repss" />`)).toMatch(/outside/);
  });

  // The review of R5-03 (2026-11-12): XML allows letters past ASCII in a name, and such a tag was skipped whole.
  it('reads a tag whose attribute or element name has a letter past ASCII', () => {
    expect(inspectionRefusal(report('<Item1 Ref="3" Ñame="x" ControlType="System.Diagnostics.Process, System" />'))).toMatch(/System\.Diagnostics\.Process/);
    expect(inspectionRefusal(report('<Ítem1 Ref="3" ControlType="XRPictureBox" ImageUrl="\\\\server\\x.png" />'))).toMatch(/outside/);
  });
});

describe('outsideReferences', () => {
  it('names each control reading a file from outside, and leaves web addresses and pictures in the report alone', () => {
    expect(reachesOutside('https://example.com/a.png')).toBe(false);
    expect(reachesOutside('data:image/png;base64,AAAA')).toBe(false);
    expect(reachesOutside('logo.png')).toBe(false);
    expect(outsideReferences(report('<Item1 Ref="3" ControlType="XRPictureBox" Name="logo" ImageUrl="\\\\nas\\logo.png" /><Item2 Ref="4" ControlType="XRPictureBox" Name="web" ImageUrl="https://example.com/a.png" />'))).toEqual([
      { name: 'logo', value: '\\\\nas\\logo.png' },
    ]);
  });
});

describe('Forma Designer is not asked about a refused report', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts nothing for one, and asks as before for one that is fine', async () => {
    vi.resetModules();
    const bridge = await import('./designerBridge');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        const body = url.endsWith('/health') ? { app: 'RepxDesigner', version: '1.1.0', devexpress: { version: '20.1', build: '20.1.3' }, found: ['20.1'], oldest: '20.1', inspects: true } : { lost: [], dropped: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await bridge.askDesigner();
    expect(await bridge.inspectInDesigner(report('<Item1 Ref="3" ControlType="XRPictureBox" Name="logo" ImageUrl="\\\\nas\\logo.png" />'), [{ A: '1' }])).toBeNull();
    expect(urls.map((u) => u.slice(bridge.DESIGNER_ORIGIN.length))).toEqual(['/health']);
    expect(await bridge.inspectInDesigner(report('<Item1 Ref="3" ControlType="XRLabel" Name="label1" />'), [])).not.toBeNull();
    expect(urls.map((u) => u.slice(bridge.DESIGNER_ORIGIN.length))).toEqual(['/health', '/inspect']);
  });
});
