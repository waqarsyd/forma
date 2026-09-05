/**
 * The safety property is the whole test suite, and it is one sentence: a control
 * must end up with exactly the appearance it started with.
 *
 * A style supplies defaults and an explicit attribute overrides it, so moving a
 * set of attributes onto a style and deleting that set from the control is a
 * no-op for rendering — but only if the set moved is *exactly* the set deleted,
 * and only if every control in the group had exactly that set. Most of what
 * follows is that claim, approached from different sides.
 */
import { describe, it, expect } from 'vitest';
import { liftStyles, MIN_SHARED } from './repxStyles';

const HEAD = 'Font="Arial, 9pt, style=Bold" ForeColor="#1A2B3C"';

const report = (controls: string) =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="R" PageWidth="850" PageHeight="1100" Version="23.2">\n' +
  '  <Bands>\n' +
  '    <Item1 Ref="1" ControlType="DetailBand" Name="Detail" HeightF="200">\n' +
  '      <Controls>\n' + controls + '\n      </Controls>\n' +
  '    </Item1>\n' +
  '  </Bands>\n' +
  '</XtraReportsLayoutSerializer>';

const label = (n: number, attrs: string) =>
  `        <Item${n} Ref="${n + 10}" ControlType="XRLabel" Name="l${n}" Text="t${n}" SizeF="100,20" LocationFloat="0,${n * 20}" ${attrs} />`;

const threeHeadings = report([label(1, HEAD), label(2, HEAD), label(3, HEAD)].join('\n'));

describe('when there is nothing worth doing', () => {
  it('declines an empty document', () => {
    for (const input of ['', '   ', null, undefined]) {
      expect(liftStyles(input).applied).toBe(false);
    }
  });

  it('declines a document that already has a style sheet', () => {
    // Merging two style systems is a different and much less safe operation.
    const already = threeHeadings.replace('</Bands>', '</Bands>\n  <StyleSheet><Item1 Ref="90" Name="X" /></StyleSheet>');
    const result = liftStyles(already);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('already has a style sheet');
    expect(result.xml).toBe(already);
  });

  it('declines when nothing repeats often enough', () => {
    const two = report([label(1, HEAD), label(2, HEAD)].join('\n'));
    const result = liftStyles(two);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain(`${MIN_SHARED} or more`);
    expect(result.xml).toBe(two);
  });

  it('declines when controls carry no appearance at all', () => {
    const plain = report([1, 2, 3].map((n) => label(n, '')).join('\n'));
    expect(liftStyles(plain).applied).toBe(false);
  });
});

