/**
 * The rule this file enforces is one-directional, and that is the whole point.
 *
 * Including a section nobody needed costs tokens. Omitting one that was needed
 * costs a feature, silently — the model draws a chart as labels and rectangles
 * because nothing told it `XRChart` exists, and the result reads as the model
 * being lazy rather than as a prompt that was trimmed. So every test here is
 * really asking the same question: **does this evidence PROVE the section is
 * unnecessary?** Anything short of proof must keep it.
 */
import { describe, it, expect } from 'vitest';
import { sectionsFor, describeSections, ALL_SECTIONS, type PromptSection } from './promptSections';

const repx = (body = '') =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">' +
  `<Bands><Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="100">${body}</Item1></Bands>` +
  '</XtraReportsLayoutSerializer>';

const has = (sections: PromptSection[], s: PromptSection) => sections.includes(s);

describe('with no .repx in the request', () => {
  it('includes everything for an image-only request', () => {
    expect(sectionsFor({ texts: [] })).toEqual([...ALL_SECTIONS]);
  });

  it('includes everything when there is no evidence at all', () => {
    expect(sectionsFor()).toEqual([...ALL_SECTIONS]);
    expect(sectionsFor({})).toEqual([...ALL_SECTIONS]);
  });

  /**
   * The common path, and the one this optimisation deliberately does not touch.
   * A PDF's text layer says what the page reads, not what controls the report
   * needs, so it can never prove a section unnecessary.
   */
  it('includes everything for a PDF text layer, however much it says', () => {
    const pageText = 'INVOICE\nItem Description  Amount\nWidget  1,250.00\nTOTAL  1,250.00';
    expect(sectionsFor({ texts: [pageText] })).toEqual([...ALL_SECTIONS]);
  });

  it('is not fooled by page text that merely mentions a repx file', () => {
    // The discriminator is the root element, not the word. A scanned page whose
    // text happens to name a file must not be treated as structural truth.
    expect(sectionsFor({ texts: ['see attached Invoice.repx for the layout'] }))
      .toEqual([...ALL_SECTIONS]);
  });
});

describe('with a .repx source, omitting only what it rules out', () => {
  it('drops every section for a plain flat report', () => {
    const sections = sectionsFor({ texts: [repx()] });
    expect(sections).toEqual([]);
  });

  it('keeps grouping when the source groups', () => {
    const sections = sectionsFor({ texts: [repx('<GroupFields><Item1 FieldName="Region" /></GroupFields>')] });
    expect(has(sections, 'grouping')).toBe(true);
    expect(has(sections, 'charts')).toBe(false);
  });

  it('keeps charts for a chart and for a cross-tab alike', () => {
    for (const marker of ['ControlType="XRChart"', 'ControlType="XRCrossTab"']) {
      expect(has(sectionsFor({ texts: [repx(`<Controls><Item1 ${marker} /></Controls>`)] }), 'charts'), marker).toBe(true);
    }
  });

  it('keeps parameters for a declaration or a reference', () => {
    expect(has(sectionsFor({ texts: [repx('<Parameters><Item1 Name="From" /></Parameters>')] }), 'parameters')).toBe(true);
    expect(has(sectionsFor({ texts: [repx('<Controls><Item1 Text="[Parameters.Region]" /></Controls>')] }), 'parameters')).toBe(true);
  });

  it('keeps only the section a control belongs to', () => {
    // The split: a .repx with a checkbox must not pay for panels, subreports,
    // cross-band rules and shapes as well.
    for (const [marker, section] of [
      ['XRCheckBox', 'checkbox'],
      ['XRCrossBandLine', 'crossband'],
      ['XRPanel', 'containers'],
      ['XRSubreport', 'containers'],
      ['XRShape', 'shapes'],
      ['XRRichText', 'shapes'],
    ] as [string, PromptSection][]) {
      const sections = sectionsFor({ texts: [repx(`<Controls><Item1 ControlType="${marker}" /></Controls>`)] });
      expect(sections, marker).toEqual([section]);
    }
  });

  it('keeps a section the PREVIOUS report uses, not just the uploaded one', () => {
    // A refinement turn: the .repx being uploaded may be plain while the report
    // on the bench already has a chart, and the refinement must not lose it.
    const sections = sectionsFor({
      texts: [repx()],
      previousRepx: repx('<Controls><Item1 ControlType="XRChart" /></Controls>'),
    });
    expect(has(sections, 'charts')).toBe(true);
  });

  /**
   * The case that decides whether this is safe: the user asking for something
   * the source does not have. Omitting on the file alone would make "add a chart"
   * impossible to satisfy, and the failure would look like the model ignoring
   * the instruction.
   */
  it('keeps a section the user asks for even when nothing else shows it', () => {
    for (const [instruction, section] of [
      ['Add a bar chart of amount by region', 'charts'],
      ['Group the rows by customer', 'grouping'],
      ['Let the reader pick a date range', 'parameters'],
      ['Put a tick box next to each line', 'checkbox'],
    ] as [string, PromptSection][]) {
      const sections = sectionsFor({ texts: [repx()], instruction });
      expect(has(sections, section), instruction).toBe(true);
    }
  });

  it('errs toward inclusion on a broad word', () => {
    // "box" and "rule" match far more than checkboxes and cross-band lines.
    // That is deliberate: a needless section costs tokens, a missing one costs
    // a feature.
    expect(has(sectionsFor({ texts: [repx()], instruction: 'draw a box round the total' }), 'containers')).toBe(true);
    expect(has(sectionsFor({ texts: [repx()], instruction: 'add a rule under the heading' }), 'crossband')).toBe(true);
  });

  it('is case-insensitive about what the user typed', () => {
    expect(has(sectionsFor({ texts: [repx()], instruction: 'ADD A PIE CHART' }), 'charts')).toBe(true);
  });

  it('does not let one section keep the others', () => {
    const sections = sectionsFor({ texts: [repx('<GroupFields><Item1 FieldName="Region" /></GroupFields>')] });
    expect(sections).toEqual(['grouping']);
  });
});

