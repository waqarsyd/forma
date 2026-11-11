/**
 * A report's typed texts collected for translation and put back (2026-11-10,
 * the first gap of docs/proposals/ai-designers.md).
 */
import { describe, expect, it } from 'vitest';
import { applyTranslations, collectTexts, languageAsked, languageName, namesLanguage, translatable } from './repxTranslate';
import { escapeXmlAttribute } from './xmlEscape';

const REPX = `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="20.1.3.0" Ref="1" ControlType="DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1" Name="Invoice" PageWidth="850" PageHeight="1100" Version="20.1" Dpi="100">
  <Bands>
    <Item1 Ref="2" ControlType="TopMarginBand" Name="TopMargin" HeightF="50" Dpi="100" />
    <Item2 Ref="3" ControlType="ReportHeaderBand" Name="ReportHeader" HeightF="60" Dpi="100"><Controls>
      <Item1 Ref="4" ControlType="XRLabel" Name="labelTitle" Text="Invoice" SizeF="200,30" Font="Arial, 16pt, style=Bold" Dpi="100" />
      <Item2 Ref="5" ControlType="XRLabel" Name="labelNote" Text="Terms &amp; conditions: net 30 days" SizeF="300,20" Dpi="100" />
      <Item3 Ref="6" ControlType="XRLabel" Name="labelNumber" Text="12345" SizeF="100,20" Dpi="100" />
      <Item4 Ref="7" ControlType="XRLabel" Name="labelBound" Text="Customer" SizeF="100,20" Dpi="100"><ExpressionBindings><Item1 Ref="8" EventName="BeforePrint" PropertyName="Text" Expression="[CompanyName]" /></ExpressionBindings></Item4>
    </Controls></Item2>
    <Item3 Ref="9" ControlType="PageHeaderBand" Name="PageHeader" HeightF="25" Dpi="100"><Controls>
      <Item1 Ref="10" ControlType="XRTable" Name="tableHeader" SizeF="700,22" Dpi="100"><Rows><Item1 Ref="11" ControlType="XRTableRow" Name="rowHeader" Weight="1" Dpi="100"><Cells>
        <Item1 Ref="12" ControlType="XRTableCell" Name="cellQty" Text="Quantity" Weight="1" Dpi="100" />
        <Item2 Ref="13" ControlType="XRTableCell" Name="cellAmount" Text="Amount" Weight="1" Dpi="100" />
        <Item3 Ref="14" ControlType="XRTableCell" Name="cellDash" Text="-" Weight="1" Dpi="100" />
      </Cells></Item1></Rows></Item1>
    </Controls></Item3>
    <Item4 Ref="15" ControlType="DetailBand" Name="Detail" HeightF="25" Dpi="100"><Controls>
      <Item1 Ref="16" ControlType="XRLabel" Name="labelTitle2" Text="Invoice" SizeF="200,20" Dpi="100" />
    </Controls></Item4>
    <Item5 Ref="17" ControlType="PageFooterBand" Name="PageFooter" HeightF="25" Dpi="100"><Controls>
      <Item1 Ref="18" ControlType="XRPageInfo" Name="pageInfo" TextFormatString="Page {0} of {1}" SizeF="150,16" Dpi="100" />
    </Controls></Item5>
    <Item6 Ref="19" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="50" Dpi="100" />
  </Bands>
</XtraReportsLayoutSerializer>`;

