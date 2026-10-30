import { describe, expect, it } from 'vitest';
import { crossTabLayout, findCrossTabProblems, repairCrossTabs, type CrossTabCell } from './repxCrossTabs';

/*
 * The layout DevExpress 20.1 generated for 24 field shapes, read from
 * `XRCrossTab.GenerateLayout()` and the serializer (2026-10-30, case s23 of
 * docs/proposals/devexpress-parity.md). Keyed "R-C-D": row, column and data
 * field counts, the fields named R1.., C1.., D1... Each cell is "column,row",
 * then its spans, its text and its format string where it has them. The rule
 * in repxCrossTabs.ts was written from the first fourteen and checked against
 * the last ten, which it had not seen.
 */
const GENERATED: Record<string, { columns: number; rows: number; cells: string[] }> = {
  "0-0-0": {"columns":2,"rows":2,"cells":["0,0","0,1","1,0","1,1"]},
  "0-0-1": {"columns":2,"rows":2,"cells":["0,0","0,1","1,0","1,1"]},
  "0-0-2": {"columns":3,"rows":3,"cells":["0,0 rs2","0,2","1,0 cs2","1,1 \"D1\"","1,2","2,1 \"D2\"","2,2"]},
  "0-1-1": {"columns":3,"rows":2,"cells":["0,0","0,1","1,0","1,1","2,0 \"Grand Total\"","2,1"]},
  "0-2-1": {"columns":4,"rows":3,"cells":["0,0 rs2","0,2","1,0","1,1","1,2","2,0 rs2 fmt\"Total {0}\"","2,2","3,0 rs2 \"Grand Total\"","3,2"]},
  "0-3-2": {"columns":9,"rows":5,"cells":["0,0 rs4","0,4","1,0 cs4","1,1 cs2","1,2 cs2","1,3 \"D1\"","1,4","2,3 \"D2\"","2,4","3,1 cs2 rs2 fmt\"Total {0}\"","3,3 \"D1\"","3,4","4,3 \"D2\"","4,4","5,0 cs2 rs3 fmt\"Total {0}\"","5,3 \"D1\"","5,4","6,3 \"D2\"","6,4","7,0 cs2 rs3 \"Grand Total\"","7,3 \"D1\"","7,4","8,3 \"D2\"","8,4"]},
  "1-0-1": {"columns":2,"rows":3,"cells":["0,0 \"R1\"","0,1","0,2 \"Grand Total\"","1,0","1,1","1,2"]},
  "1-0-2": {"columns":3,"rows":4,"cells":["0,0 rs2 \"R1\"","0,2","0,3 \"Grand Total\"","1,0 cs2","1,1 \"D1\"","1,2","1,3","2,1 \"D2\"","2,2","2,3"]},
  "1-1-0": {"columns":3,"rows":3,"cells":["0,0 \"R1\"","0,1","0,2 \"Grand Total\"","1,0","1,1","1,2","2,0 \"Grand Total\"","2,1","2,2"]},
  "1-1-1": {"columns":3,"rows":3,"cells":["0,0 \"R1\"","0,1","0,2 \"Grand Total\"","1,0","1,1","1,2","2,0 \"Grand Total\"","2,1","2,2"]},
  "1-1-2": {"columns":5,"rows":4,"cells":["0,0 rs2 \"R1\"","0,2","0,3 \"Grand Total\"","1,0 cs2","1,1 \"D1\"","1,2","1,3","2,1 \"D2\"","2,2","2,3","3,0 cs2 \"Grand Total\"","3,1 \"D1\"","3,2","3,3","4,1 \"D2\"","4,2","4,3"]},
  "1-2-1": {"columns":4,"rows":4,"cells":["0,0 rs2 \"R1\"","0,2","0,3 \"Grand Total\"","1,0","1,1","1,2","1,3","2,0 rs2 fmt\"Total {0}\"","2,2","2,3","3,0 rs2 \"Grand Total\"","3,2","3,3"]},
  "1-2-2": {"columns":7,"rows":5,"cells":["0,0 rs3 \"R1\"","0,3","0,4 \"Grand Total\"","1,0 cs2","1,1 cs2","1,2 \"D1\"","1,3","1,4","2,2 \"D2\"","2,3","2,4","3,0 cs2 rs2 fmt\"Total {0}\"","3,2 \"D1\"","3,3","3,4","4,2 \"D2\"","4,3","4,4","5,0 cs2 rs2 \"Grand Total\"","5,2 \"D1\"","5,3","5,4","6,2 \"D2\"","6,3","6,4"]},
  "1-3-2": {"columns":9,"rows":6,"cells":["0,0 rs4 \"R1\"","0,4","0,5 \"Grand Total\"","1,0 cs4","1,1 cs2","1,2 cs2","1,3 \"D1\"","1,4","1,5","2,3 \"D2\"","2,4","2,5","3,1 cs2 rs2 fmt\"Total {0}\"","3,3 \"D1\"","3,4","3,5","4,3 \"D2\"","4,4","4,5","5,0 cs2 rs3 fmt\"Total {0}\"","5,3 \"D1\"","5,4","5,5","6,3 \"D2\"","6,4","6,5","7,0 cs2 rs3 \"Grand Total\"","7,3 \"D1\"","7,4","7,5","8,3 \"D2\"","8,4","8,5"]},
  "2-0-1": {"columns":3,"rows":4,"cells":["0,0 \"R1\"","0,1","0,2 cs2 fmt\"Total {0}\"","0,3 cs2 \"Grand Total\"","1,0 \"R2\"","1,1","2,0","2,1","2,2","2,3"]},
  "2-1-1": {"columns":4,"rows":4,"cells":["0,0 \"R1\"","0,1","0,2 cs2 fmt\"Total {0}\"","0,3 cs2 \"Grand Total\"","1,0 \"R2\"","1,1","2,0","2,1","2,2","2,3","3,0 \"Grand Total\"","3,1","3,2","3,3"]},
  "2-1-3": {"columns":8,"rows":5,"cells":["0,0 rs2 \"R1\"","0,2","0,3 cs2 fmt\"Total {0}\"","0,4 cs2 \"Grand Total\"","1,0 rs2 \"R2\"","1,2","2,0 cs3","2,1 \"D1\"","2,2","2,3","2,4","3,1 \"D2\"","3,2","3,3","3,4","4,1 \"D3\"","4,2","4,3","4,4","5,0 cs3 \"Grand Total\"","5,1 \"D1\"","5,2","5,3","5,4","6,1 \"D2\"","6,2","6,3","6,4","7,1 \"D3\"","7,2","7,3","7,4"]},
  "2-2-2": {"columns":8,"rows":6,"cells":["0,0 rs3 \"R1\"","0,3","0,4 cs2 fmt\"Total {0}\"","0,5 cs2 \"Grand Total\"","1,0 rs3 \"R2\"","1,3","2,0 cs2","2,1 cs2","2,2 \"D1\"","2,3","2,4","2,5","3,2 \"D2\"","3,3","3,4","3,5","4,0 cs2 rs2 fmt\"Total {0}\"","4,2 \"D1\"","4,3","4,4","4,5","5,2 \"D2\"","5,3","5,4","5,5","6,0 cs2 rs2 \"Grand Total\"","6,2 \"D1\"","6,3","6,4","6,5","7,2 \"D2\"","7,3","7,4","7,5"]},
  "2-2-3": {"columns":11,"rows":6,"cells":["0,0 rs3 \"R1\"","0,3","0,4 cs2 fmt\"Total {0}\"","0,5 cs2 \"Grand Total\"","1,0 rs3 \"R2\"","1,3","10,2 \"D3\"","10,3","10,4","10,5","2,0 cs3","2,1 cs3","2,2 \"D1\"","2,3","2,4","2,5","3,2 \"D2\"","3,3","3,4","3,5","4,2 \"D3\"","4,3","4,4","4,5","5,0 cs3 rs2 fmt\"Total {0}\"","5,2 \"D1\"","5,3","5,4","5,5","6,2 \"D2\"","6,3","6,4","6,5","7,2 \"D3\"","7,3","7,4","7,5","8,0 cs3 rs2 \"Grand Total\"","8,2 \"D1\"","8,3","8,4","8,5","9,2 \"D2\"","9,3","9,4","9,5"]},
  "2-3-1": {"columns":6,"rows":6,"cells":["0,0 rs3 \"R1\"","0,3","0,4 cs2 fmt\"Total {0}\"","0,5 cs2 \"Grand Total\"","1,0 rs3 \"R2\"","1,3","2,0 cs2","2,1","2,2","2,3","2,4","2,5","3,1 rs2 fmt\"Total {0}\"","3,3","3,4","3,5","4,0 rs3 fmt\"Total {0}\"","4,3","4,4","4,5","5,0 rs3 \"Grand Total\"","5,3","5,4","5,5"]},
  "3-0-2": {"columns":5,"rows":6,"cells":["0,0 rs2 \"R1\"","0,2 rs2","0,4 cs3 fmt\"Total {0}\"","0,5 cs3 \"Grand Total\"","1,0 rs2 \"R2\"","1,2","1,3 cs2 fmt\"Total {0}\"","2,0 rs2 \"R3\"","2,2","3,0 cs2","3,1 \"D1\"","3,2","3,3","3,4","3,5","4,1 \"D2\"","4,2","4,3","4,4","4,5"]},
  "3-1-1": {"columns":5,"rows":5,"cells":["0,0 \"R1\"","0,1 rs2","0,3 cs3 fmt\"Total {0}\"","0,4 cs3 \"Grand Total\"","1,0 \"R2\"","1,1","1,2 cs2 fmt\"Total {0}\"","2,0 \"R3\"","2,1","3,0","3,1","3,2","3,3","3,4","4,0 \"Grand Total\"","4,1","4,2","4,3","4,4"]},
  "3-2-2": {"columns":9,"rows":7,"cells":["0,0 rs3 \"R1\"","0,3 rs2","0,5 cs3 fmt\"Total {0}\"","0,6 cs3 \"Grand Total\"","1,0 rs3 \"R2\"","1,3","1,4 cs2 fmt\"Total {0}\"","2,0 rs3 \"R3\"","2,3","3,0 cs2","3,1 cs2","3,2 \"D1\"","3,3","3,4","3,5","3,6","4,2 \"D2\"","4,3","4,4","4,5","4,6","5,0 cs2 rs2 fmt\"Total {0}\"","5,2 \"D1\"","5,3","5,4","5,5","5,6","6,2 \"D2\"","6,3","6,4","6,5","6,6","7,0 cs2 rs2 \"Grand Total\"","7,2 \"D1\"","7,3","7,4","7,5","7,6","8,2 \"D2\"","8,3","8,4","8,5","8,6"]},
  "3-3-1": {"columns":7,"rows":7,"cells":["0,0 rs3 \"R1\"","0,3 rs2","0,5 cs3 fmt\"Total {0}\"","0,6 cs3 \"Grand Total\"","1,0 rs3 \"R2\"","1,3","1,4 cs2 fmt\"Total {0}\"","2,0 rs3 \"R3\"","2,3","3,0 cs2","3,1","3,2","3,3","3,4","3,5","3,6","4,1 rs2 fmt\"Total {0}\"","4,3","4,4","4,5","4,6","5,0 rs3 fmt\"Total {0}\"","5,3","5,4","5,5","5,6","6,0 rs3 \"Grand Total\"","6,3","6,4","6,5","6,6"]},
};

