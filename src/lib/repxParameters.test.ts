/**
 * Parameters, and the lift that makes a typed one work.
 *
 * The shape asserted here was measured with `tools/RepxProbe` on 2026-09-05
 * against the installed DevExpress 20.1, including the negative result that
 * gives this module its reason to exist: a file declaring
 * `Type="System.DateTime"` inline loads a parameter of type `System.String`
 * holding the date as text, with no error. Every expectation below about
 * `#Ref-N` and `<ObjectStorage>` comes from that session, not from the docs.
 */
import { describe, it, expect } from 'vitest';
import { parseParameters, parameterReferences, liftParameterTypes } from './repxParameters';

const report = (params: string, extra = '') => `<?xml version="1.0"?>
<XtraReportsLayoutSerializer Ref="0" Name="Report1" PageWidth="850" PageHeight="1100" Version="20.1"${extra}>
  <Parameters>
${params}
  </Parameters>
  <Bands>
    <Item1 Ref="5" ControlType="TopMarginBand" Name="TopMargin" HeightF="0" />
    <Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="20" />
    <Item3 Ref="7" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="0" />
  </Bands>
</XtraReportsLayoutSerializer>`;

const dateAndRegion = report(
  '    <Item1 Ref="1" Name="DateFrom" Description="From date" Type="System.DateTime" ValueInfo="2026-01-01" />\n' +
  '    <Item2 Ref="2" Name="Region" Description="Region" ValueInfo="North" />',
);

describe('reading the parameters', () => {
  it('reads name, description, type and default value', () => {
    expect(parseParameters(dateAndRegion)).toEqual([
      { name: 'DateFrom', type: 'System.DateTime', description: 'From date', multiValue: false, visible: true, value: '2026-01-01', lifted: false },
      { name: 'Region', type: 'System.String', description: 'Region', multiValue: false, visible: true, value: 'North', lifted: false },
    ]);
  });

  it('treats an absent Type as System.String, which is what the serializer means by it', () => {
    expect(parseParameters(dateAndRegion)[1].type).toBe('System.String');
  });

  it('reads MultiValue and Visible', () => {
    const xml = report(
      '    <Item1 Ref="1" Name="Cats" MultiValue="true" />\n' +
      '    <Item2 Ref="2" Name="RunBy" Visible="false" />',
    );
    expect(parseParameters(xml).map((p) => [p.multiValue, p.visible])).toEqual([[true, true], [false, false]]);
  });

  it('knows a type that has already been lifted', () => {
    const xml = report('    <Item1 Ref="1" Name="D" Type="#Ref-9" />');
    expect(parseParameters(xml)[0]).toMatchObject({ type: '#Ref-9', lifted: true });
  });

  it('returns nothing for a report with no parameters', () => {
    expect(parseParameters('<XtraReportsLayoutSerializer />')).toEqual([]);
    expect(parseParameters('')).toEqual([]);
    expect(parseParameters(null)).toEqual([]);
  });
});

describe('finding the references', () => {
  it('finds the filter-string form and the expression form', () => {
    const xml = report(
      '    <Item1 Ref="1" Name="DateFrom" />',
      ' FilterString="[OrderDate] &gt;= ?DateFrom And [Region] = ?Region"',
    ).replace(
      '<Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="20" />',
      '<Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="20">' +
      '<Controls><Item1 Ref="8" ControlType="XRLabel" Name="cap">' +
      '<ExpressionBindings><Item1 EventName="BeforePrint" PropertyName="Text" ' +
      "Expression=\"'Region: ' + [Parameters.Caption]\" /></ExpressionBindings>" +
      '</Item1></Controls></Item2>',
    );
    expect(parameterReferences(xml).sort()).toEqual(['Caption', 'DateFrom', 'Region']);
  });

  it('ignores the XML declaration, which otherwise reads as a parameter', () => {
    // `<?xml version="1.0"?>` matches the ?Name form exactly, so before this
    // every document in existence referenced a parameter called "xml".
    expect(parameterReferences('<?xml version="1.0"?><X />')).toEqual([]);
  });

  it('ignores a comment, so a commented-out filter is not a reference', () => {
    expect(parameterReferences('<!-- FilterString="?Region" --><X />')).toEqual([]);
  });

  it('can still be fooled by prose, which is why the audit only warns', () => {
    // A question mark immediately followed by a word is indistinguishable from
    // a filter reference in a text scan. The honest limit of the method.
    expect(parameterReferences('<X Text="Ready?Now" />')).toEqual(['Now']);
  });

  it('de-duplicates a name used in both forms', () => {
    const xml = '<X FilterString="?Region" /><Y Expression="[Parameters.Region]" />';
    expect(parameterReferences(xml)).toEqual(['Region']);
  });
});

