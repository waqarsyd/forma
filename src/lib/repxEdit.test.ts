/**
 * Editing a control without disturbing the rest of the file.
 *
 * The assertions that matter here are the negative ones. Anyone can check that
 * a drag writes a new LocationFloat; the failure that costs a user their report
 * is the edit that also drops an attribute nobody modelled, turns a
 * self-closing tag into a container that swallows its siblings, or writes a
 * raw `&` into an attribute and makes the file refuse to open. So most of what
 * follows measures what did NOT change.
 */
import { describe, it, expect } from 'vitest';
import { parseReportStructure } from './reportPreview';
import {
  moveControl,
  resizeControl,
  setControlText,
  overflowsBand,
  escapeXmlAttribute,
  deleteControl,
  addLabel,
  setCellText,
  duplicateControl,
} from './repxEdit';

const report = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ReportUnit="HundredthsOfAnInch" Margins="0, 0, 0, 0" PageWidth="850" PageHeight="1100" Version="23.2">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="2" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="200">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="title" Text="INVOICE" LocationFloat="20,20" SizeF="400,40" Font="Arial, 14pt" Padding="2,2,0,0,100" StylePriority="UseFont" />
        <Item2 Ref="4" ControlType="XRLabel" Name="subtitle" Text="Draft" LocationFloat="20,70" SizeF="300,20" Multiline="true"></Item2>
      </Controls>
    </Item2>
    <Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="40">
      <Controls>
        <Item1 Ref="6" ControlType="XRLabel" Name="line" Text="Widget" LocationFloat="0,0" SizeF="600,25" />
      </Controls>
    </Item3>
    <Item4 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

/** ReportHeader is band 1 in print order; TopMargin is 0. */
const TITLE = { band: 1, control: 0 };
const SUBTITLE = { band: 1, control: 1 };
const LINE = { band: 2, control: 0 };

const controlAt = (xml: string, ref: { band: number; control: number }) =>
  parseReportStructure(xml).bands[ref.band].controls[ref.control];

describe('moving a control', () => {
  it('writes the new position and reports what it moved', () => {
    const result = moveControl(report, TITLE, 120, 55);
    expect(result.applied).toBe(true);
    expect(result.reason).toBe('moved XRLabel "title"');
    expect(controlAt(result.xml, TITLE)).toMatchObject({ x: 120, y: 55 });
  });

  it('round-trips a control the parse scaled for its Dpi: an edit writes the file\'s numbers back', () => {
    // A millimetre report with no Dpi: DevExpress reads the title at 100, so it
    // is parsed at 2.54 times its numbers (parity row 35), and dpiScale undoes it.
    const mm = report.replace('ReportUnit="HundredthsOfAnInch"', 'ReportUnit="TenthsOfAMillimeter"');
    const title = controlAt(mm, TITLE);
    expect(title).toMatchObject({ x: 50.8, y: 50.8, width: 1016, dpiScale: 2.54 });
    const s = title.dpiScale ?? 1;
    const { xml } = moveControl(mm, TITLE, title.x / s + 1, title.y / s);
    expect(xml).toContain('LocationFloat="21,20"');
    expect(controlAt(xml, TITLE).x).toBeCloseTo(53.34, 6);
  });

  it('rounds to a whole unit, because sub-unit precision lives in the file forever', () => {
    const { xml } = moveControl(report, TITLE, 120.4, 55.6);
    expect(xml).toContain('LocationFloat="120,56"');
  });

  it('clamps at the band origin rather than putting a control where nothing draws', () => {
    const { xml } = moveControl(report, TITLE, -40, -10);
    expect(xml).toContain('LocationFloat="0,0"');
  });

  it('changes nothing else about the control', () => {
    const { xml } = moveControl(report, TITLE, 120, 55);
    const tag = /<Item1 Ref="3"[^>]*>/.exec(xml)![0];
    // Every attribute this module knows nothing about has to survive.
    expect(tag).toContain('Padding="2,2,0,0,100"');
    expect(tag).toContain('StylePriority="UseFont"');
    expect(tag).toContain('Font="Arial, 14pt"');
    expect(tag).toContain('Text="INVOICE"');
    expect(tag).toContain('SizeF="400,40"');
  });

  it('changes nothing else about the document', () => {
    const { xml } = moveControl(report, TITLE, 120, 55);
    const before = report.replace('LocationFloat="20,20"', 'LocationFloat="120,55"');
    expect(xml).toBe(before);
  });

  it('leaves the other controls alone', () => {
    const { xml } = moveControl(report, TITLE, 999, 999);
    expect(controlAt(xml, SUBTITLE)).toMatchObject({ x: 20, y: 70 });
    expect(controlAt(xml, LINE)).toMatchObject({ x: 0, y: 0 });
  });

  it('edits a control in a different band by the same reference scheme', () => {
    const { xml, reason } = moveControl(report, LINE, 15, 5);
    expect(reason).toBe('moved XRLabel "line"');
    expect(controlAt(xml, LINE)).toMatchObject({ x: 15, y: 5 });
    expect(controlAt(xml, TITLE)).toMatchObject({ x: 20, y: 20 });
  });
});

