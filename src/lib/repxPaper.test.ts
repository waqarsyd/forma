import { describe, expect, it } from 'vitest';
import { findPaperProblem, printedPaper, repairPaper } from './repxPaper';

/*
 * Parity row 44. Each expected root is what DevExpress 20.1's serializer wrote
 * for that paper (`emit-paper`, 2026-10-31), and each printed size is what it
 * printed in cases s30p1 to s30p8.
 */
const root = (attrs: string) =>
  `<?xml version="1.0" encoding="utf-8"?><XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" Name="R"${attrs} Version="20.1"><Bands /></XtraReportsLayoutSerializer>`;
const rootOf = (xml: string) => /<XtraReportsLayoutSerializer\b[^>]*>/.exec(xml)![0];
const attrsOf = (xml: string) => rootOf(xml).replace(/^<XtraReportsLayoutSerializer|>$/g, '');

describe('repairPaper', () => {
  it('names each paper as the serializer does, in every unit', () => {
    const cases: [string, string][] = [
      [' PageWidth="827" PageHeight="1169"', ' PaperKind="A4" PageWidth="827" PageHeight="1169"'],
      [' PageWidth="850" PageHeight="1400"', ' PaperKind="Legal" PageWidth="850" PageHeight="1400"'],
      [' PageWidth="1100" PageHeight="1700"', ' PaperKind="Tabloid" PageWidth="1100" PageHeight="1700"'],
      [' ReportUnit="TenthsOfAMillimeter" PageWidth="2100" PageHeight="2970"', ' ReportUnit="TenthsOfAMillimeter" PaperKind="A4" PageWidth="2100" PageHeight="2970"'],
      [' ReportUnit="Pixels" PageWidth="794" PageHeight="1123"', ' ReportUnit="Pixels" PaperKind="A4" PageWidth="794" PageHeight="1123"'],
    ];
    for (const [written, named] of cases) expect(rootOf(repairPaper(root(written)).xml)).toBe(rootOf(root(named)));
  });

  it('turns a wider-than-tall page landscape, naming the paper unless it is Letter', () => {
    expect(rootOf(repairPaper(root(' PageWidth="1100" PageHeight="850"')).xml)).toBe(rootOf(root(' Landscape="true" PageWidth="1100" PageHeight="850"')));
    expect(rootOf(repairPaper(root(' PageWidth="1169" PageHeight="827"')).xml)).toBe(rootOf(root(' Landscape="true" PaperKind="A4" PageWidth="1169" PageHeight="827"')));
    expect(rootOf(repairPaper(root(' ReportUnit="TenthsOfAMillimeter" PageWidth="4318" PageHeight="2794"')).xml))
      .toBe(rootOf(root(' ReportUnit="TenthsOfAMillimeter" Landscape="true" PaperKind="Tabloid" PageWidth="4318" PageHeight="2794"')));
  });

  it('calls a size no paper has Custom, as DevExpress writes it', () => {
    expect(rootOf(repairPaper(root(' PageWidth="900" PageHeight="600"')).xml)).toBe(rootOf(root(' PaperKind="Custom" PageWidth="900" PageHeight="600"')));
  });

  it('leaves Letter portrait, a named paper and a page with no size alone, and runs once', () => {
    for (const attrs of [' PageWidth="850" PageHeight="1100"', ' PaperKind="A4" PageWidth="850" PageHeight="1100"', ' Landscape="true" PageWidth="1100" PageHeight="850"', '']) {
      const xml = root(attrs);
      expect(repairPaper(xml)).toMatchObject({ xml, applied: false });
    }
    const once = repairPaper(root(' PageWidth="827" PageHeight="1169"')).xml;
    expect(repairPaper(once)).toMatchObject({ xml: once, applied: false });
    expect(repairPaper(undefined)).toEqual({ xml: '', applied: false, reason: 'no report root' });
  });
});

describe('printedPaper, the page DevExpress prints', () => {
  it('is Letter when no paper is named, whatever size is written (s30p1, s30p3, s30p6)', () => {
    for (const attrs of [' PageWidth="827" PageHeight="1169"', ' PageWidth="1100" PageHeight="850"', ' PageWidth="850" PageHeight="1400"']) {
      expect(printedPaper(attrsOf(root(attrs)))).toEqual({ kind: 'Letter', landscape: false, width: 850, height: 1100 });
    }
  });

  it('is the named paper\'s own size, turned for landscape, whatever size is written (s30p2, s30p7, s30p8)', () => {
    // DevExpress printed A4 at 2480.315 by 3507.874 three-hundredths of an inch.
    const a4 = printedPaper(attrsOf(root(' PaperKind="A4" PageWidth="850" PageHeight="1100"')));
    expect(a4.width * 3).toBeCloseTo(2480.315, 2);
    expect(a4.height * 3).toBeCloseTo(3507.874, 2);
    const turned = printedPaper(attrsOf(root(' Landscape="true" PaperKind="A4" PageWidth="827" PageHeight="1169"')));
    expect([turned.width * 3, turned.height * 3].map((n) => Math.round(n * 1000) / 1000)).toEqual([3507.874, 2480.315]);
    expect(printedPaper(attrsOf(root(' Landscape="true" PageWidth="1100" PageHeight="850"')))).toMatchObject({ width: 1100, height: 850 });
  });

  it('is the size written for a Custom paper, and for one this app has no size for (s30p5)', () => {
    expect(printedPaper(attrsOf(root(' PaperKind="Custom" PageWidth="900" PageHeight="600"')))).toMatchObject({ width: 900, height: 600 });
    expect(printedPaper(attrsOf(root(' PaperKind="A3" PageWidth="1169" PageHeight="1654"')))).toMatchObject({ width: 1169, height: 1654 });
  });

  it('is the paper written for once the repair has named it', () => {
    for (const attrs of [' PageWidth="827" PageHeight="1169"', ' PageWidth="1169" PageHeight="827"', ' ReportUnit="Pixels" PageWidth="816" PageHeight="1344"', ' PageWidth="900" PageHeight="600"']) {
      const written = attrsOf(root(attrs));
      const printed = printedPaper(attrsOf(repairPaper(root(attrs)).xml));
      const w = Number(/PageWidth="([^"]*)"/.exec(written)![1]);
      const h = Number(/PageHeight="([^"]*)"/.exec(written)![1]);
      expect(Math.abs(printed.width - w)).toBeLessThanOrEqual(1);
      expect(Math.abs(printed.height - h)).toBeLessThanOrEqual(1);
    }
  });
});

describe('findPaperProblem', () => {
  it('finds a page written for another paper than the one DevExpress prints', () => {
    expect(findPaperProblem(root(' PageWidth="827" PageHeight="1169"'))).toEqual({
      written: { width: 827, height: 1169 }, printed: { kind: 'Letter', landscape: false, width: 850, height: 1100 }, named: false,
    });
    expect(findPaperProblem(root(' PaperKind="A4" PageWidth="850" PageHeight="1100"'))).toMatchObject({ named: true, printed: { kind: 'A4' } });
  });

  it('finds nothing once the paper is named, nor for Letter, a Custom paper or no size written', () => {
    expect(findPaperProblem(repairPaper(root(' PageWidth="827" PageHeight="1169"')).xml)).toBeNull();
    for (const attrs of [' PageWidth="850" PageHeight="1100"', ' PaperKind="Custom" PageWidth="900" PageHeight="600"', '']) {
      expect(findPaperProblem(root(attrs))).toBeNull();
    }
    expect(findPaperProblem(undefined)).toBeNull();
  });
});
