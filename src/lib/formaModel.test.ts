/**
 * Forma's own model (2026-11-02): reports reduced to skeletons that carry no
 * words, and a model learned from them that is checked to hold none. The
 * reports here are made up for the test; the owner's training set never enters
 * the repository, and the model learned from it is checked as these are.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseReportStructure } from './reportPreview';
import { FEATURE_NAMES, paperName, skeletonFeatures, skeletonOf, type ReportSkeleton } from './reportSkeleton';
import { categoryOf, kMedoids, learnModel, rankArchetypes, unexpectedStrings, type FormaModel, type TrainingReport } from './formaModel';

const ROOT = 'SerializerVersion="20.1.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a" Version="20.1"';

/** A made-up report: a title, captions, a bound line table grouped by a field, a total. */
function report(o: { name: string; width?: number; height?: number; landscape?: boolean; grouped?: boolean; columns?: number; title?: string }): string {
  const cols = o.columns ?? 3;
  const caption = (k: number) => `<Item${k + 1} Ref="${100 + k}" ControlType="XRTableCell" Name="headCell${k}" Text="Heading ${k}" Weight="1" Font="Arial, 9pt, style=Bold" />`;
  const value = (k: number) =>
    `<Item${k + 1} Ref="${200 + k}" ControlType="XRTableCell" Name="valueCell${k}" Weight="1" Font="Arial, 8pt"><ExpressionBindings><Item1 Ref="${300 + k}" EventName="BeforePrint" PropertyName="Text" Expression="[SecretField${k}]" /></ExpressionBindings></Item${k + 1}>`;
  const table = (id: string, cells: string) => `<Item1 Ref="${id}" ControlType="XRTable" Name="${id}Table" SizeF="650,25" LocationFloat="0,0"><Rows><Item1 Ref="${id}1" ControlType="XRTableRow" Name="${id}Row" Weight="1"><Cells>${cells}</Cells></Item1></Rows></Item1>`;
  const header = Array.from({ length: cols }, (_, k) => caption(k)).join('');
  const values = Array.from({ length: cols }, (_, k) => value(k)).join('');
  return (
    `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer ${ROOT} Name="${o.name}" Margins="40, 40, 50, 50" PageWidth="${o.width ?? 827}" PageHeight="${o.height ?? 1169}"${o.landscape ? ' Landscape="true"' : ''} PaperKind="A4"><Bands>` +
    '<Item1 Ref="1" ControlType="TopMarginBand" HeightF="50" />' +
    `<Item2 Ref="2" ControlType="ReportHeaderBand" HeightF="60"><Controls><Item1 Ref="3" ControlType="XRLabel" Name="clientTitle" Text="${o.title ?? 'Confidential Client Ltd statement'}" Font="Arial, 16pt, style=Bold" SizeF="500,30" LocationFloat="0,0" /></Controls></Item2>` +
    `<Item3 Ref="4" ControlType="PageHeaderBand" HeightF="25"><Controls>${table('h', header)}</Controls></Item3>` +
    (o.grouped ? '<Item4 Ref="5" ControlType="GroupHeaderBand" HeightF="25"><GroupFields><Item1 Ref="6" FieldName="SecretRegion" /></GroupFields></Item4>' : '') +
    `<Item5 Ref="7" ControlType="DetailBand" HeightF="25"><Controls>${table('d', values)}</Controls></Item5>` +
    '<Item6 Ref="8" ControlType="ReportFooterBand" HeightF="25"><Controls><Item1 Ref="9" ControlType="XRLabel" Name="grandTotal" SizeF="100,25" LocationFloat="550,0" Font="Arial, 8pt, style=Bold"><Summary Ref="10" Running="Report" /><ExpressionBindings><Item1 Ref="11" EventName="BeforePrint" PropertyName="Text" Expression="sumSum([SecretAmount])" /></ExpressionBindings></Item1></Controls></Item6>' +
    '<Item7 Ref="12" ControlType="BottomMarginBand" HeightF="50" />' +
    '</Bands></XtraReportsLayoutSerializer>'
  );
}

const skeleton = (xml: string) => skeletonOf(parseReportStructure(xml));

