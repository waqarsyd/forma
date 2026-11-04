import { describe, it, expect } from 'vitest';
import { groupHeaderFields, setGroupField } from './repxGroupField';
import { paginate, parseReportStructure } from './reportPreview';

const report = (groupFields: string) => `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="R" PageWidth="850" PageHeight="1100">
  <Bands>
    <Item1 Ref="2" ControlType="GroupHeaderBand" Name="GroupHeader1" HeightF="25">
      ${groupFields}
      <Controls>
        <Item1 Ref="4" ControlType="XRLabel" Name="groupValue" TextAlignment="TopLeft" LocationFloat="0, 0" SizeF="200, 20" Padding="2,2,0,0,100">
          <ExpressionBindings>
            <Item1 Ref="5" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" />
          </ExpressionBindings>
        </Item1>
      </Controls>
    </Item1>
    <Item2 Ref="6" ControlType="DetailBand" Name="Detail" HeightF="20">
      <Controls>
        <Item1 Ref="7" ControlType="XRLabel" Name="region" LocationFloat="0, 0" SizeF="100, 20">
          <ExpressionBindings>
            <Item1 Ref="8" EventName="BeforePrint" PropertyName="Text" Expression="[Region]" />
          </ExpressionBindings>
        </Item1>
        <Item2 Ref="9" ControlType="XRLabel" Name="country" LocationFloat="100, 0" SizeF="100, 20">
          <ExpressionBindings>
            <Item1 Ref="10" EventName="BeforePrint" PropertyName="Text" Expression="[Country]" />
          </ExpressionBindings>
        </Item2>
      </Controls>
    </Item2>
  </Bands>
</XtraReportsLayoutSerializer>`;

const byRegion = report('<GroupFields>\n        <Item1 Ref="3" FieldName="Region" />\n      </GroupFields>');

describe('groupHeaderFields', () => {
  it('lists each group header with the field it breaks on', () => {
    expect(groupHeaderFields(byRegion)).toEqual([{ band: 'GroupHeader1', field: 'Region' }]);
  });

  it('says a header that groups by nothing does, and an empty document has none', () => {
    expect(groupHeaderFields(report(''))).toEqual([{ band: 'GroupHeader1', field: null }]);
    expect(groupHeaderFields('')).toEqual([]);
  });
});

describe('setGroupField', () => {
  it('rewrites the field the group breaks on, and the heading that prints it', () => {
    const out = setGroupField(byRegion, 'GroupHeader1', 'Country');
    expect(out.applied).toBe(true);
    expect(out.reason).toBe('grouped GroupHeader1 by Country instead of Region');
    const s = parseReportStructure(out.xml);
    const header = s.bands.find((b) => b.kind === 'GroupHeader')!;
    expect(header.fields).toEqual([{ field: 'Country', order: 'Ascending' }]);
    expect(header.controls[0].field).toBe('Country');
  });

  it('changes nothing outside the group header: the records still print their region', () => {
    const out = setGroupField(byRegion, 'GroupHeader1', 'Country');
    const detail = (xml: string) => xml.slice(xml.indexOf('Name="Detail"'));
    expect(detail(out.xml)).toBe(detail(byRegion));
    expect(out.xml.slice(0, out.xml.indexOf('<Bands>'))).toBe(byRegion.slice(0, byRegion.indexOf('<Bands>')));
    // The attribute nothing models survives the splice.
    expect(out.xml).toContain('Padding="2,2,0,0,100"');
  });

  it('gives a header that groups by nothing a field list with a Ref no other element holds', () => {
    for (const fields of ['', '<GroupFields />', '<GroupFields></GroupFields>']) {
      const out = setGroupField(report(fields), 'GroupHeader1', 'Country');
      expect(out.applied).toBe(true);
      expect(groupHeaderFields(out.xml)).toEqual([{ band: 'GroupHeader1', field: 'Country' }]);
      expect(out.xml.match(/<GroupFields/g)).toHaveLength(1);
      const refs = [...out.xml.matchAll(/\sRef="(\d+)"/g)].map((m) => m[1]);
      expect(new Set(refs).size).toBe(refs.length);
    }
  });

  it('declines what it cannot do, and says why', () => {
    expect(setGroupField(byRegion, 'GroupHeader9', 'Country')).toMatchObject({ applied: false, reason: 'no group header named "GroupHeader9"' });
    expect(setGroupField(byRegion, 'GroupHeader1', 'Region').applied).toBe(false);
    expect(setGroupField(byRegion, 'GroupHeader1', '  ').applied).toBe(false);
    expect(setGroupField(byRegion, 'GroupHeader1', 'a]b').applied).toBe(false);
  });

  it('previews as many groups as the new field has values', () => {
    const rows = [
      { Region: 'North', Country: 'India' },
      { Region: 'North', Country: 'Oman' },
      { Region: 'South', Country: 'India' },
      { Region: 'South', Country: 'Qatar' },
    ];
    const headers = (xml: string) =>
      paginate(parseReportStructure(xml), rows.length, { rows })
        .pages.flatMap((p) => p.bands)
        .filter((b) => b.band.kind === 'GroupHeader').length;
    expect(headers(byRegion)).toBe(2);
    expect(headers(setGroupField(byRegion, 'GroupHeader1', 'Country').xml)).toBe(3);
  });
});