describe('what is translated', () => {
  it('is every typed text with letters, once each, not a number, a dash, a bound label or a page number', () => {
    expect(collectTexts(REPX)).toEqual([
      { text: 'Invoice', count: 2 },
      { text: 'Terms & conditions: net 30 days', count: 1 },
      { text: 'Quantity', count: 1 },
      { text: 'Amount', count: 1 },
    ]);
    expect(translatable('[Customer]')).toBe(false);
    expect(translatable('{0:N2}')).toBe(false);
    expect(translatable('Rs. 1,200')).toBe(true);
  });

  it('puts each translation back, escaped, and leaves the rest as it was', () => {
    const { xml, changed } = applyTranslations(REPX, new Map([['Invoice', 'Rechnung'], ['Quantity', 'Menge'], ['Terms & conditions: net 30 days', 'Bedingungen: "netto" 30 Tage'], ['Amount', 'Amount']]));
    expect(changed).toBe(4);
    expect(xml.match(/Text="Rechnung"/g)).toHaveLength(2);
    expect(xml).toContain('Text="Menge"');
    expect(xml).toContain('Text="Bedingungen: &quot;netto&quot; 30 Tage"');
    // The bound label, the number, the dash, the page number and the layout are untouched.
    expect(xml).toContain('Name="labelBound" Text="Customer"');
    expect(xml).toContain('Text="12345"');
    expect(xml).toContain('TextFormatString="Page {0} of {1}"');
    expect(xml.replace(/Text="[^"]*"/g, '')).toBe(REPX.replace(/Text="[^"]*"/g, ''));
  });

  // The 2026-11-11 audit, RH-04: the caption went to the AI as
  // "Total&#xD;&#xA;due", and its translation printed those characters.
  it('reads a two-line caption as two lines, and writes its translation back as the file writes a line break', () => {
    const two = '<Item1 Ref="4" ControlType="XRLabel" Name="labelTotal" Text="Total&#xD;&#xA;due" SizeF="200,30" Dpi="100" />';
    expect(collectTexts(two)).toEqual([{ text: 'Total\r\ndue', count: 1 }]);
    const { xml, changed } = applyTranslations(two, new Map([['Total\r\ndue', 'Gesamt\r\nfällig']]));
    expect(changed).toBe(1);
    expect(xml).toContain('Text="Gesamt&#xD;&#xA;fällig"');
  });

  it('reads the language a request names', () => {
    expect(languageAsked('Translate this report into German.')).toBe('German');
    expect(languageAsked('translate it to Brazilian Portuguese please')).toBe('Brazilian Portuguese');
    expect(languageAsked('Localise the captions in French')).toBe('French');
    expect(languageAsked('Make the title bold')).toBeNull();
  });

  // The full audit (2026-11-11, CV-01 and TC-02): a language named however a person names it.
  it('reads a language named without the verb, by its own name or its code, as one English name', () => {
    expect(languageAsked('generate the report in German')).toBe('German');
    expect(languageAsked('Put it in French please')).toBe('French');
    expect(languageAsked('I need it in espanol')).toBe('Spanish');
    expect(languageAsked('Make it into Español')).toBe('Spanish');
    expect(languageAsked('the captions in Deutsch')).toBe('German');
    expect(languageAsked('translate it to de')).toBe('German');
    expect(languageAsked('Translate it to polish')).toBe('Polish');
    expect(languageAsked('make it in Polish')).toBe('Polish');
    // The language asked for, not the one the labels are in now.
    expect(languageAsked('Translate the labels in English to German')).toBe('German');
    // Not a language: numerals, a code that is an everyday word, a format.
    expect(languageAsked('show the amounts in Arabic numerals')).toBeNull();
    expect(languageAsked('add a total to it')).toBeNull();
    expect(languageAsked('put the date in ur report')).toBeNull();
    expect(languageAsked('send it to Word')).toBeNull();
    expect(languageAsked('make it landscape')).toBeNull();
    expect(languageAsked('Translate the title and add a total to it')).toBeNull();
  });

  // The review of the full audit (2026-11-11): report talk that a verb-less match read as a language.
  it('reads no language in report talk: a code without a translate verb, the verb polish, a hyphenated word', () => {
    expect(languageAsked('Keep the font sizes in pt')).toBeNull();
    expect(languageAsked('Set the margins in pt please')).toBeNull();
    expect(languageAsked('I would like you to polish the layout')).toBeNull();
    expect(languageAsked('Remember to de-duplicate the rows')).toBeNull();
    expect(languageAsked('Add a total in ar')).toBeNull();
    expect(languageAsked('change it to de')).toBeNull();
    expect(namesLanguage('Keep the font sizes in pt', 'pt')).toBe(false);
    expect(namesLanguage('I would like you to polish the layout', 'pl')).toBe(false);
    expect(namesLanguage('Remember to de-duplicate the rows', 'de')).toBe(false);
  });

  it('writes a language one way however the model wrote it, and finds it in the words', () => {
    expect(languageName('de')).toBe('German');
    expect(languageName('Deutsch')).toBe('German');
    expect(languageName('German (Germany)')).toBe('German');
    expect(languageName('es-MX')).toBe('Spanish');
    expect(languageName('zh-Hans')).toBe('Chinese');
    expect(languageName('zh-Hant')).toBe('Chinese');
    expect(languageName('ar')).toBe('Arabic');
    expect(languageName('hi')).toBe('Hindi');
    expect(languageName('ur')).toBe('Urdu');
    expect(languageName('Swahili')).toBe('Swahili');
    expect(languageName('  ')).toBe('');
    expect(namesLanguage('Hindi in Devanagari script', 'hi')).toBe(true);
    expect(namesLanguage('generate the report in German', 'de')).toBe(true);
    expect(namesLanguage('make the title bold', 'de')).toBe(false);
  });

  // The full audit (2026-11-11, PX-02): a translation holding `$` patterns is written as it is.
  it('writes a translation holding $&, $\', $$ or $1 as written, never as a replacement pattern', () => {
    for (const to of ["Preis ($'000)", 'Menge $&', 'Betrag $$', 'Wert $1']) {
      const { xml, changed } = applyTranslations(REPX, new Map([['Amount', to]]));
      expect(changed, to).toBe(1);
      expect(xml, to).toContain(`Name="cellAmount" Text="${escapeXmlAttribute(to)}"`);
      expect(xml.replace(/Text="[^"]*"/g, ''), to).toBe(REPX.replace(/Text="[^"]*"/g, ''));
    }
  });
});