describe('skeletonOf', () => {
  it('keeps the structure and the role of every text, and none of its words', () => {
    const k = skeleton(report({ name: 'AcmeSecretReport', grouped: true }));
    const json = JSON.stringify(k);
    for (const word of ['Confidential', 'Client', 'Heading', 'SecretField', 'SecretRegion', 'SecretAmount', 'AcmeSecretReport', 'clientTitle', 'headCell', 'grandTotal']) {
      expect(json, word).not.toContain(word);
    }
    expect(k.paper).toBe('A4');
    expect(k.bands.map((b) => b.kind)).toEqual(['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'ReportFooter', 'BottomMargin']);
    const [title] = k.bands[1].controls;
    expect(title).toMatchObject({ kind: 'label', role: 'title', font: { family: 'Arial', size: 16, bold: true } });
    expect(title.chars).toBe('Confidential Client Ltd statement'.length);
    expect(k.bands[2].controls[0].rows![0].map((c) => c.role)).toEqual(['caption', 'caption', 'caption']);
    expect(k.bands[4].controls[0].rows![0].map((c) => c.role)).toEqual(['value', 'value', 'value']);
    expect(k.bands[5].controls[0].role).toBe('total');
    expect(k.bands[3].groupFields).toBe(1);
  });

  it('names the paper by its size, either way up', () => {
    expect(paperName(827, 1169)).toEqual({ paper: 'A4', landscape: false });
    expect(paperName(1169, 827)).toEqual({ paper: 'A4', landscape: true });
    expect(paperName(850, 1100)).toEqual({ paper: 'Letter', landscape: false });
    expect(paperName(110, 26)).toEqual({ paper: 'Custom', landscape: true });
  });

  it('describes a report by numbers two reports can be compared by', () => {
    const f = skeletonFeatures(skeleton(report({ name: 'r', grouped: true, columns: 5 })));
    expect(f).toHaveLength(FEATURE_NAMES.length);
    const by = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, f[i]]));
    expect(by.detailHasTable).toBe(1);
    expect(by.groupHeaders).toBeCloseTo(Math.log1p(1));
    expect(by.detailValues).toBeCloseTo(Math.log1p(5));
    expect(by.totals).toBeCloseTo(Math.log1p(1));
  });
});

describe('categoryOf', () => {
  it('names a generic category, never the folder it was found in', () => {
    expect(categoryOf('Some Client Document Printing/Invoice A.repx')).toBe('document');
    expect(categoryOf('Payroll/Monthly.repx')).toBe('payroll');
    expect(categoryOf('Stock Balance/x.repx')).toBe('stock');
    expect(categoryOf('Label Printing/y.repx')).toBe('label');
    expect(categoryOf('Client Folder/z.repx')).toBeNull();
    expect(categoryOf('a register of our stock, grouped by warehouse')).toBe('stock');
  });
});

describe('learnModel', () => {
  const set: TrainingReport[] = [
    ...[3, 4, 5].map((c) => ({ skeleton: skeleton(report({ name: `inv${c}`, columns: c })), category: 'document' })),
    ...[6, 7, 8].map((c) => ({ skeleton: skeleton(report({ name: `stk${c}`, columns: c, grouped: true, width: 1169, height: 827, landscape: true })), category: 'stock' })),
  ];
  const model = learnModel(set, { k: 2, date: '2026-11-02', minCategoryReports: 3 });

  it('learns the house style by role', () => {
    expect(model.reports).toBe(6);
    expect(model.style.fonts[0]).toMatchObject({ family: 'Arial' });
    expect(model.style.roles.title).toMatchObject({ family: 'Arial', size: 16, bold: 1 });
    expect(model.style.roles.value).toMatchObject({ size: 8, bold: 0 });
    expect(model.style.roles.total).toMatchObject({ size: 8, bold: 1 });
    expect(model.style.margins.A4).toEqual({ top: 50, bottom: 50, left: 40, right: 40 });
  });

  it('finds the two kinds of report, each with its category', () => {
    expect(model.archetypes.length).toBeGreaterThanOrEqual(2);
    const grouped = model.archetypes.find((a) => a.categories[0]?.name === 'stock')!;
    const documents = model.archetypes.find((a) => a.categories[0]?.name === 'document')!;
    expect(grouped.label).toBe('Grouped register, landscape');
    expect(grouped.skeleton.landscape).toBe(true);
    expect(documents.skeleton.bands.some((b) => b.kind === 'GroupHeader')).toBe(false);
  });

  it('ranks the archetype a request names first', () => {
    expect(rankArchetypes(model, { category: 'stock' })[0].categories[0].name).toBe('stock');
    expect(rankArchetypes(model, { category: 'document', grouped: false })[0].categories[0].name).toBe('document');
  });

  it('holds no word outside its vocabulary, and says which when one is slipped in', () => {
    expect(unexpectedStrings(model)).toEqual([]);
    const tampered = JSON.parse(JSON.stringify(model)) as FormaModel;
    (tampered.archetypes[0].skeleton.bands[0] as unknown as { note: string }).note = 'Confidential Client Ltd';
    tampered.style.fonts.push({ family: 'ClientNameFont', share: 0 });
    tampered.archetypes[0].skeleton.bands[1].controls[0].font!.family = 'Wingdings';
    expect(unexpectedStrings(tampered).sort()).toEqual(['Confidential Client Ltd', 'Wingdings']);
  });

  it('clusters the same way every time for the same set', () => {
    const vectors = set.map((r) => skeletonFeatures(r.skeleton));
    expect(kMedoids(vectors, 2, model.scale)).toEqual(kMedoids(vectors, 2, model.scale));
  });
});

describe('the shipped model', () => {
  it('was learned from structure only: no string outside its vocabulary', () => {
    const shipped = JSON.parse(readFileSync('assets/model/formaModel.json', 'utf8')) as FormaModel;
    expect(shipped.version).toBe(1);
    expect(shipped.reports).toBeGreaterThan(300);
    expect(unexpectedStrings(shipped)).toEqual([]);
    for (const a of shipped.archetypes) expect((a.skeleton as ReportSkeleton).bands.length).toBeGreaterThan(0);
  });
});