/** A cross-tab as DevExpress's serializer wrote it after generating its layout. */
const DX_HUNDREDTHS = "<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"0\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"DataControls\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\" Font=\"Arial, 8pt\"><Bands><Item1 Ref=\"1\" ControlType=\"TopMarginBand\" Name=\"TopMargin\" HeightF=\"50\" /><Item2 Ref=\"2\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"800\"><Controls><Item1 Ref=\"3\" ControlType=\"XRChart\" Name=\"chartSales\" SizeF=\"600,300\" LocationFloat=\"0,0\" BorderColor=\"Black\" Borders=\"None\"><Chart Ref=\"4\"><DataContainer Ref=\"5\" ValidateDataMembers=\"true\"><SeriesSerializable><Item1 Ref=\"6\" Name=\"Sales\" ArgumentDataMember=\"Region\" ValueDataMembersSerializable=\"Amount\" /><Item2 Ref=\"7\" Name=\"Trend\" ArgumentDataMember=\"Region\" ValueDataMembersSerializable=\"Target\"><View Ref=\"8\" TypeNameSerializable=\"LineSeriesView\" /></Item2></SeriesSerializable></DataContainer><OptionsPrint Ref=\"9\" ImageFormat=\"Metafile\" /><Diagram Ref=\"10\" TypeNameSerializable=\"XYDiagram\"><AxisX Ref=\"11\" VisibleInPanesSerializable=\"-1\" /><AxisY Ref=\"12\" VisibleInPanesSerializable=\"-1\" /></Diagram></Chart></Item1><Item2 Ref=\"13\" ControlType=\"XRCrossTab\" Name=\"crossSales\" SizeF=\"300,75\" LocationFloat=\"0,320\"><LayoutOptions Ref=\"14\" /><PrintOptions Ref=\"15\" /><RowFields><Item1 Ref=\"16\" FieldName=\"Region\" /></RowFields><ColumnFields><Item1 Ref=\"17\" FieldName=\"Quarter\" /></ColumnFields><DataFields><Item1 Ref=\"18\" FieldName=\"Amount\" /></DataFields><ColumnDefinitions><Item1 Ref=\"19\" /><Item2 Ref=\"20\" /><Item3 Ref=\"21\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"22\" Height=\"25\" /><Item2 Ref=\"23\" Height=\"25\" /><Item3 Ref=\"24\" Height=\"25\" /></RowDefinitions><Cells><Item1 Ref=\"25\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"Region\" /><Item2 Ref=\"26\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" /><Item3 Ref=\"27\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" /><Item4 Ref=\"28\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" /><Item5 Ref=\"29\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" /><Item6 Ref=\"30\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" /><Item7 Ref=\"31\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" /><Item8 Ref=\"32\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" /><Item9 Ref=\"33\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" /></Cells></Item2><Item3 Ref=\"34\" ControlType=\"XRChart\" Name=\"chartMix\" SizeF=\"400,250\" LocationFloat=\"0,540\" BorderColor=\"Black\" Borders=\"None\"><Chart Ref=\"35\"><DataContainer Ref=\"36\" ValidateDataMembers=\"true\"><SeriesSerializable><Item1 Ref=\"37\" Name=\"Mix\" ArgumentDataMember=\"Category\" ValueDataMembersSerializable=\"Amount\"><View Ref=\"38\" TypeNameSerializable=\"PieSeriesView\" /></Item1></SeriesSerializable></DataContainer><OptionsPrint Ref=\"39\" ImageFormat=\"Metafile\" /></Chart></Item3></Controls></Item2><Item3 Ref=\"40\" ControlType=\"DetailBand\" Name=\"Detail\" HeightF=\"0\" /><Item4 Ref=\"41\" ControlType=\"BottomMarginBand\" Name=\"BottomMargin\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
const DX_MILLIMETRES = "<XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"0\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" SnapGridSize=\"25\" ReportUnit=\"TenthsOfAMillimeter\" Margins=\"254, 254, 254, 254\" PageWidth=\"2159\" PageHeight=\"2794\" Version=\"20.1\" Dpi=\"254\"><Bands><Item1 Ref=\"1\" ControlType=\"ReportHeaderBand\" Name=\"ReportHeader\" HeightF=\"508\" Dpi=\"254\"><Controls><Item1 Ref=\"2\" ControlType=\"XRCrossTab\" Name=\"cross\" SizeF=\"762,190.5\" LocationFloat=\"0,0\" Dpi=\"254\"><LayoutOptions Ref=\"3\" /><PrintOptions Ref=\"4\" AcrossThenDownOffset=\"25.4\" /><RowFields><Item1 Ref=\"5\" FieldName=\"R1\" /></RowFields><ColumnFields><Item1 Ref=\"6\" FieldName=\"C1\" /></ColumnFields><DataFields><Item1 Ref=\"7\" FieldName=\"D1\" /></DataFields><ColumnDefinitions><Item1 Ref=\"8\" Width=\"254\" /><Item2 Ref=\"9\" Width=\"254\" /><Item3 Ref=\"10\" Width=\"254\" /></ColumnDefinitions><RowDefinitions><Item1 Ref=\"11\" Height=\"63.5\" /><Item2 Ref=\"12\" Height=\"63.5\" /><Item3 Ref=\"13\" Height=\"63.5\" /></RowDefinitions><Cells><Item1 Ref=\"14\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"0\" Text=\"R1\" Dpi=\"254\" /><Item2 Ref=\"15\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"1\" Dpi=\"254\" /><Item3 Ref=\"16\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"0\" Dpi=\"254\" /><Item4 Ref=\"17\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"0\" Text=\"Grand Total\" Dpi=\"254\" /><Item5 Ref=\"18\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"1\" Dpi=\"254\" /><Item6 Ref=\"19\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"1\" Dpi=\"254\" /><Item7 Ref=\"20\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"0\" RowIndex=\"2\" Text=\"Grand Total\" Dpi=\"254\" /><Item8 Ref=\"21\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"1\" RowIndex=\"2\" Dpi=\"254\" /><Item9 Ref=\"22\" ControlType=\"XRCrossTabCell\" ColumnIndex=\"2\" RowIndex=\"2\" Dpi=\"254\" /></Cells></Item1></Controls></Item1></Bands></XtraReportsLayoutSerializer>";

