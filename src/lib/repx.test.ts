import { describe, it, expect } from 'vitest';
import { checkRepx, formatXml, tokenizeXml } from './repx';

const VALID = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

/**
 * checkRepx is the only thing between a malformed generation and the user
 * finding out when DevExpress refuses the file, so each rejection reason is
 * asserted separately — "not ok" alone would not catch the check drifting to
 * the wrong reason.
 */
describe('checkRepx', () => {
  it('accepts well-formed DevExpress XML', () => {
    expect(checkRepx(VALID)).toEqual({ ok: true, message: 'Valid DevExpress report XML.', warnings: [] });
  });

  it('rejects empty or whitespace-only input', () => {
    expect(checkRepx('').ok).toBe(false);
    expect(checkRepx('   \n  ').ok).toBe(false);
    expect(checkRepx('').message).toMatch(/No REPX/i);
  });

  it('rejects XML that does not parse', () => {
    const broken = '<XtraReportsLayoutSerializer><Bands></XtraReportsLayoutSerializer>';
    const result = checkRepx(broken);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/does not parse/i);
  });

  it('rejects a valid document with the wrong root element', () => {
    const wrongRoot = '<Report><Bands /></Report>';
    const result = checkRepx(wrongRoot);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Unexpected root element/i);
    expect(result.message).toContain('Report');
  });

  it('rejects a correct root that contains no Bands — it would open empty', () => {
    const noBands = '<XtraReportsLayoutSerializer Name="Report1" />';
    const result = checkRepx(noBands);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no <Bands>/i);
  });
});

/**
 * The geometry pass, added after an audit found the generated XML systematically
 * offset by the page margin — and `checkRepx` passing it, because the file
 * parsed and had a root and a `<Bands>`.
 *
 * The invariant these protect is that **a geometry problem must never set
 * `ok: false`**. `ok` gates Export and Open in designer; a control fifty units
 * too wide still opens perfectly well, and refusing to export it would be a
 * worse failure than the one being reported.
 */
