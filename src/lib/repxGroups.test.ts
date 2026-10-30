import { describe, expect, it } from 'vitest';
import { repairGroupLevels } from './repxGroups';
import { paginate, parseReportStructure } from './reportPreview';

/*
 * The s19 records and what DevExpress 20.1 printed for them with Region the
 * outer group (`RepxProbe render`, 2026-10-30, variants a and d of case s19 in
 * docs/proposals/devexpress-parity.md). Written without `Level`, the same file
 * printed Category outside Region; the repair has to turn it into this.
 */
const ROWS = [{"Region":"B","Category":"Z","Qty":"1"},{"Region":"A","Category":"X","Qty":"2"},{"Region":"B","Category":"Y","Qty":"3"},{"Region":"A","Category":"Z","Qty":"4"},{"Region":"B","Category":"X","Qty":"5"},{"Region":"A","Category":"Y","Qty":"6"},{"Region":"B","Category":"Z","Qty":"7"},{"Region":"A","Category":"X","Qty":"8"},{"Region":"B","Category":"Y","Qty":"9"},{"Region":"A","Category":"Z","Qty":"10"},{"Region":"B","Category":"X","Qty":"11"},{"Region":"A","Category":"Y","Qty":"12"}];
const REGION_OUTSIDE = ["Region A","Category X","A/X 2","A/X 8","end Category 10","Category Y","A/Y 6","A/Y 12","end Category 18","Category Z","A/Z 4","A/Z 10","end Category 14","end Region 42","Region B","Category X","B/X 5","B/X 11","end Category 16","Category Y","B/Y 3","B/Y 9","end Category 12","Category Z","B/Z 1","B/Z 7","end Category 8","end Region 36"];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');

interface Shape {
  /** Group fields, in file order. */
  headers: string[];
  /** Footers in file order: the field each closes, and the text it prints. */
  footers: { field: string; text: string }[];
  /** `Level` written as-is on bands by name, for the decline cases. */
  levels?: Record<string, number>;
}

function report({ headers, footers, levels = {} }: Shape, wrap = (bands: string) => bands): string {
  let ref = 1;
  const R = () => ++ref;
  const lvl = (name: string) => (name in levels ? ` Level="${levels[name]}"` : '');
  const label = (name: string, expression: string, running?: string) =>
    `<Item1 Ref="${R()}" ControlType="XRLabel" Name="${name}" SizeF="200,18">` +
    (running ? `<Summary Ref="${R()}" Running="${running}" />` : '') +
    `<ExpressionBindings><Item1 Ref="${R()}" EventName="BeforePrint" PropertyName="Text" Expression="${esc(expression)}" /></ExpressionBindings></Item1>`;
  const parts = [
    `ControlType="TopMarginBand" Name="TopMargin" HeightF="20" />`,
    ...headers.map((f) =>
      `ControlType="GroupHeaderBand" Name="gh${f}"${lvl(`gh${f}`)} HeightF="20">` +
      `<GroupFields><Item1 Ref="${R()}" FieldName="${f}" /></GroupFields><Controls>${label(`h${f}`, `'${f} ' + [${f}]`)}</Controls>`),
    `ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>${label('dQty', "[Region] + '/' + [Category] + ' ' + [Qty]")}</Controls>`,
    ...footers.map(({ field, text }) =>
      `ControlType="GroupFooterBand" Name="gf${field}"${lvl(`gf${field}`)} HeightF="20"><Controls>${label(`f${field}`, text, 'Group')}</Controls>`),
    `ControlType="BottomMarginBand" Name="BottomMargin" HeightF="20" />`,
  ];
  const bands = parts.map((p, i) => {
    const n = i + 1;
    return p.endsWith('/>') ? `<Item${n} Ref="${R()}" ${p}` : `<Item${n} Ref="${R()}" ${p}</Item${n}>`;
  }).join('');
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Nested" ReportUnit="HundredthsOfAnInch" Margins="20, 20, 20, 20" PageWidth="850" PageHeight="1100" Version="20.1" DataMember="Items" Font="Arial, 8pt">' +
    `<Bands>${wrap(bands)}</Bands></XtraReportsLayoutSerializer>`;
}

const printed = (xml: string) => {
  const page = paginate(parseReportStructure(xml), ROWS.length, { rows: ROWS }).pages[0];
  return page.bands.flatMap((band) => band.controls.map((pc) => ({ y: band.top + pc.y, s: pc.text ?? '' })))
    .sort((a, b) => a.y - b.y).map((t) => t.s);
};

const levelOf = (xml: string, name: string) => new RegExp(`Name="${name}"( Level="(\\d+)")?`).exec(xml)?.[2] ?? null;

