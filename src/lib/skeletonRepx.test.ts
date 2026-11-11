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
    // The record's item takes `Field2`, not a numbered copy of the group's (CC-09).
    expect(design.fields).toEqual(['Item', 'Field2', 'Quantity']);
    expect(design.repx).toContain('Expression="[Quantity]"');
    expect(design.repx).toMatch(/Running="Group" \/><ExpressionBindings><Item1 Ref="\d+" EventName="BeforePrint" PropertyName="Text" Expression="sumSum\(\[Quantity\]\)"/);
    expect(design.repx).toMatch(/Running="Report" \/>/);
    expect(design.repx).toContain('FieldName="Item"');
  });

  /*
   * CC-09 (2026-11-11): Forma's own drafts bound `[QuarterlySalesByRegion2]`,
   * `[INVOICE2]` to `[INVOICE6]`, `[billingNorthwindExample]` and
   * `[F2721HarborAvenueSuite400]`, and grouped on the title, so the page's own
   * records could not be printed through them.
   */
  it('never names a field after the title, sample text or a repeat of another', () => {
    const k: ReportSkeleton = {
      ...skeleton,
      bands: [
        { kind: 'TopMargin', height: 50, groupFields: 0, controls: [] },
        {
          kind: 'ReportHeader',
          height: 120,
          groupFields: 0,
          controls: [
            // The title, read as a caption in a large face.
            label({ y: 0, w: 400, h: 30, font: font(18, true) }),
            // A key and its value on one line.
            label({ y: 40, w: 100, h: 16 }),
            label({ role: 'value', x: 110, y: 40, w: 150, h: 16 }),
            // An address read as a caption, over a value.
            label({ x: 400, y: 40, w: 250, h: 16 }),
            label({ role: 'value', x: 400, y: 60, w: 250, h: 16 }),
          ],
        },
        { kind: 'PageHeader', height: 20, groupFields: 0, controls: [label({ y: 0, w: 200, h: 20 }), label({ x: 300, y: 0, w: 200, h: 20 })] },
        { kind: 'GroupHeader', height: 20, groupFields: 1, controls: [label({ role: 'value', x: 0, y: 0, w: 200, h: 20 })] },
        { kind: 'Detail', height: 20, groupFields: 0, controls: [label({ role: 'value', x: 0, y: 0, w: 200, h: 20 }), label({ role: 'value', x: 300, y: 0, w: 200, h: 20 })] },
        { kind: 'BottomMargin', height: 50, groupFields: 0, controls: [] },
      ],
    };
    const read: PageText[] = [
      { text: 'Quarterly Sales by Region', x: 60, y: 55, w: 300, h: 24 },
      { text: 'Invoice No', x: 55, y: 92, w: 80, h: 12 },
      { text: '2026-0417', x: 165, y: 92, w: 80, h: 12 },
      { text: '2721 Harbor Avenue, Suite 400', x: 455, y: 92, w: 200, h: 12 },
      { text: 'Region', x: 55, y: 173, w: 60, h: 14 },
      { text: 'Revenue', x: 355, y: 173, w: 60, h: 14 },
    ];
    const design = skeletonToDesign(k, { texts: read });
    expect(design.fields).toEqual(['InvoiceNo', 'Field2', 'Region', 'Field4', 'Revenue']);
    expect(design.repx).not.toMatch(/QuarterlySalesByRegion\]|F2721|Region2|Revenue2/);
    expect(design.repx).toContain('FieldName="Region"');
    expect(auditRepx(design.repx).findings.map((f) => f.code)).not.toContain('field-named-after-text');
  });

  /*
   * CC-06 (2026-11-11): DevExpress printed "1240" and "10/14/2026 12:00 AM"
   * where the page shows "1,240" and "14 Oct 2026", because no value carried
   * a format; the page's own text says which.
   */
  it('prints a value and the totals over it as the page printed the value (CC-06)', () => {
    const read: PageText[] = [...texts, { text: '1,240', x: 700, y: 163, w: 40, h: 14 }];
    const { repx } = skeletonToDesign(skeleton, { texts: read });
    expect(repx).toMatch(/TextFormatString="\{0:n0\}"[^>]*><ExpressionBindings><Item1 [^>]*Expression="\[Quantity\]"/);
    expect(repx).toMatch(/TextFormatString="\{0:n0\}"[^>]*><Summary Ref="\d+" Running="Group" \/><ExpressionBindings><Item1 [^>]*Expression="sumSum\(\[Quantity\]\)"/);
    expect(repx.match(/TextFormatString="\{0:n0\}"/g)).toHaveLength(3);
    // A value with no text read, or one printed as its own text, gets none.
    expect(skeletonToDesign(skeleton, { texts }).repx).not.toMatch(/TextFormatString="\{0:n/);
    expect(skeletonToDesign(skeleton, { texts: [...texts, { text: '18', x: 700, y: 163, w: 20, h: 14 }] }).repx).not.toMatch(/TextFormatString="\{0:n/);
  });

  // CC-05 (2026-11-11): every total was a sum, and a "Margin %" column added up to 248.3.
  it('averages a column the page calls a percentage, a rate or a margin, and sums the rest (CC-05)', () => {
    const read = texts.map((t) => (t.text === 'Quantity' ? { ...t, text: 'Margin %' } : t));
    const { repx } = skeletonToDesign(skeleton, { texts: read });
    expect(repx.match(/Expression="sumAvg\(\[Margin\]\)"/g)).toHaveLength(2);
    expect(repx).not.toContain('sumSum(');
    expect(auditRepx(repx).findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  // The review of CC-05 (2026-11-11): a sales report's "Margin" beside Revenue
  // and Cost, or an invoice's "Rate", is money, and its total is a sum.
  it('sums a bare "Margin" or "Rate" column over plain money, and averages it only when its values print a "%"', () => {
    for (const caption of ['Margin', 'Rate']) {
      const read = [...texts.map((t) => (t.text === 'Quantity' ? { ...t, text: caption } : t)), { text: '1,240.00', x: 700, y: 163, w: 50, h: 14 }];
      const { repx } = skeletonToDesign(skeleton, { texts: read });
      expect(repx.match(new RegExp(`Expression="sumSum\\(\\[${caption}\\]\\)"`, 'g'))).toHaveLength(2);
      expect(repx).not.toContain('sumAvg(');
    }
    const percent = [...texts.map((t) => (t.text === 'Quantity' ? { ...t, text: 'Margin' } : t)), { text: '28.7%', x: 700, y: 163, w: 40, h: 14 }];
    expect(skeletonToDesign(skeleton, { texts: percent }).repx.match(/Expression="sumAvg\(\[Margin\]\)"/g)).toHaveLength(2);
  });

  it('writes whole margins and a whole page, as DevExpress keeps them (CC-03)', () => {
    const fractional = { ...skeleton, paper: 'Custom' as const, width: 826.4, height: 1169.6, margins: { top: 43.45, bottom: 23.4, left: 50.6, right: 14.92 } };
    const { repx } = skeletonToDesign(fractional);
    expect(/Margins="([^"]*)"/.exec(repx)?.[1]).toBe('50, 14, 43, 23');
    expect(repx).toMatch(/ControlType="TopMarginBand" Name="TopMargin1" HeightF="43"/);
    expect(repx).toMatch(/ControlType="BottomMarginBand" Name="BottomMargin\d+" HeightF="23"/);
    expect(auditRepx(repx).findings.map((f) => f.code)).not.toContain('margins-not-whole');
  });

  it('holds a page-high band to what the rounded margins leave, and no further', () => {
    // 1100 less 49.6 and 49.6 is 1000.8; written as 50 and 50, the page leaves 1000.
    const page = (height: number): ReportSkeleton => ({
      ...skeleton,
      paper: 'Letter',
      width: 850,
      height: 1100,
      margins: { top: 49.6, bottom: 49.6, left: 50, right: 50 },
      bands: [
        { kind: 'TopMargin', height: 49.6, groupFields: 0, controls: [] },
        { kind: 'ReportHeader', height, groupFields: 0, controls: [] },
        { kind: 'BottomMargin', height: 49.6, groupFields: 0, controls: [] },
      ],
    });
    expect(skeletonToDesign(page(1000.8)).repx).toMatch(/ControlType="ReportHeaderBand" Name="ReportHeader2" HeightF="1000"/);
    // A band read taller than a rounding's worth is left for band-taller-than-page to name.
    expect(skeletonToDesign(page(1040)).repx).toMatch(/ControlType="ReportHeaderBand" Name="ReportHeader2" HeightF="1040"/);
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
    // There is no `readBy` to pass any more (2026-11-11): the Spec cannot name a reader.
    for (const title of [undefined, 'Invoice']) {
      const { markdown } = skeletonToDesign(skeleton, { texts, title });
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
