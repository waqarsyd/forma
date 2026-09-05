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

  it('keeps containers for any of the four controls', () => {
    for (const marker of ['XRCheckBox', 'XRPanel', 'XRSubreport', 'XRCrossBandLine']) {
      expect(has(sectionsFor({ texts: [repx(`<Controls><Item1 ControlType="${marker}" /></Controls>`)] }), 'containers'), marker).toBe(true);
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
      ['Put a tick box next to each line', 'containers'],
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
    expect(has(sectionsFor({ texts: [repx()], instruction: 'add a rule under the heading' }), 'containers')).toBe(true);
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
    expect(line).not.toMatch(/omitted[^—]*grouping/);
    expect(line).toContain('.repx');
  });
});