const canon = (c: CrossTabCell) =>
  `${c.column},${c.row}` + (c.columnSpan > 1 ? ` cs${c.columnSpan}` : '') + (c.rowSpan > 1 ? ` rs${c.rowSpan}` : '') +
  (c.text !== null ? ` "${c.text}"` : '') + (c.format ? ` fmt"${c.format}"` : '');

const named = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** A report whose header holds one cross-tab, written as the prompt teaches: fields only. */
function report(fields: { rows?: string[]; columns?: string[]; data?: string[] }, opts: { band?: number; y?: number; dpi?: string; unit?: string } = {}) {
  let ref = 10;
  const list = (tag: string, names: string[] = []) =>
    names.length ? `<${tag}>${names.map((f, i) => `<Item${i + 1} Ref="${++ref}" FieldName="${f}" />`).join('')}</${tag}>` : '';
  return '<?xml version="1.0" encoding="utf-8"?>' +
    `<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" ReportUnit="${opts.unit ?? 'HundredthsOfAnInch'}" Version="20.1">` +
    '<Bands><Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" />' +
    `<Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="${opts.band ?? 240}"><Controls>` +
    `<Item1 Ref="4" ControlType="XRCrossTab" Name="cross" LocationFloat="0,${opts.y ?? 10}" SizeF="810,220"${opts.dpi ? ` Dpi="${opts.dpi}"` : ''}>` +
    `<LayoutOptions Ref="5" /><PrintOptions Ref="6" />${list('RowFields', fields.rows)}${list('ColumnFields', fields.columns)}${list('DataFields', fields.data)}</Item1>` +
    '</Controls></Item2><Item3 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20" />' +
    '<Item4 Ref="8" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" /></Bands></XtraReportsLayoutSerializer>';
}