describe('lifting a type into ObjectStorage', () => {
  const lifted = liftParameterTypes(dateAndRegion, '20.1');

  it('replaces the inline type with a Ref pointer', () => {
    expect(lifted.applied).toBe(true);
    expect(lifted.xml).not.toContain('Type="System.DateTime"');
    expect(lifted.xml).toMatch(/Name="DateFrom"[^>]*Type="#Ref-\d+"/);
  });

  it('adds an ObjectStorage entry naming the real type', () => {
    expect(lifted.xml).toContain('<ObjectStorage>');
    expect(lifted.xml).toContain('Content="System.DateTime" Type="System.Type"');
    expect(lifted.xml).toContain('DevExpress.XtraReports.Serialization.ObjectStorageInfo, DevExpress.XtraReports.v20.1');
  });

  it('points the parameter at the entry it added', () => {
    const ref = /Name="DateFrom"[^>]*Type="#Ref-(\d+)"/.exec(lifted.xml)![1];
    expect(lifted.xml).toMatch(new RegExp(`Ref="${ref}" Content="System\\.DateTime"`));
  });

  it('allocates a Ref above every Ref already in the document', () => {
    const ref = Number(/Name="DateFrom"[^>]*Type="#Ref-(\d+)"/.exec(lifted.xml)![1]);
    const existing = [...dateAndRegion.matchAll(/\sRef="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ref).toBeGreaterThan(Math.max(...existing));
  });

  it('puts ObjectStorage inside the root, at the end', () => {
    expect(lifted.xml.indexOf('<ObjectStorage>')).toBeGreaterThan(lifted.xml.indexOf('</Bands>'));
    expect(lifted.xml.indexOf('</ObjectStorage>')).toBeLessThan(lifted.xml.indexOf('</XtraReportsLayoutSerializer>'));
  });

  it('leaves a string parameter with no Type at all, as the serializer does', () => {
    expect(lifted.xml).toMatch(/Name="Region"[^>]*ValueInfo="North"/);
    expect(/Name="Region"[^>]*Type=/.test(lifted.xml)).toBe(false);
  });

  it('strips a redundant System.String even when nothing else needs lifting', () => {
    const xml = report('    <Item1 Ref="1" Name="Region" Type="System.String" ValueInfo="N" />');
    const result = liftParameterTypes(xml);
    expect(result.applied).toBe(true);
    expect(result.xml).not.toContain('Type="System.String"');
    expect(result.xml).not.toContain('<ObjectStorage>');
    expect(result.reason).toMatch(/redundant System.String/);
  });

  it('shares one entry between two parameters of the same type', () => {
    const xml = report(
      '    <Item1 Ref="1" Name="From" Type="System.DateTime" />\n' +
      '    <Item2 Ref="2" Name="To" Type="System.DateTime" />',
    );
    const result = liftParameterTypes(xml);
    expect((result.xml.match(/Content="System\.DateTime"/g) ?? [])).toHaveLength(1);
    const refs = [...result.xml.matchAll(/Type="#Ref-(\d+)"/g)].map((m) => m[1]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toBe(refs[1]);
  });

  it('uses the assembly suffix for the configured DevExpress version', () => {
    const result = liftParameterTypes(dateAndRegion, '24.1');
    expect(result.xml).toContain('DevExpress.XtraReports.v24.1');
  });

  it('merges into an existing ObjectStorage rather than writing a second one', () => {
    const withStorage = dateAndRegion.replace(
      '</XtraReportsLayoutSerializer>',
      '  <ObjectStorage>\n    <Item1 ObjectType="X" Ref="90" Content="System.Guid" Type="System.Type" />\n  </ObjectStorage>\n</XtraReportsLayoutSerializer>',
    );
    const result = liftParameterTypes(withStorage);
    expect((result.xml.match(/<ObjectStorage>/g) ?? [])).toHaveLength(1);
    expect(result.xml).toContain('Content="System.Guid"');
    expect(result.xml).toContain('Content="System.DateTime"');
  });

  it('declines on a type it does not recognise rather than inventing an entry', () => {
    // A bad ObjectStorage entry can stop the file loading at all, which is
    // worse than a parameter that quietly falls back to string.
    const xml = report('    <Item1 Ref="1" Name="Odd" Type="My.Custom.Type" />');
    const result = liftParameterTypes(xml);
    expect(result.applied).toBe(false);
    expect(result.xml).toBe(xml);
    expect(result.reason).toMatch(/unrecognised parameter type/);
  });

  it('declines, unchanged, when there is nothing to do', () => {
    for (const xml of ['<XtraReportsLayoutSerializer />', report('    <Item1 Ref="1" Name="R" />')]) {
      const result = liftParameterTypes(xml);
      expect(result.applied).toBe(false);
      expect(result.xml).toBe(xml);
    }
  });

  it('is idempotent: a lifted document is left alone', () => {
    const twice = liftParameterTypes(lifted.xml);
    expect(twice.applied).toBe(false);
    expect(twice.xml).toBe(lifted.xml);
  });

  it('changes nothing outside the Parameters block and the new element', () => {
    // The leading two spaces are matched deliberately: `\s*` would also eat the
    // newline that ends </Bands>, and then this would compare a document the
    // lift never produced.
    const withoutStorage = lifted.xml.replace(/ {2}<ObjectStorage>[\s\S]*?<\/ObjectStorage>\n/, '');
    const ref = /Type="#Ref-(\d+)"/.exec(lifted.xml)![1];
    const expected = dateAndRegion.replace(' Type="System.DateTime"', ` Type="#Ref-${ref}"`);
    expect(withoutStorage).toBe(expected);
  });
});