describe('describeSections', () => {
  it('says nothing was dropped when nothing was', () => {
    expect(describeSections(ALL_SECTIONS)).toContain('all optional sections included');
  });

  it('names what it dropped and why', () => {
    const line = describeSections(['grouping']);
    expect(line).toContain('charts');
    expect(line).toContain('parameters');
    expect(line).toContain('containers');
    expect(line).toContain('shapes');
    expect(line).not.toMatch(/omitted[^—]*grouping/);
    expect(line).toContain('.repx');
  });
});

/**
 * The list of sections must not drift from the signal maps.
 *
 * This is a regression test for a bug that shipped for about an hour: adding a
 * fifth section to the union and to both Records typechecked cleanly, because a
 * Record<PromptSection, RegExp> forces every key while a readonly
 * PromptSection[] is satisfied by any subset. ALL_SECTIONS stayed at four, so
 * sectionsFor could never return the new one and the prompt block it gated was
 * never sent. Nothing failed; the feature simply did not exist.
 */
describe('ALL_SECTIONS', () => {
  it('covers every section the type allows', () => {
    // Written out by hand on purpose: deriving it the same way the module does
    // would make this test agree with itself rather than with the type.
    const expected: PromptSection[] = [
      'grouping', 'parameters', 'charts', 'rules', 'calculated', 'sorting', 'watermark', 'columns', 'bookmarks', 'gauges',
      'checkbox', 'crossband', 'containers', 'shapes',
    ];
    expect([...ALL_SECTIONS].sort()).toEqual([...expected].sort());
  });

  it('can actually return the newest section', () => {
    const withRules = '<XtraReportsLayoutSerializer><FormattingRuleSheet><Item1 Ref="1" Name="R" /></FormattingRuleSheet></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [withRules] })).toContain('rules');
  });

  it('drops rules for a report that has none and an instruction that wants none', () => {
    const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [plain] })).not.toContain('rules');
  });

  it('keeps rules when the user asks for conditional formatting in their own words', () => {
    const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';
    for (const instruction of [
      'highlight overdue rows',
      'show negative amounts in red',
      'flag anything when the total exceeds 10000',
      'add conditional formatting',
    ]) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('rules');
    }
  });
});

describe('calculated fields as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept when the source declares one', () => {
    const withCalc = '<XtraReportsLayoutSerializer><CalculatedFields><Item1 Ref="1" Name="T" /></CalculatedFields></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [withCalc] })).toEqual(['calculated']);
  });

  it('is dropped for a report that has none', () => {
    expect(sectionsFor({ texts: [plain] })).not.toContain('calculated');
  });

  it('is kept when the user asks for arithmetic in their own words', () => {
    for (const instruction of [
      'make the total a calculated field',
      'the line total should be computed from quantity times price',
      'add a derived column',
    ]) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('calculated');
    }
  });
});