describe('preserving the tag shape', () => {
  it('keeps a self-closing control self-closing', () => {
    // The failure this prevents: `<Item1 … />` becoming `<Item1 …>` makes every
    // following sibling a child of it, and the loader then finds one control.
    const { xml } = moveControl(report, LINE, 10, 10);
    expect(xml).toMatch(/<Item1 Ref="6"[^>]*\/>/);
    expect(parseReportStructure(xml).bands[2].controls).toHaveLength(1);
  });

  it('keeps a container control a container', () => {
    const { xml } = moveControl(report, SUBTITLE, 30, 80);
    expect(xml).toMatch(/<Item2 Ref="4"[^>]*[^/]>/);
    expect(xml).toContain('</Item2>');
    expect(parseReportStructure(xml).bands[1].controls).toHaveLength(2);
  });

  it('does not leave a double space where the attribute was appended', () => {
    const { xml } = setControlText(report, LINE, 'Bolt');
    expect(xml).not.toMatch(/<Item1 Ref="6"[^>]*  /);
  });
});

describe('resizing a control', () => {
  it('writes the new size', () => {
    const { xml, reason } = resizeControl(report, TITLE, 500, 60);
    expect(reason).toBe('resized XRLabel "title"');
    expect(controlAt(xml, TITLE)).toMatchObject({ width: 500, height: 60 });
  });

  it('will not shrink a control to nothing', () => {
    // A control sized 0 cannot be seen or selected, so a careless drag would
    // lose it entirely.
    const { xml } = resizeControl(report, TITLE, 0, -5);
    expect(xml).toContain('SizeF="1,1"');
  });

  it('leaves the position alone', () => {
    const { xml } = resizeControl(report, TITLE, 500, 60);
    expect(controlAt(xml, TITLE)).toMatchObject({ x: 20, y: 20 });
  });
});

describe('retyping a control', () => {
  it('replaces the text', () => {
    const { xml, reason } = setControlText(report, TITLE, 'CREDIT NOTE');
    expect(reason).toBe('retyped XRLabel "title"');
    expect(controlAt(xml, TITLE).text).toBe('CREDIT NOTE');
  });

  it('escapes what would end the attribute or the element early', () => {
    const { xml } = setControlText(report, TITLE, 'Bolt & Nut <"best">');
    expect(xml).toContain('Text="Bolt &amp; Nut &lt;&quot;best&quot;&gt;"');
    // And it round-trips: the parser decodes back to exactly what was typed.
    expect(controlAt(xml, TITLE).text).toBe('Bolt & Nut <"best">');
  });

  it('adds a Text attribute to a control that had none', () => {
    const noText = report.replace(' Text="Widget"', '');
    const { xml, applied } = setControlText(noText, LINE, 'Bolt');
    expect(applied).toBe(true);
    expect(controlAt(xml, LINE).text).toBe('Bolt');
  });

  it('accepts an empty string, which is how a label is cleared', () => {
    const { xml } = setControlText(report, TITLE, '');
    expect(controlAt(xml, TITLE).text).toBe('');
  });
});

