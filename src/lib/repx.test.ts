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
    expect(checkRepx(VALID)).toEqual({ ok: true, message: 'Valid DevExpress report XML.' });
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