describe('sorting as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept when the source sorts', () => {
    const sorted = '<XtraReportsLayoutSerializer><Bands><Item1 ControlType="DetailBand"><SortFields><Item1 FieldName="D" /></SortFields></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [sorted] })).toEqual(['sorting']);
  });

  it('is NOT kept by a grouped report alone', () => {
    // GroupFields sorts implicitly, but it is not a <SortFields> and the
    // sorting block would be dead weight for it.
    const grouped = '<XtraReportsLayoutSerializer><Bands><Item1 ControlType="GroupHeaderBand"><GroupFields><Item1 FieldName="Region" /></GroupFields></Item1></Bands></XtraReportsLayoutSerializer>';
    const sections = sectionsFor({ texts: [grouped] });
    expect(sections).toContain('grouping');
    expect(sections).not.toContain('sorting');
  });

  it('is kept when the user asks for an order in their own words', () => {
    for (const instruction of [
      'sort by customer name',
      'newest first please',
      'list them alphabetical',
      'order by amount descending',
    ]) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('sorting');
    }
  });
});

describe('watermark as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept for a text watermark and for an image one alike', () => {
    // An image watermark cannot be authored, but a source that HAS one still
    // needs the block: it carries the instruction to copy ImageSource across.
    for (const mark of ['<Watermark Ref="1" Text="DRAFT" />', '<Watermark Ref="1" ImageSource="AAAA" />']) {
      const xml = `<XtraReportsLayoutSerializer><Bands />${mark}</XtraReportsLayoutSerializer>`;
      expect(sectionsFor({ texts: [xml] }), mark).toEqual(['watermark']);
    }
  });

  it('is dropped for a report with none', () => {
    expect(sectionsFor({ texts: [plain] })).not.toContain('watermark');
  });

  it('is kept when the user asks for one in their own words', () => {
    for (const instruction of ['add a DRAFT watermark', 'stamp CONFIDENTIAL across it', 'mark it as draft']) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('watermark');
    }
  });
});

describe('multi-column as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept when a band declares columns', () => {
    const cols = '<XtraReportsLayoutSerializer><Bands><Item1 ControlType="DetailBand"><MultiColumn Ref="3" ColumnCount="3" /></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [cols] })).toEqual(['columns']);
  });

  it('is dropped for an ordinary single-column report', () => {
    expect(sectionsFor({ texts: [plain] })).not.toContain('columns');
  });

  it('is kept when the user describes the shape rather than naming it', () => {
    for (const instruction of ['print it two-up', 'lay the records out side by side', 'make it a label sheet']) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('columns');
    }
  });
});

describe('bookmarks as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept for a literal bookmark and for a bound one', () => {
    for (const mark of ['<Item1 Bookmark="North" />', '<Item1 PropertyName="Bookmark" Expression="[Region]" />']) {
      const xml = `<XtraReportsLayoutSerializer><Bands>${mark}</Bands></XtraReportsLayoutSerializer>`;
      expect(sectionsFor({ texts: [xml] }), mark).toEqual(['bookmarks']);
    }
  });

  it('is dropped for a report with none', () => {
    expect(sectionsFor({ texts: [plain] })).not.toContain('bookmarks');
  });

  it('is kept when the user asks for navigation in their own words', () => {
    for (const instruction of ['add a document map', 'I want to jump to each section', 'give it bookmarks']) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('bookmarks');
    }
  });
});

describe('gauges and sparklines as a section', () => {
  const plain = '<XtraReportsLayoutSerializer><Bands /></XtraReportsLayoutSerializer>';

  it('is kept for either control', () => {
    for (const marker of ['XRGauge', 'XRSparkline']) {
      const xml = `<XtraReportsLayoutSerializer><Bands><Item1 ControlType="${marker}" /></Bands></XtraReportsLayoutSerializer>`;
      expect(sectionsFor({ texts: [xml] }), marker).toEqual(['gauges']);
    }
  });

  it('does not drag in the charts section, and is not dragged in by it', () => {
    // XRSparkline used to be a charts signal as well, so a sparkline pulled in
    // three kilobytes of chart syntax it had no use for.
    const chart = '<XtraReportsLayoutSerializer><Bands><Item1 ControlType="XRChart" /></Bands></XtraReportsLayoutSerializer>';
    expect(sectionsFor({ texts: [chart] })).toEqual(['charts']);
  });

  it('is dropped for a report with neither', () => {
    expect(sectionsFor({ texts: [plain] })).not.toContain('gauges');
  });

  it('is kept when the user asks for one in their own words', () => {
    for (const instruction of ['add a gauge for completion', 'show a trend line', 'a progress bar for each row']) {
      expect(sectionsFor({ texts: [plain], instruction }), instruction).toContain('gauges');
    }
  });
});