describe('lifting a shared appearance', () => {
  const lifted = liftStyles(threeHeadings);

  it('writes a StyleSheet after </Bands>, where DevExpress puts it', () => {
    expect(lifted.applied).toBe(true);
    const bands = lifted.xml.indexOf('</Bands>');
    const sheet = lifted.xml.indexOf('<StyleSheet>');
    expect(sheet).toBeGreaterThan(bands);
    expect(lifted.xml.indexOf('</StyleSheet>')).toBeLessThan(lifted.xml.indexOf('</XtraReportsLayoutSerializer>'));
  });

  it('names a bold appearance a heading', () => {
    expect(lifted.styles.map((s) => s.name)).toEqual(['HeadingStyle']);
    expect(lifted.styles[0].used).toBe(3);
  });

  it('points every member at it by name, not by a Ref pointer', () => {
    // Measured: StyleName is a plain name. If this ever became "#Ref-N",
    // repxRefs.ts would have to learn about it.
    expect([...lifted.xml.matchAll(/StyleName="HeadingStyle"/g)]).toHaveLength(3);
    expect(lifted.xml).not.toMatch(/StyleName="#Ref/);
  });

  it('removes from the control exactly what it moved to the style', () => {
    // The safety property. Neither attribute may survive on any control.
    const controlsOnly = lifted.xml.slice(0, lifted.xml.indexOf('<StyleSheet>'));
    expect(controlsOnly).not.toContain('Font="Arial, 9pt, style=Bold"');
    expect(controlsOnly).not.toContain('ForeColor="#1A2B3C"');
    expect(lifted.styles[0].attributes).toContain('Font="Arial, 9pt, style=Bold"');
    expect(lifted.styles[0].attributes).toContain('ForeColor="#1A2B3C"');
  });

  it('leaves every other attribute untouched', () => {
    for (const keep of ['Text="t1"', 'SizeF="100,20"', 'LocationFloat="0,20"', 'Name="l2"', 'Ref="12"']) {
      expect(lifted.xml, keep).toContain(keep);
    }
  });

  it('gives the style a Ref above the document maximum', () => {
    // 13 is the largest Ref in the fixture, so the style must not reuse it.
    expect(lifted.xml).toMatch(/<Item1 Ref="14" Name="HeadingStyle"/);
  });

  it('renames Borders to Sides, which is the same thing in a style', () => {
    const bordered = 'Font="Arial, 9pt" Borders="Bottom"';
    const result = liftStyles(report([1, 2, 3].map((n) => label(n, bordered)).join('\n')));
    expect(result.styles[0].attributes).toContain('Sides="Bottom"');
    expect(result.styles[0].attributes).not.toContain('Borders=');
    expect(result.xml.slice(0, result.xml.indexOf('<StyleSheet>'))).not.toContain('Borders="Bottom"');
  });
});

describe('what must NOT be grouped together', () => {
  it('keeps near-matches apart rather than approximating them', () => {
    // Two bold headings and one that also has a background. Grouping all three
    // would silently give the first two a background they never had.
    const controls = [
      label(1, HEAD),
      label(2, HEAD),
      label(3, `${HEAD} BackColor="#EEEEEE"`),
    ].join('\n');
    const result = liftStyles(report(controls));
    expect(result.applied).toBe(false);
  });

  it('does not lift from a band', () => {
    // A band's appearance is not a control's, and hoisting across that boundary
    // would move a property DevExpress resolves differently.
    const banded =
      '<?xml version="1.0" encoding="utf-8"?>\n<XtraReportsLayoutSerializer Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" PageWidth="850" PageHeight="1100">\n  <Bands>\n' +
      [1, 2, 3].map((n) => `    <Item${n} Ref="${n}" ControlType="DetailBand" Name="B${n}" HeightF="20" BackColor="#EEEEEE" />`).join('\n') +
      '\n  </Bands>\n</XtraReportsLayoutSerializer>';
    expect(liftStyles(banded).applied).toBe(false);
  });

  it('does not lift from table cells', () => {
    // Cells inherit from their table, so this is the same boundary problem.
    const cells = [1, 2, 3]
      .map((n) => `<Item${n} Ref="${n + 20}" ControlType="XRTableCell" Name="c${n}" Text="x" Weight="1" Font="Arial, 9pt" />`)
      .join('');
    const withTable = report(
      `        <Item1 Ref="11" ControlType="XRTable" Name="t" SizeF="700,20" LocationFloat="0,0"><Rows><Item1 Ref="12" ControlType="XRTableRow" Name="r" Weight="1"><Cells>${cells}</Cells></Item1></Rows></Item1>`,
    );
    expect(liftStyles(withTable).applied).toBe(false);
  });
});

describe('two distinct appearances', () => {
  const mixed = report(
    [
      label(1, HEAD), label(2, HEAD), label(3, HEAD),
      label(4, 'Font="Arial, 9pt"'), label(5, 'Font="Arial, 9pt"'), label(6, 'Font="Arial, 9pt"'),
    ].join('\n'),
  );

  it('makes one style each, named for what they are', () => {
    const result = liftStyles(mixed);
    expect(result.styles.map((s) => s.name).sort()).toEqual(['BodyStyle', 'HeadingStyle']);
  });

  it('gives each style its own Ref', () => {
    const result = liftStyles(mixed);
    const refs = [...result.xml.matchAll(/<Item\d+ Ref="(\d+)" Name="(?:Heading|Body)Style"/g)].map((m) => m[1]);
    expect(new Set(refs).size).toBe(2);
  });

  it('is idempotent — a second pass finds the sheet and declines', () => {
    const once = liftStyles(mixed);
    const twice = liftStyles(once.xml);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });
});