const page = (bands: string, attrs = 'PageWidth="850" PageHeight="1100" Margins="0, 0, 0, 0"') =>
  `<XtraReportsLayoutSerializer Name="Report1" ${attrs}><Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

const detail = (controls: string, height = 1100) =>
  `<Item1 ControlType="DetailBand" Name="Detail" HeightF="${height}"><Controls>${controls}</Controls></Item1>`;

describe('checkRepx geometry', () => {
  it('says nothing about a report that fits', () => {
    const xml = page(detail('<Item1 ControlType="XRLabel" Name="label1" LocationFloat="40,30" SizeF="300,40" />'));
    const result = checkRepx(xml);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.message).toBe('Valid DevExpress report XML.');
  });

  it('catches the margin bug: page-absolute coordinates inside a margined page', () => {
    // The exact defect. Margins of 100 leave 650 printable, and a design mapped
    // onto the full 850-wide page puts elements past it. The band is sized to
    // the printable height so this asserts the width warning alone.
    const xml = page(
      detail('<Item1 ControlType="XRLabel" Name="total" LocationFloat="700,30" SizeF="120,20" />', 900),
      'PageWidth="850" PageHeight="1100" Margins="100, 100, 100, 100"'
    );
    const result = checkRepx(xml);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/past the 650-unit printable width/);
    expect(result.warnings[0]).toContain('total');
  });

  it('still exports: geometry never sets ok to false', () => {
    const xml = page(detail('<Item1 ControlType="XRLabel" Name="wide" LocationFloat="0,0" SizeF="2000,20" />'));
    expect(checkRepx(xml).ok).toBe(true);
  });

  it('flags a control that overflows its own band', () => {
    const xml = page(detail('<Item1 ControlType="XRLabel" Name="tall" LocationFloat="0,90" SizeF="100,60" />', 100));
    const result = checkRepx(xml);
    expect(result.warnings[0]).toMatch(/past the 100-unit height of DetailBand/);
  });

  it('flags a negative position', () => {
    const xml = page(detail('<Item1 ControlType="XRLabel" Name="stray" LocationFloat="-20,10" SizeF="100,20" />'));
    expect(checkRepx(xml).warnings[0]).toMatch(/off the page at -20,10/);
  });

  it('flags bands that total more than the page', () => {
    const xml = page(
      `<Item1 ControlType="DetailBand" Name="Detail" HeightF="900" /><Item2 ControlType="ReportFooterBand" Name="Footer" HeightF="400" />`
    );
    expect(checkRepx(xml).warnings[0]).toMatch(/run onto a second page/);
  });

  it('ignores controls nested inside another control', () => {
    // A cell or a panel child is positioned relative to its parent, so
    // measuring it against the page would invent failures. Better to check
    // less and be right.
    const xml = page(
      detail(
        '<Item1 ControlType="XRTable" Name="table1" LocationFloat="0,0" SizeF="800,20">' +
        '<Rows><Item1 ControlType="XRTableRow" Name="row1" Weight="1">' +
        '<Cells><Item1 ControlType="XRTableCell" Name="cell1" Text="x" Weight="1" /></Cells>' +
        '</Item1></Rows></Item1>'
      )
    );
    expect(checkRepx(xml).warnings).toEqual([]);
  });

  it('caps the list instead of printing one line per control', () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `<Item${i} ControlType="XRLabel" Name="l${i}" LocationFloat="900,${i * 10}" SizeF="100,20" />`
    ).join('');
    const result = checkRepx(page(detail(many)));
    expect(result.warnings).toHaveLength(6);
    expect(result.warnings[5]).toMatch(/and 7 more/);
  });

  it('says nothing when the page declares no size', () => {
    // Nothing to measure against is not the same as everything being wrong.
    const xml = '<XtraReportsLayoutSerializer Name="R"><Bands>' +
      '<Item1 ControlType="DetailBand" HeightF="100"><Controls>' +
      '<Item1 ControlType="XRLabel" Name="l" LocationFloat="9000,0" SizeF="100,20" />' +
      '</Controls></Item1></Bands></XtraReportsLayoutSerializer>';
    expect(checkRepx(xml).warnings).toEqual([]);
  });

  it('reports margins that leave nothing printable', () => {
    const xml = page(detail(''), 'PageWidth="850" PageHeight="1100" Margins="500, 500, 100, 100"');
    expect(checkRepx(xml).warnings[0]).toMatch(/leave no printable area/);
  });

  it('tolerates half a unit of rounding', () => {
    const xml = page(detail('<Item1 ControlType="XRLabel" Name="edge" LocationFloat="0,0" SizeF="850.4,20" />'));
    expect(checkRepx(xml).warnings).toEqual([]);
  });
});

describe('formatXml', () => {
  it('puts each element on its own line', () => {
    const out = formatXml('<a><b/><c/></a>');
    expect(out.split('\n').map((l) => l.trim())).toEqual(['<a>', '<b/>', '<c/>', '</a>']);
  });

  it('indents children and steps back out on the closing tag', () => {
    const lines = formatXml('<a><b><c/></b></a>').split('\n');
    expect(lines[0]).toBe('<a>');
    expect(lines[1]).toBe('  <b>');
    expect(lines[2]).toBe('    <c/>');
    expect(lines[3]).toBe('  </b>');
    expect(lines[4]).toBe('</a>');
  });

  it('does not indent after a self-closing tag', () => {
    const lines = formatXml('<a><b/><c/></a>').split('\n');
    expect(lines[1]).toBe('  <b/>');
    expect(lines[2]).toBe('  <c/>');
  });

  it('never throws, whatever it is given', () => {
    expect(() => formatXml('')).not.toThrow();
    expect(() => formatXml('not xml at all')).not.toThrow();
    expect(() => formatXml('<<<>>>')).not.toThrow();
  });
});

describe('tokenizeXml', () => {
  /**
   * The tokens are rendered as React text nodes precisely so XML can never be
   * injected as markup. Reassembly is what guarantees nothing is dropped or
   * duplicated on the way through.
   */
  it('reassembles to exactly the input line', () => {
    const lines = [
      '<Item1 Ref="1" ControlType="TopMarginBand" HeightF="100" />',
      '<?xml version="1.0" encoding="utf-8"?>',
      '</XtraReportsLayoutSerializer>',
      '<!-- a comment -->',
      'plain text with no markup',
      '',
    ];
    for (const line of lines) {
      expect(tokenizeXml(line).map((t) => t.text).join('')).toBe(line);
    }
  });

  it('labels tag names, attributes and values distinctly', () => {
    const tokens = tokenizeXml('<Item1 Ref="1" />');
    expect(tokens.find((t) => t.text === 'Item1')?.kind).toBe('tag');
    expect(tokens.find((t) => t.text === 'Ref')?.kind).toBe('attr');
    expect(tokens.find((t) => t.text === '"1"')?.kind).toBe('value');
  });

  it('treats a processing instruction as one meta token', () => {
    const tokens = tokenizeXml('<?xml version="1.0"?>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe('meta');
  });

  it('does not mistake angle brackets inside an attribute value for markup', () => {
    const line = '<Item1 Text="a &lt; b" />';
    expect(tokenizeXml(line).map((t) => t.text).join('')).toBe(line);
  });
});
