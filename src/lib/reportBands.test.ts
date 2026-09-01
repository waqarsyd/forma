import { describe, it, expect } from 'vitest';
import { bandedLayoutEnabled, rootStructurePrompt, type RootStructureOptions } from './reportBands';

const OPTS: RootStructureOptions = {
  page: { width: 850, height: 1100 },
  reportUnit: 'HundredthsOfAnInch',
  targetVersion: '23.2',
  targetSerializerVersion: '23.2.3.0',
};

const flat = rootStructurePrompt(OPTS, false);
const banded = rootStructurePrompt(OPTS, true);

describe('bandedLayoutEnabled', () => {
  it('is off unless the flag is exactly "true"', () => {
    for (const env of [{}, { VITE_FORMA_BANDED: 'false' }, { VITE_FORMA_BANDED: '1' }, { VITE_FORMA_BANDED: 'TRUE' }]) {
      expect(bandedLayoutEnabled(env), JSON.stringify(env)).toBe(false);
    }
    expect(bandedLayoutEnabled({ VITE_FORMA_BANDED: 'true' })).toBe(true);
  });
});

/**
 * The flat variant is the shipping behaviour, and the A/B is worthless if
 * extracting it into a module changed it. These assertions are the ones that
 * would catch a stray edit while the banded prompt is being tuned.
 */
describe('the flat structure is unchanged from what shipped', () => {
  it('still asks for exactly three bands, Detail at full page height', () => {
    expect(flat).toContain('ControlType="TopMarginBand" Name="TopMargin" HeightF="0"');
    expect(flat).toContain('ControlType="DetailBand" Name="Detail" HeightF="1100"');
    expect(flat).toContain('ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0"');
    for (const band of ['ReportHeaderBand', 'PageHeaderBand', 'ReportFooterBand', 'PageFooterBand']) {
      expect(flat, `flat must not mention ${band}`).not.toContain(band);
    }
  });

  it('still tells the model not to convert coordinates', () => {
    // The load-bearing sentence: with one band at y=0 the page frame and the
    // band frame are the same, which is why flat output is reliably placed.
    expect(flat).toContain('Do NOT subtract or add anything to the PHASE 1 coordinates');
  });

  it('carries the page and version values through', () => {
    expect(flat).toContain('PageWidth="850"');
    expect(flat).toContain('PageHeight="1100"');
    expect(flat).toContain('ReportUnit="HundredthsOfAnInch"');
    expect(flat).toContain('SerializerVersion="23.2.3.0"');
    expect(flat).toContain('Version="23.2"');
  });
});

describe('the banded prototype', () => {
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

  it('keeps the rules that are true in both shapes', () => {
    for (const shape of [flat, banded]) {
      expect(shape).toContain('Do NOT set non-zero Margins');
      expect(shape).toContain('x + width <= 850');
    }
  });

  it('says where each part of a document belongs', () => {
    for (const cue of ['ReportHeader —', 'PageHeader —', 'Detail —', 'ReportFooter —', 'PageFooter —']) {
      expect(banded, `missing band guidance: ${cue}`).toContain(cue);
    }
  });

  it('handles a design with no repeating rows rather than forcing a Detail band', () => {
    expect(banded).toMatch(/leave Detail out entirely rather than emitting an empty one/i);
  });
});