describe('escapeXmlAttribute', () => {
  it('escapes ampersand first, so nothing is double-escaped', () => {
    expect(escapeXmlAttribute('&lt;')).toBe('&amp;lt;');
  });

  it('covers all five', () => {
    expect(escapeXmlAttribute(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('declining rather than corrupting', () => {
  it('reports an out-of-range reference and returns the document unchanged', () => {
    for (const ref of [{ band: 99, control: 0 }, { band: 1, control: 42 }]) {
      const result = moveControl(report, ref, 10, 10);
      expect(result.applied).toBe(false);
      expect(result.xml).toBe(report);
      expect(result.reason).toMatch(/no control at band/);
    }
  });

  it('declines on a document with no bands at all', () => {
    const result = moveControl('<XtraReportsLayoutSerializer />', { band: 0, control: 0 }, 1, 1);
    expect(result.applied).toBe(false);
  });
});

describe('overflowsBand', () => {
  const control = (y: number, height: number) =>
    ({ y, height }) as Parameters<typeof overflowsBand>[0];

  it('is true when the control runs past the band', () => {
    expect(overflowsBand(control(30, 25), 40)).toBe(true);
  });

  it('is false when it exactly fills the band', () => {
    expect(overflowsBand(control(15, 25), 40)).toBe(false);
  });

  it('tolerates the rounding a drag leaves behind', () => {
    expect(overflowsBand(control(15.2, 25), 40)).toBe(false);
  });
});

/* Deleting, adding, and retyping a table cell (2026-11-04). */
describe('deleting a control', () => {
  it('takes the control out and numbers the items after it again', () => {
    const out = deleteControl(report, TITLE);
    expect(out).toMatchObject({ applied: true, reason: 'deleted XRLabel "title"' });
    expect(out.xml).not.toContain('Name="title"');
    // "subtitle" was Item2 with a closing tag; it is Item1 now, both ends.
    expect(out.xml).toContain('<Item1 Ref="4" ControlType="XRLabel" Name="subtitle"');
    expect(out.xml).toContain('Multiline="true"></Item1>');
    expect(parseReportStructure(out.xml).bands[1].controls.map((c) => c.name)).toEqual(['subtitle']);
    // Nothing else moved.
    expect(out.xml.slice(out.xml.indexOf('<Item3'))).toBe(report.slice(report.indexOf('<Item3')));
  });

  it('takes an emptied <Controls> with its last control', () => {
    const out = deleteControl(report, LINE);
    expect(out.applied).toBe(true);
    expect(out.xml).toMatch(/<Item3 Ref="5" ControlType="DetailBand" Name="Detail" HeightF="40">\s*<\/Item3>/);
  });

  it('declines a control another part of the report names by its Ref', () => {
    const named = report.replace('Name="Detail" HeightF="40"', 'Name="Detail" HeightF="40" DrillDownControl="#Ref-3"');
    const out = deleteControl(named, TITLE);
    expect(out.applied).toBe(false);
    expect(out.reason).toContain('#Ref-3');
    expect(out.xml).toBe(named);
  });
});

// Stitch's Duplicate, Ctrl+D (2026-11-05): a copy beside the original, with its own Refs and names.
describe('duplicating a control', () => {
  it('copies it to the end of its band, shifted, with a fresh Ref and a free name, and keeps every attribute', () => {
    const result = duplicateControl(report, TITLE);
    expect(result.applied).toBe(true);
    expect(result.reason).toBe('duplicated XRLabel "title" as "title1"');
    const header = parseReportStructure(result.xml).bands[1].controls;
    expect(header.map((c) => c.name)).toEqual(['title', 'subtitle', 'title1']);
    expect(header[2]).toMatchObject({ x: 28, y: 28, text: 'INVOICE' });
    expect(result.xml).toContain('<Item3 Ref="8" ControlType="XRLabel" Name="title1" Text="INVOICE" LocationFloat="28, 28" SizeF="400,40" Font="Arial, 14pt" Padding="2,2,0,0,100" StylePriority="UseFont" />');
    // The original is untouched.
    expect(result.xml).toContain('<Item1 Ref="3" ControlType="XRLabel" Name="title" Text="INVOICE" LocationFloat="20,20"');
  });

  it('renames every element inside a copied container, closes it under its new item name, and keeps every Ref unique', () => {
    const table = report.replace(
      '<Item1 Ref="6" ControlType="XRLabel" Name="line" Text="Widget" LocationFloat="0,0" SizeF="600,25" />',
      '<Item1 Ref="6" ControlType="XRTable" Name="table1" LocationFloat="0,0" SizeF="600,25"><Rows><Item1 Ref="9" ControlType="XRTableRow" Name="tableRow1" Weight="1"><Cells><Item1 Ref="10" ControlType="XRTableCell" Name="tableCell1" Text="A" Weight="1" /></Cells></Item1></Rows></Item1>',
    );
    const result = duplicateControl(table, LINE);
    expect(result.applied).toBe(true);
    const refs = [...result.xml.matchAll(/\sRef="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(refs).size).toBe(refs.length);
    expect(result.xml).toContain('Name="table2"');
    expect(result.xml).toContain('Name="tableRow2"');
    expect(result.xml).toContain('Name="tableCell2"');
    expect(result.xml).toMatch(/<Item2 Ref="\d+" ControlType="XRTable"[\s\S]*<\/Item2>\s*<\/Controls>/);
    expect(parseReportStructure(result.xml).bands[2].controls.map((c) => c.name)).toEqual(['table1', 'table2']);
  });

  it('declines a control that refers to its own parts by #Ref', () => {
    const chart = report.replace('Name="line" Text="Widget"', 'Name="line" Text="Widget" Series="#Ref-6"');
    const result = duplicateControl(chart, LINE);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(chart);
  });

  // A formatting rule is a link out of the control (2026-11-06, the workspace audit).
  it('copies a control that links to something outside it, such as its formatting rule, and keeps the link', () => {
    const ruled = report.replace('Name="line" Text="Widget"', 'Name="line" Text="Widget" FormattingRules="#Ref-99"');
    const result = duplicateControl(ruled, LINE);
    expect(result.applied).toBe(true);
    expect(result.xml.match(/FormattingRules="#Ref-99"/g)).toHaveLength(2);
  });
});

describe('adding a label', () => {
  it('adds one with a fresh Ref and name, at the place given', () => {
    const out = addLabel(report, LINE.band, 100, 10);
    expect(out).toMatchObject({ applied: true, reason: 'added XRLabel "label1"' });
    const added = parseReportStructure(out.xml).bands[LINE.band].controls[1];
    expect(added).toMatchObject({ name: 'label1', text: 'New label', x: 100, y: 10, width: 100, height: 23 });
    expect(out.xml).toContain('<Item2 Ref="8" ControlType="XRLabel" Name="label1"');
  });

  it('gives a band with no controls its first, self-closing band included', () => {
    const out = addLabel(report, 0, 0, 0);
    expect(out.applied).toBe(true);
    expect(out.xml).toMatch(/<Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="0"><Controls><Item1 Ref="8"[^>]*\/><\/Controls><\/Item1>/);
    expect(parseReportStructure(out.xml).bands[0].controls).toHaveLength(1);
  });

  it("writes it in the band's own Dpi, so it prints where it was put", () => {
    const mm = report.replace('ReportUnit="HundredthsOfAnInch"', 'ReportUnit="TenthsOfAMillimeter" Dpi="254"').replace('Name="Detail" HeightF="40"', 'Name="Detail" HeightF="102" Dpi="254"');
    const out = addLabel(mm, LINE.band, 254, 0);
    expect(out.xml).toContain('LocationFloat="254, 0" SizeF="254, 58" Padding="2,2,0,0,254" Dpi="254"');
  });
});

describe('retyping a table cell', () => {
  const table = report.replace(
    '<Item1 Ref="6" ControlType="XRLabel" Name="line" Text="Widget" LocationFloat="0,0" SizeF="600,25" />',
    '<Item1 Ref="6" ControlType="XRTable" Name="t" LocationFloat="0,0" SizeF="600,25"><Rows>' +
      '<Item1 Ref="10" ControlType="XRTableRow" Name="r1" Weight="1"><Cells>' +
      '<Item1 Ref="11" ControlType="XRTableCell" Name="c1" Text="Item" Weight="1" />' +
      '<Item2 Ref="12" ControlType="XRTableCell" Name="c2" Weight="1"><ExpressionBindings><Item1 Ref="13" EventName="BeforePrint" PropertyName="Text" Expression="[Amount]" /></ExpressionBindings></Item2>' +
      '</Cells></Item1></Rows></Item1>',
  );

  it('sets the text of the cell named by row and place', () => {
    const out = setCellText(table, LINE, 0, 0, 'Product & code');
    expect(out).toMatchObject({ applied: true, reason: 'retyped XRTableCell "c1"' });
    expect(out.xml).toContain('Name="c1" Text="Product &amp; code"');
    expect(parseReportStructure(out.xml).bands[LINE.band].controls[0].rows[0].cells[0].text).toBe('Product & code');
  });

  it('declines a bound cell, a missing one, and a control that is not a table', () => {
    expect(setCellText(table, LINE, 0, 1, 'x')).toMatchObject({ applied: false, reason: 'the cell prints a field, not typed text: bind another in the Data tab' });
    expect(setCellText(table, LINE, 2, 0, 'x').applied).toBe(false);
    expect(setCellText(report, TITLE, 0, 0, 'x').applied).toBe(false);
  });
});
