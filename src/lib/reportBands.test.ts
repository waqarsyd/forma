import { describe, it, expect } from 'vitest';
import { rootStructurePrompt, tableRowsRule, type RootStructureOptions } from './reportBands';

const OPTS: RootStructureOptions = {
  page: { width: 850, height: 1100 },
  reportUnit: 'HundredthsOfAnInch',
  targetVersion: '23.2',
  targetSerializerVersion: '23.2.3.0',
};

const banded = rootStructurePrompt(OPTS);

describe('the banded default', () => {
  it('emits the five content bands in the order XtraReports reads them', () => {
    const order = ['TopMarginBand', 'ReportHeaderBand', 'PageHeaderBand', 'DetailBand', 'ReportFooterBand', 'PageFooterBand', 'BottomMarginBand'];
    const positions = order.map((b) => banded.indexOf(b));
    expect(positions.every((p) => p >= 0), 'every band must appear').toBe(true);
    // Band sequence is semantic, not cosmetic: a PageHeaderBand written after
    // Detail is a different report, and the designer will not reorder it.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('does NOT size the Detail band to the page, which is the whole point', () => {
    expect(banded).not.toContain(`ControlType="DetailBand" Name="Detail" HeightF="1100"`);
    expect(banded).toMatch(/HeightF is ONE ROW's height/i);
    expect(banded).toMatch(/Do NOT emit an XRTable containing every row/i);
  });

  it('tells the model to convert Y into band-relative coordinates', () => {
    // The flat prompt's "do not subtract anything" is actively wrong here, and
    // shipping both sentences at once is the failure this asserts against.
    expect(banded).not.toContain('Do NOT subtract or add anything');
    expect(banded).toMatch(/SUBTRACT the top edge of the band/i);
    // A worked example, because the rule alone has not been enough elsewhere.
    expect(banded).toContain('336 - 320 = 16');
  });

  it('keeps the two rules that predate the banded shape', () => {
    // These were asserted against both variants until the flat one was removed
    // on 2026-09-05. They are older than the band skeleton and independent of
    // it, which is why they are still worth pinning separately from the rules
    // above rather than folded into them.
    expect(banded).toContain('Do NOT set non-zero Margins');
    expect(banded).toContain('x + width <= 850');
  });

  it('says where each part of a document belongs', () => {
    for (const cue of ['ReportHeader —', 'PageHeader —', 'Detail —', 'ReportFooter —', 'PageFooter —']) {
      expect(banded, `missing band guidance: ${cue}`).toContain(cue);
    }
  });

  it('still allows a design with genuinely no repeating rows to omit Detail', () => {
    expect(banded).toMatch(/leave Detail out/i);
  });

  it('gives a test for "repeating rows" rather than leaving it to judgement', () => {
    /*
     * The escape hatch above used to list "a form" as an example of a design
     * with no repeating rows. A real job card on 2026-09-04 took it: the whole
     * document went into ReportHeader, no Detail band was emitted, and nothing
     * could be bound — while the SAME source half an hour earlier had produced
     * a Detail band with twelve bound columns. A form is exactly the case that
     * usually does have repeating data in the middle of it, so the rule now
     * states the signal, names that case, and states the cost.
     */
    expect(banded).toMatch(/heading row with two or more rows of like-kind values/i);
    expect(banded).toMatch(/job card/i);
    expect(banded).toMatch(/is NOT a reason to leave Detail out/i);
    expect(banded).toMatch(/CANNOT be bound to a data source/i);
  });

  /**
   * `liftReportMargins` declines outright when either margin band is absent, so
   * the invitation to omit unused bands has to exempt those two by name. Losing
   * this sentence turns the margin lift off silently on every generation.
   */
  it('exempts the margin bands from the invitation to omit unused bands', () => {
    expect(banded).toMatch(/TopMargin and BottomMargin are NOT optional/i);
    expect(banded).toMatch(/omit any you have no content for/i);
  });

  /**
   * The Detail row and the PageHeader heading row print directly above one
   * another. Weights that disagree are the one table defect a preview cannot
   * show, because the layout JSON draws a single table for both.
   */
  it('ties the Detail row to the heading row it prints under', () => {
    expect(banded).toMatch(/SAME cell Weight values/i);
    expect(banded).toMatch(/heading table you put in PageHeader/i);
  });

  it('maps the layout sections onto the bands, minus the margins', () => {
    expect(banded).toMatch(/THE LAYOUT JSON MIRRORS THESE BANDS/i);
    expect(banded).toMatch(/Do not emit margin bands as sections/i);
  });
});

/**
 * The rule these sentences close ends by demanding every row of a repeating
 * region. That is right for the layout JSON and wrong for a banded Detail band —
 * which is the single reason the file can be bound to data at all. The sentence
 * therefore has to say both things about one region without contradicting
 * itself, and losing that distinction reintroduces the defect the band split
 * exists to fix.
 */
describe('tableRowsRule', () => {
  it('splits the table across bands', () => {
    const rule = tableRowsRule();
    expect(rule).toMatch(/heading row goes in PageHeader/i);
    expect(rule).toMatch(/ONE data row goes in Detail/i);
    expect(rule).toMatch(/totals row goes in ReportFooter/i);
  });

  it('still keeps every row in the mockup', () => {
    // The rows are not discarded by the split — they move to the artifact whose
    // job is showing the source. A version of this rule that drops them from the
    // layout too would look like the truncation bug.
    expect(tableRowsRule()).toMatch(/EVERY row/);
  });
});
