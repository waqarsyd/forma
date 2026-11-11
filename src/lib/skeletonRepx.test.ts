// @vitest-environment jsdom
/*
 * A skeleton made into a report again. jsdom because `checkRepx` parses with
 * the browser's DOMParser, as the app does before it offers a download.
 */
import { describe, expect, it } from 'vitest';
import { checkRepx } from './repx';
import { auditRepx } from './repxAudit';
import { parseReportStructure } from './reportPreview';
import { skeletonOf, type ReportSkeleton, type SkeletonControl } from './reportSkeleton';
import { fieldFromCaption, mergePageSkeletons, skeletonToDesign, type PageText } from './skeletonRepx';

const font = (size: number, bold = false) => ({ family: 'Arial', size, bold, italic: false });
const label = (over: Partial<SkeletonControl>): SkeletonControl => ({
  kind: 'label',
  role: 'caption',
  x: 0,
  y: 0,
  w: 100,
  h: 20,
  font: font(9),
  align: 'left',
  borders: 0,
  chars: 0,
  ...over,
});

/** A grouped list: a title, a ruled heading row, a group line, a record, totals and a page number. */
const skeleton: ReportSkeleton = {
  paper: 'A4',
  landscape: false,
  width: 827,
  height: 1169,
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  bands: [
    { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
    { kind: 'ReportHeader', height: 60, groupFields: 0, controls: [label({ role: 'title', y: 10, w: 400, h: 30, font: font(16, true), align: 'center', chars: 12 })] },
    {
      kind: 'PageHeader',
      height: 25,
      groupFields: 0,
      controls: [
        label({
          kind: 'table',
          role: 'value',
          w: 700,
          h: 25,
          font: font(9, true),
          borders: 4,
          rows: [
            [
              { weight: 2, role: 'caption', align: 'left', chars: 4, font: font(9, true) },
              { weight: 1, role: 'caption', align: 'right', chars: 6, font: font(9, true) },
            ],
          ],
        }),
      ],
    },
    { kind: 'GroupHeader', height: 25, groupFields: 1, controls: [label({ role: 'value', w: 300, h: 25, font: font(9, true) })] },
    {
      kind: 'Detail',
      height: 20,
      groupFields: 0,
      controls: [
        label({
          kind: 'table',
          role: 'value',
          w: 700,
          h: 20,
          rows: [
            [
              { weight: 2, role: 'value', align: 'left', chars: 0, font: font(9) },
              { weight: 1, role: 'value', align: 'right', chars: 0, font: font(9) },
            ],
          ],
        }),
      ],
    },
    { kind: 'GroupFooter', height: 22, groupFields: 0, controls: [label({ role: 'total', x: 467, y: 2, w: 233, h: 18, font: font(9, true), align: 'right', borders: 1 })] },
    {
      kind: 'ReportFooter',
      height: 22,
      groupFields: 0,
      controls: [label({ y: 2, w: 200, h: 18, font: font(9, true), chars: 11 }), label({ role: 'total', x: 467, y: 2, w: 233, h: 18, font: font(9, true), align: 'right' })],
    },
    { kind: 'PageFooter', height: 20, groupFields: 0, controls: [label({ kind: 'pageInfo', role: 'pageInfo', x: 500, w: 200, font: font(8), align: 'right' })] },
    { kind: 'BottomMargin', height: 50, groupFields: 0, controls: [] },
  ],
};

/** What OCR read on the page: the title, the two column captions and the date in the page footer. */
const texts: PageText[] = [
  { text: 'Stock Register', x: 160, y: 66, w: 180, h: 20 },
  { text: 'Item', x: 56, y: 115, w: 40, h: 14 },
  { text: 'Quantity', x: 690, y: 115, w: 55, h: 14 },
  { text: '03/11/2026', x: 690, y: 1103, w: 60, h: 12 },
];

/**
 * Caption lengths aside, and the page to whole hundredths: `repairPaper`
 * writes A4 as DevExpress's serializer does, 826.77 by 1169.29.
 */
const withoutLengths = (k: ReportSkeleton) => ({
  ...k,
  width: Math.round(k.width),
  height: Math.round(k.height),
  bands: k.bands.map((b) => ({ ...b, controls: b.controls.map((c) => ({ ...c, chars: 0, rows: c.rows?.map((r) => r.map((cell) => ({ ...cell, chars: 0 }))) })) })),
});

describe('skeletonToDesign', () => {
  it('writes a report that reads back as the skeleton it was written from', () => {
    const { repx } = skeletonToDesign(skeleton);
    // Captions keep placeholders without a reading, so their lengths differ; nothing else may.
    expect(withoutLengths(skeletonOf(parseReportStructure(repx)))).toEqual(withoutLengths(skeleton));
  });

  it('writes a file the app opens and the audit finds no error in', () => {
    const { repx } = skeletonToDesign(skeleton, { texts });
    expect(checkRepx(repx).ok).toBe(true);
    expect(auditRepx(repx).findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(repx).toContain('PaperKind="A4"');
  });

  it("takes each title and caption's words from what was read inside its box", () => {
    const design = skeletonToDesign(skeleton, { texts });
    expect(design.title).toBe('Stock Register');
    expect(design.repx).toContain('Text="Item"');
    expect(design.repx).toContain('Text="Quantity"');
    expect(design.read).toBe(3);
  });

  // The draft's second weak spot (2026-11-10, run.ts --forma): a footer is not stacked, so its caption had no box to be read in.
  it("finds a footer caption's words where the footer was read on the page (pageTop)", () => {
    const placed = { ...skeleton, bands: skeleton.bands.map((b) => (b.kind === 'ReportFooter' ? { ...b, pageTop: 300 } : b)) };
    const read = [...texts, { text: 'Grand Total', x: 60, y: 304, w: 90, h: 14 }];
    expect(skeletonToDesign(skeleton, { texts: read }).repx).not.toContain('Text="Grand Total"');
    const design = skeletonToDesign(placed, { texts: read });
    expect(design.repx).toContain('Text="Grand Total"');
    expect(design.placeholders).toBe(0);
  });

  it('keeps a placeholder where nothing was read, and "Total" in a footer', () => {
    const design = skeletonToDesign(skeleton, { texts, title: 'Given title' });
    expect(design.placeholders).toBe(1);
    expect(design.repx).toContain('Text="Total"');
    expect(skeletonToDesign(skeleton, { title: 'Given title' }).title).toBe('Given title');
  });

  it('binds each value to a field named after the caption over its column, and each total to the field above it', () => {
    const design = skeletonToDesign(skeleton, { texts });
    expect(design.fields).toEqual(['Item', 'Item2', 'Quantity']);
    expect(design.repx).toContain('Expression="[Quantity]"');
    expect(design.repx).toMatch(/Running="Group" \/><ExpressionBindings><Item1 Ref="\d+" EventName="BeforePrint" PropertyName="Text" Expression="sumSum\(\[Quantity\]\)"/);
    expect(design.repx).toMatch(/Running="Report" \/>/);
    expect(design.repx).toContain('FieldName="Item"');
  });

  it('prints a date where the page showed one, and the page number otherwise', () => {
    expect(skeletonToDesign(skeleton, { texts }).repx).toContain('PageInfo="DateTime"');
    expect(skeletonToDesign(skeleton).repx).toContain('TextFormatString="Page {0} of {1}"');
  });

  it('adds the empty Detail band DevExpress expects to a page read with none, before its footers', () => {
    const k: ReportSkeleton = { ...skeleton, bands: skeleton.bands.filter((b) => b.kind !== 'Detail' && b.kind !== 'GroupHeader' && b.kind !== 'GroupFooter') };
    const { repx } = skeletonToDesign(k);
    const kinds = parseReportStructure(repx).bands.map((b) => b.kind);
    expect(kinds).toEqual(['TopMargin', 'ReportHeader', 'PageHeader', 'Detail', 'ReportFooter', 'PageFooter', 'BottomMargin']);
    expect(checkRepx(repx).ok).toBe(true);
  });

  it("fills every pane: the Mockup's sections and the spec", () => {
    const design = skeletonToDesign(skeleton, { texts });
    expect(design.layout.sections.map((s) => s.name)).toEqual(['Report header', 'Page header', 'Group header', 'Detail', 'Group footer', 'Report footer', 'Page footer']);
    expect(design.layout.sections[1].elements[0].rows?.[0].cells.map((c) => c.content)).toEqual(['Item', 'Quantity']);
    expect(design.markdown).toContain('1 caption still needs its words.');
    expect(design.markdown).toContain('Check the figures and fonts against the page in the Preview.');
  });

  // The full audit (2026-11-11, PL-07): the Spec says what the report is, never which part of Forma read it.
  it('writes a Spec in plain words, whoever read the page', () => {
    for (const readBy of [undefined, "Forma's box reader, from the text OCR read", "Forma's vision model"]) {
      const { markdown } = skeletonToDesign(skeleton, { texts, readBy });
      expect(markdown).toMatch(/^# /);
      expect(markdown).not.toMatch(/OCR|box reader|own model|vision model|learned from|no model|AI service|the model/i);
    }
    expect(skeletonToDesign(skeleton).markdown).toMatch(/4 captions still need their words\./);
  });
});

describe('mergePageSkeletons', () => {
  const band = (kind: ReportSkeleton['bands'][number]['kind'], height: number) => ({ kind, height, groupFields: kind === 'GroupHeader' ? 1 : 0, controls: [] });
  const page = (kinds: [ReportSkeleton['bands'][number]['kind'], number][], paper: ReportSkeleton['paper'] = 'A4'): ReportSkeleton => ({
    paper,
    landscape: false,
    width: 827,
    height: 1169,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    bands: kinds.map(([k, h]) => band(k, h)),
  });

  it("keeps the first page's bands and adds the kinds only a later page shows, where DevExpress prints them", () => {
    const first = page([['TopMargin', 40], ['ReportHeader', 80], ['PageHeader', 25], ['Detail', 20], ['PageFooter', 20], ['BottomMargin', 40]]);
    const last = page([['TopMargin', 40], ['PageHeader', 30], ['Detail', 22], ['GroupFooter', 25], ['ReportFooter', 30], ['PageFooter', 20], ['BottomMargin', 40]], 'Letter');
    const merged = mergePageSkeletons(first, last);
    expect(merged.bands.map((b) => `${b.kind} ${b.height}`)).toEqual([
      'TopMargin 40',
      'ReportHeader 80',
      // The first page's, not the last's: the repeating bands are read where the words were.
      'PageHeader 25',
      'Detail 20',
      'GroupFooter 25',
      'ReportFooter 30',
      'PageFooter 20',
      'BottomMargin 40',
    ]);
    expect(merged.paper).toBe('A4');
  });

  it('is the first page itself when there is no other', () => {
    const only = page([['PageHeader', 25], ['Detail', 20]]);
    expect(mergePageSkeletons(only)).toEqual(only);
  });
});

describe('fieldFromCaption', () => {
  it('runs the words together as a field name', () => {
    expect(fieldFromCaption('Net amount (AED)')).toBe('NetAmountAED');
    expect(fieldFromCaption('2nd Qty')).toBe('F2ndQty');
    expect(fieldFromCaption('—')).toBe('');
  });
});