describe('repairGroupLevels', () => {
  const s19c: Shape = {
    headers: ['Region', 'Category'],
    footers: [{ field: 'Region', text: "'end Region ' + sumSum([Qty])" }, { field: 'Category', text: "'end Category ' + sumSum([Qty])" }],
  };

  it('turns s19c, which DevExpress printed inside out, into the nesting it printed with Level', () => {
    const before = report(s19c);
    expect(printed(before)[0]).toBe('Category X');
    const repaired = repairGroupLevels(before);
    expect(repaired.applied).toBe(true);
    expect(printed(repaired.xml)).toEqual(REGION_OUTSIDE);
  });

  it('writes Level only above 0, after the band name, as the designer does', () => {
    const { xml, levels } = repairGroupLevels(report(s19c));
    expect(xml).toContain('Name="ghRegion" Level="1" HeightF="20"');
    expect(xml).toContain('Name="gfRegion" Level="1" HeightF="20"');
    expect(levelOf(xml, 'ghCategory')).toBeNull();
    expect(levelOf(xml, 'gfCategory')).toBeNull();
    expect(levels).toEqual([
      { band: 'ghRegion', level: 1 }, { band: 'ghCategory', level: 0 },
      { band: 'gfRegion', level: 1 }, { band: 'gfCategory', level: 0 },
    ]);
  });

  it('pairs footers that name no field in the order the page prints them, innermost first', () => {
    const shape: Shape = {
      headers: ['Region', 'Category'],
      footers: [{ field: 'Category', text: "'Subtotal ' + sumSum([Qty])" }, { field: 'Region', text: "'Total ' + sumSum([Qty])" }],
    };
    const { xml } = repairGroupLevels(report(shape));
    expect(levelOf(xml, 'gfCategory')).toBeNull();
    expect(levelOf(xml, 'gfRegion')).toBe('1');
  });

  it('pairs a footer with the group it names, in its text or a binding', () => {
    const byText = repairGroupLevels(report({ headers: ['Region', 'Category'], footers: [{ field: 'Region', text: "'Region total: ' + sumSum([Qty])" }] }));
    expect(levelOf(byText.xml, 'gfRegion')).toBe('1');
    const byBinding = repairGroupLevels(report({ headers: ['Region', 'Category'], footers: [{ field: 'Region', text: "[Region] + ': ' + sumSum([Qty])" }] }));
    expect(levelOf(byBinding.xml, 'gfRegion')).toBe('1');
    // And it prints Region's totals, as DevExpress printed s19f with Level 1.
    expect(printed(byText.xml).filter((t) => t.startsWith('Region total'))).toEqual(['Region total: 42', 'Region total: 36']);
  });

  it('gives a lone footer that names nothing to the innermost group, as DevExpress already did', () => {
    const { xml } = repairGroupLevels(report({ headers: ['Region', 'Category'], footers: [{ field: 'Region', text: "'end ' + sumSum([Qty])" }] }));
    expect(levelOf(xml, 'ghRegion')).toBe('1');
    expect(levelOf(xml, 'gfRegion')).toBeNull();
  });

  it('pairs a footer naming two groups with the inner one', () => {
    const { xml } = repairGroupLevels(report({
      headers: ['Region', 'Category'],
      footers: [{ field: 'Category', text: "[Region] + '/' + [Category]" }, { field: 'Region', text: "'All ' + sumSum([Qty])" }],
    }));
    expect(levelOf(xml, 'gfCategory')).toBeNull();
    expect(levelOf(xml, 'gfRegion')).toBe('1');
  });

  it('matches a field name as a whole word only', () => {
    const { xml } = repairGroupLevels(report({
      headers: ['Region', 'Category'],
      footers: [{ field: 'Category', text: "'All regions ' + sumSum([Qty])" }, { field: 'Region', text: "'x'" }],
    }));
    // "regions" names neither group, so both footers pair innermost first.
    expect(levelOf(xml, 'gfCategory')).toBeNull();
    expect(levelOf(xml, 'gfRegion')).toBe('1');
  });

  it('numbers three levels from the top', () => {
    const { levels } = repairGroupLevels(report({ headers: ['Region', 'Category', 'Qty'], footers: [] }));
    expect(levels).toEqual([{ band: 'ghRegion', level: 2 }, { band: 'ghCategory', level: 1 }, { band: 'ghQty', level: 0 }]);
  });

  it('leaves a report alone once any group band declares a Level, so a second run changes nothing', () => {
    const once = repairGroupLevels(report(s19c)).xml;
    const twice = repairGroupLevels(once);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once);
    const declared = repairGroupLevels(report({ ...s19c, levels: { gfCategory: 0 } }));
    expect(declared.applied).toBe(false);
    expect(declared.reason).toMatch(/already declared/);
  });

  it('leaves a single group, an ungrouped report and more footers than headers alone', () => {
    expect(repairGroupLevels(report({ headers: ['Region'], footers: [{ field: 'Region', text: "'t'" }] })).applied).toBe(false);
    expect(repairGroupLevels(report({ headers: [], footers: [] })).reason).toBe('no nested groups without a Level');
    const extra = repairGroupLevels(report({
      headers: ['Region', 'Category'],
      footers: [{ field: 'Region', text: "'a'" }, { field: 'Category', text: "'b'" }, { field: 'Qty', text: "'c'" }],
    }));
    expect(extra.applied).toBe(false);
    expect(extra.reason).toMatch(/3 group footers for 2 headers/);
  });

  it('numbers a detail report\'s groups as a list of their own', () => {
    const inner = report(s19c).match(/<Bands>([\s\S]*)<\/Bands>/)![1];
    const xml = report({ headers: ['Region'], footers: [] }, (bands) =>
      bands.replace('<Item3 ', `<Item9 Ref="900" ControlType="DetailReportBand" Name="Lines" Level="0" DataMember="Lines"><Bands>${inner}</Bands></Item9><Item3 `));
    const { xml: out, levels } = repairGroupLevels(xml);
    expect(levels.map((l) => l.band)).toEqual(['ghRegion', 'ghCategory', 'gfRegion', 'gfCategory']);
    // The outer report's single group keeps no Level; the detail report's outer group gets 1.
    expect(out.match(/Name="ghRegion"[^>]*>/g)).toEqual(['Name="ghRegion" HeightF="20">', 'Name="ghRegion" Level="1" HeightF="20">']);
  });

  it('returns empty input untouched', () => {
    expect(repairGroupLevels(undefined)).toEqual({ xml: '', applied: false, reason: 'no nested groups without a Level', levels: [] });
  });
});