/** A cross-tab's opening tag, definitions and cells, with Refs dropped and cells sorted. */
function serialized(xml: string) {
  const tab = /<Item\d+ Ref="\d+" ControlType="XRCrossTab"[\s\S]*?<\/Cells>/.exec(xml)![0];
  const items = (tag: string) =>
    [...(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(tab)?.[1] ?? '').matchAll(/<Item\d+ Ref="\d+"([^>]*?)\s*\/>/g)].map((m) => m[1].trim());
  return {
    open: /ControlType="XRCrossTab"[^>]*>/.exec(tab)![0].replace(/\s*LocationFloat="[^"]*"/, ''),
    columns: items('ColumnDefinitions'),
    rows: items('RowDefinitions'),
    cells: items('Cells').sort(),
  };
}

describe('crossTabLayout, against what DevExpress generated', () => {
  for (const [shape, expected] of Object.entries(GENERATED)) {
    it(`generates shape ${shape} cell for cell`, () => {
      const [r, c, d] = shape.split('-').map(Number);
      const layout = crossTabLayout({ rows: named('R', r), columns: named('C', c), data: named('D', d) });
      expect({ columns: layout.columns, rows: layout.rows, cells: layout.cells.map(canon).sort() }).toEqual(expected);
    });
  }
});

describe('repairCrossTabs', () => {
  it('writes what DevExpress\'s serializer wrote, attribute for attribute', () => {
    const { xml } = repairCrossTabs(report({ rows: ['Region'], columns: ['Quarter'], data: ['Amount'] }));
    const dx = serialized(DX_HUNDREDTHS);
    expect(serialized(xml)).toEqual({ ...dx, open: dx.open.replace('crossSales', 'cross') });
  });

  it('writes the cells in the control\'s own Dpi, with Width and Dpi as the serializer does outside hundredths', () => {
    const { xml } = repairCrossTabs(report({ rows: ['R1'], columns: ['C1'], data: ['D1'] }, { dpi: '254', unit: 'TenthsOfAMillimeter' }));
    expect(serialized(xml)).toEqual(serialized(DX_MILLIMETRES));
  });

  it('reads a control with no Dpi at 100, as DevExpress does, whatever the report unit', () => {
    // Case s24: a label with no Dpi in a millimetre report printed at hundredths of an inch.
    const { xml } = repairCrossTabs(report({ rows: ['R1'], columns: ['C1'], data: ['D1'] }, { unit: 'TenthsOfAMillimeter' }));
    expect(xml).toContain('SizeF="300,75"');
    expect(xml).not.toContain('Width=');
    expect(xml).not.toContain(' Dpi=');
  });

  it('puts the layout after the field collections, where the serializer writes it', () => {
    const { xml } = repairCrossTabs(report({ rows: ['Region'], columns: ['Quarter'], data: ['Amount'] }));
    expect(xml).toMatch(/<\/DataFields><ColumnDefinitions>[\s\S]*<\/RowDefinitions><Cells>[\s\S]*<\/Cells><\/Item1>/);
  });

  it('takes new Refs above the document\'s highest, all of them unique', () => {
    const before = report({ rows: ['Region', 'Category'], columns: ['Quarter'], data: ['Amount', 'Target'] });
    const { xml } = repairCrossTabs(before);
    const refs = [...xml.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1]));
    expect(new Set(refs).size).toBe(refs.length);
    const highest = Math.max(...[...before.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1])));
    // Shape 2-1-2: 6 column definitions, 5 row definitions and 24 cells.
    expect(refs.filter((r) => r > highest)).toHaveLength(6 + 5 + 24);
  });

  it('leaves a cross-tab whose layout DevExpress generated byte for byte alone, so a second run changes nothing', () => {
    const designer = repairCrossTabs(DX_HUNDREDTHS);
    expect(designer.applied).toBe(false);
    expect(designer.xml).toBe(DX_HUNDREDTHS);
    const once = repairCrossTabs(report({ rows: ['Region'], columns: ['Quarter'], data: ['Amount'] })).xml;
    expect(repairCrossTabs(once)).toMatchObject({ applied: false, xml: once });
  });

  it('replaces a layout that does not match the fields, since DevExpress refuses that too', () => {
    const fresh = repairCrossTabs(report({ rows: ['Region'], columns: ['Quarter'], data: ['Amount'] })).xml;
    const broken = fresh.replace(/<Item9 Ref="\d+" ControlType="XRCrossTabCell"[^>]*\/>/, '');
    expect(findCrossTabProblems(broken)).toEqual([{ name: 'cross', kind: 'wrong-layout' }]);
    const repaired = repairCrossTabs(broken);
    expect(repaired.applied).toBe(true);
    expect(serialized(repaired.xml)).toEqual(serialized(fresh));
    expect(repaired.xml.match(/<Cells>/g)).toHaveLength(1);
  });

  it('opens up a cross-tab written with no fields at all and gives it DevExpress\'s two-by-two layout', () => {
    const xml = report({}).replace(/(<Item1 Ref="4" ControlType="XRCrossTab"[^>]*)>[\s\S]*?<\/Item1>/, '$1 />');
    const { xml: out, repaired } = repairCrossTabs(xml);
    expect(repaired).toEqual([{ name: 'cross', columns: 2, rows: 2, cells: 4 }]);
    expect(out).toMatch(/SizeF="200,50">[\s\S]*<\/Cells><\/Item1><\/Controls>/);
  });

  it('grows the band when the generated grid reaches past it, and only then', () => {
    const fields = { rows: named('R', 3), columns: named('C', 2), data: named('D', 2) };
    // 7 rows of 25 from y=10 end at 185.
    expect(repairCrossTabs(report(fields, { band: 240 })).xml).toContain('Name="ReportHeader" HeightF="240"');
    expect(repairCrossTabs(report(fields, { band: 100 })).xml).toContain('Name="ReportHeader" HeightF="185"');
  });

  it('leaves the band alone for a cross-tab inside a panel, whose position is the panel\'s', () => {
    const inPanel = report({ rows: named('R', 3), columns: named('C', 2), data: named('D', 2) }, { band: 100 })
      .replace('<Controls><Item1 Ref="4" ControlType="XRCrossTab"', '<Controls><Item1 Ref="90" ControlType="XRPanel" Name="p"><Controls><Item1 Ref="4" ControlType="XRCrossTab"')
      .replace('</Item1></Controls></Item2>', '</Item1></Controls></Item1></Controls></Item2>');
    const { xml, applied } = repairCrossTabs(inPanel);
    expect(applied).toBe(true);
    expect(xml).toContain('Name="ReportHeader" HeightF="100"');
  });

  it('escapes a field name written into a cell\'s text', () => {
    const { xml } = repairCrossTabs(report({ rows: ['R&amp;D'], columns: ['Q'], data: ['A'] }));
    expect(xml).toContain('ColumnIndex="0" RowIndex="0" Text="R&amp;D"');
  });

  it('names the cross-tabs DevExpress will refuse, and none once repaired', () => {
    const xml = report({ rows: ['Region'], columns: ['Quarter'], data: ['Amount'] });
    expect(findCrossTabProblems(xml)).toEqual([{ name: 'cross', kind: 'no-layout' }]);
    expect(findCrossTabProblems(repairCrossTabs(xml).xml)).toEqual([]);
  });

  it('says so when there is nothing to do', () => {
    expect(repairCrossTabs('<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>'))
      .toEqual({ xml: '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>', applied: false, reason: 'no cross-tabs', repaired: [] });
    expect(repairCrossTabs(undefined).applied).toBe(false);
  });
});
