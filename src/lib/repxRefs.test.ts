/**
 * The collision that matters is the one measured on 2026-09-04: two tables
 * reusing the same Ref values, which made DevExpress alias the detail row onto
 * the header row and drop three cells and three bindings without an error.
 * The fixtures below are that document's shape.
 *
 * As elsewhere in this suite the loops sit inside a single case, so the grep
 * and the run agree.
 */
import { describe, it, expect } from 'vitest';
import { auditRefs, ensureUniqueRefs } from './repxRefs';
import { checkRepxComplete } from './repxTruncation';

const cell = (item: number, ref: number, text: string) =>
  `<Item${item} Ref="${ref}" ControlType="XRTableCell" Name="cell${item}" Text="${text}" Weight="1" />`;

const table = (ref: number, rowRef: number, name: string, cells: string) =>
  `<Item1 Ref="${ref}" ControlType="XRTable" Name="${name}" LocationFloat="0,0" SizeF="750,20">` +
  `<Rows><Item1 Ref="${rowRef}" ControlType="XRTableRow" Name="${name}Row" Weight="1">` +
  `<Cells>${cells}</Cells></Item1></Rows></Item1>`;

const report = (bands: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="0" ' +
  'ControlType="DevExpress.XtraReports.UI.XtraReport" Name="Report1" ' +
  'ReportUnit="HundredthsOfAnInch" PageWidth="850" PageHeight="1100" Version="20.1">' +
  `<Bands>${bands}</Bands></XtraReportsLayoutSerializer>`;

/** Two bands whose tables reuse Refs -- the measured failure. */
const colliding = report(
  `<Item1 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="20"><Controls>` +
    table(5, 6, 'tableHeader', cell(1, 21, 'Description') + cell(2, 22, 'Amount')) +
    `</Controls></Item1>` +
    `<Item2 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>` +
    table(5, 6, 'tableDetail', cell(1, 21, 'Widget') + cell(2, 22, '1240.00')) +
    `</Controls></Item2>`
);

const unique = report(
  `<Item1 Ref="2" ControlType="PageHeaderBand" Name="PageHeader" HeightF="20"><Controls>` +
    table(5, 6, 'tableHeader', cell(1, 21, 'Description') + cell(2, 22, 'Amount')) +
    `</Controls></Item1>` +
    `<Item2 Ref="7" ControlType="DetailBand" Name="Detail" HeightF="20"><Controls>` +
    table(8, 9, 'tableDetail', cell(1, 23, 'Widget') + cell(2, 24, '1240.00')) +
    `</Controls></Item2>`
);

describe('auditRefs', () => {
  it('finds every Ref in the document', () => {
    expect(auditRefs(unique).occurrences).toHaveLength(11);
  });

  it('reports nothing for a document that is already unique', () => {
    expect(auditRefs(unique).duplicates).toEqual([]);
  });

  it('reports each colliding value with its count', () => {
    const { duplicates } = auditRefs(colliding);
    expect(duplicates).toEqual([
      { ref: '5', count: 2 },
      { ref: '6', count: 2 },
      { ref: '21', count: 2 },
      { ref: '22', count: 2 },
    ]);
  });

  it('reports the largest Ref, so a repair knows where to start', () => {
    expect(auditRefs(unique).max).toBe(24);
    expect(auditRefs(colliding).max).toBe(22);
  });

  it('marks elements with a ControlType as definitions', () => {
    expect(auditRefs(unique).occurrences.every((o) => o.defines)).toBe(true);
  });

  it('does not mark a bare back-reference as a definition', () => {
    const withRef = report('<Item1 Ref="2" ControlType="DetailBand" Name="Detail" /><Item2 Ref="2" />');
    const bare = auditRefs(withRef).occurrences.filter((o) => !o.defines);
    expect(bare).toHaveLength(1);
    expect(bare[0].ref).toBe('2');
  });

  it('is not confused by a Ref inside a comment', () => {
    const withComment = unique.replace('<Bands>', '<!-- Ref="5" ControlType="X" --><Bands>');
    expect(auditRefs(withComment).occurrences).toHaveLength(11);
  });

  it('handles an empty document', () => {
    for (const input of ['', null, undefined]) {
      const audit = auditRefs(input);
      expect(audit.occurrences).toEqual([]);
      expect(audit.max).toBe(-1);
    }
  });
});

describe('ensureUniqueRefs', () => {
  it('leaves an already-unique document byte-identical', () => {
    const result = ensureUniqueRefs(unique);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(unique);
    expect(result.renumbered).toBe(0);
    expect(result.reason).toBe('all 11 Ref values are already unique');
  });

  it('makes every Ref unique when they collide', () => {
    const { xml, applied, renumbered } = ensureUniqueRefs(colliding);
    expect(applied).toBe(true);
    expect(renumbered).toBe(4);
    expect(auditRefs(xml).duplicates).toEqual([]);
  });

  it('keeps the first occurrence and renumbers the later one', () => {
    const { xml } = ensureUniqueRefs(colliding);
    // The header table keeps Ref="5"; the detail table gets a fresh number.
    expect(xml).toContain('Ref="5" ControlType="XRTable" Name="tableHeader"');
    expect(xml).not.toContain('Ref="5" ControlType="XRTable" Name="tableDetail"');
  });

  it('allocates new numbers above the document maximum', () => {
    const { xml } = ensureUniqueRefs(colliding);
    // max was 22, so the four repeats become 23..26.
    expect(xml).toContain('Ref="23" ControlType="XRTable" Name="tableDetail"');
    expect(auditRefs(xml).max).toBe(26);
  });

  it('changes nothing but the Ref attributes it had to change', () => {
    const { xml } = ensureUniqueRefs(colliding);
    const normalise = (s: string) => s.replace(/ Ref="\d+"/g, ' Ref=""');
    expect(normalise(xml)).toBe(normalise(colliding));
  });

  it('leaves a bare back-reference alone rather than splitting the object', () => {
    const withRef = report('<Item1 Ref="2" ControlType="DetailBand" Name="Detail" /><Item2 Ref="2" />');
    const result = ensureUniqueRefs(withRef);
    expect(result.applied).toBe(false);
    expect(result.renumbered).toBe(0);
    expect(result.xml).toBe(withRef);
    expect(result.reason).toContain('look like back-references');
  });

  it('names the collisions it found in the reason', () => {
    expect(ensureUniqueRefs(colliding).reason).toBe(
      'renumbered 4 element(s) that reused a Ref (5x2, 6x2, 21x2, 22x2)'
    );
  });

  it('leaves the document parseable and complete', () => {
    const { xml } = ensureUniqueRefs(colliding);
    expect(checkRepxComplete(xml).complete).toBe(true);
  });

  it('is idempotent', () => {
    const once = ensureUniqueRefs(colliding);
    const twice = ensureUniqueRefs(once.xml);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });

  it('declines an empty document rather than throwing', () => {
    for (const input of ['', '  ', null, undefined]) {
      const result = ensureUniqueRefs(input);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('there is no REPX to check');
    }
  });
});

/**
 * `#Ref-N` pointers, and why the repair leaves them alone.
 *
 * Two attributes in this format point at a Ref rather than defining one: a
 * parameter's `Type`, pointing into `<ObjectStorage>`, and a cross-band
 * control's `StartBand`/`EndBand`, pointing at bands. Both were measured with
 * `RepxProbe`, and neither existed when this module was written.
 *
 * The renumbering takes new values from `max + 1`, and the FIRST occurrence of
 * a duplicated Ref keeps its number — so in the ordinary case a pointer still
 * resolves to exactly the element it resolved to before. Rewriting pointers to
 * follow the renumbered copy would break that case, which is why the repair
 * does not do it.
 */
describe('ensureUniqueRefs and #Ref- pointers', () => {
  const withPointer = (body: string) => report(body);

  it('leaves a pointer alone when its target kept its number', () => {
    const xml = withPointer(
      '<Item1 Ref="2" ControlType="DetailBand" Name="Detail" />' +
      '<Item2 Ref="3" ControlType="PageHeaderBand" Name="PageHeader" />' +
      '<Item3 Ref="3" ControlType="ReportFooterBand" Name="ReportFooter" />' +
      '<Item4 ControlType="XRCrossBandLine" Name="rule" StartBand="#Ref-2" EndBand="#Ref-3" />'
    );
    const { xml: out, applied } = ensureUniqueRefs(xml);
    expect(applied).toBe(true);
    // Ref 2 was never duplicated, so this pointer is untouched and still right.
    expect(out).toContain('StartBand="#Ref-2"');
  });

  it('does not rewrite a pointer to follow the renumbered copy', () => {
    // The regression guarded here: "fixing" the pointer to chase the element
    // that moved would aim it at the LAST duplicate, when the pointer resolved
    // to the first one both before and after the repair.
    const xml = withPointer(
      '<Item1 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" />' +
      '<Item2 Ref="4" ControlType="DetailBand" Name="Detail" />' +
      '<Item3 ControlType="XRCrossBandLine" Name="rule" StartBand="#Ref-4" />'
    );
    const { xml: out } = ensureUniqueRefs(xml);
    expect(out).toContain('StartBand="#Ref-4"');
    expect(out).not.toMatch(/StartBand="#Ref-(?!4")/);
  });

  it('warns when a renumbered Ref had a pointer to it, because that is ambiguous', () => {
    const xml = withPointer(
      '<Item1 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" />' +
      '<Item2 Ref="4" ControlType="DetailBand" Name="Detail" />' +
      '<Item3 ControlType="XRCrossBandLine" Name="rule" StartBand="#Ref-4" />'
    );
    const { reason } = ensureUniqueRefs(xml);
    expect(reason).toContain('WARNING');
    expect(reason).toContain('#Ref- pointer');
  });

  it('stays quiet when no pointer names anything that moved', () => {
    const xml = withPointer(
      '<Item1 Ref="5" ControlType="XRTable" Name="a" />' +
      '<Item2 Ref="5" ControlType="XRTable" Name="b" />' +
      '<Item3 Ref="9" ControlType="DetailBand" Name="Detail" />' +
      '<Item4 ControlType="XRCrossBandLine" Name="rule" StartBand="#Ref-9" />'
    );
    expect(ensureUniqueRefs(xml).reason).not.toContain('WARNING');
  });

  it('does not mistake a pointer for a definition', () => {
    // `StartBand="#Ref-2"` must not be counted as an element carrying Ref="2",
    // or the audit would report a collision that is not one.
    const xml = withPointer(
      '<Item1 Ref="2" ControlType="DetailBand" Name="Detail" />' +
      '<Item2 ControlType="XRCrossBandLine" Name="rule" StartBand="#Ref-2" />'
    );
    expect(auditRefs(xml).duplicates).toEqual([]);
    expect(ensureUniqueRefs(xml).applied).toBe(false);
  });

it('warns that a formatting-rule link may now be wrong', () => {
    // The fourth pointer attribute, and the pattern matched it without being
    // changed because it matches the VALUE rather than the attribute name.
    const xml = report(
      '<Item1 Ref="4" ControlType="PageHeaderBand" Name="PageHeader" />' +
      '<Item2 Ref="4" ControlType="DetailBand" Name="Detail">' +
      '<FormattingRuleLinks><Item1 Ref="9" Value="#Ref-4" /></FormattingRuleLinks>' +
      '</Item2>'
    );
    const { reason, xml: out } = ensureUniqueRefs(xml);
    expect(reason).toContain('WARNING');
    expect(reason).toContain('formatting-rule link');
    expect(out).toContain('Value="#Ref-4"');
  });

  it('leaves a parameter type pointer alone the same way', () => {
    const xml = withPointer(
      '<Item1 Ref="7" ControlType="DetailBand" Name="Detail" />' +
      '<Item2 Ref="7" ControlType="XRLabel" Name="label1" />'
    ).replace('</Bands>', '</Bands><Parameters><Item1 Ref="30" Name="From" Type="#Ref-31" /></Parameters>');
    const { xml: out } = ensureUniqueRefs(xml);
    expect(out).toContain('Type="#Ref-31"');
  });
});
