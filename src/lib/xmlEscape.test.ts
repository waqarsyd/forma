/**
 * The one XML decoder every module reads attributes with (the 2026-11-11
 * audit, RH-04), and the filter that keeps a character XML cannot hold out
 * of the Word, Excel and HTML exports (PX-12).
 */
import { describe, expect, it } from 'vitest';
import { escapeXmlAttribute, unescapeXml, xmlSafeText } from './xmlEscape';

describe('unescapeXml', () => {
  it('decodes the five named entities and character references, decimal and hexadecimal', () => {
    expect(unescapeXml('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')).toBe('a & b < c > d "e" \'f\'');
    expect(unescapeXml('Total&#xD;&#xA;due')).toBe('Total\r\ndue');
    expect(unescapeXml('&#8212; &#x2014; &#X2014;')).toBe('— — —');
    expect(unescapeXml('&#128512;')).toBe('\u{1F600}');
  });

  it('decodes in one pass, so what one reference makes is never read again', () => {
    expect(unescapeXml('&amp;lt;')).toBe('&lt;');
    expect(unescapeXml('&amp;#xD;')).toBe('&#xD;');
    expect(unescapeXml('&#38;amp;')).toBe('&amp;');
  });

  it('leaves what is no reference, or a reference to no character, as written', () => {
    expect(unescapeXml('R&D &nbsp; &#x110000; &#;')).toBe('R&D &nbsp; &#x110000; &#;');
  });

  it('reads back whatever escapeXmlAttribute wrote', () => {
    for (const text of ['Line one\r\nLine two', 'Tab\there', 'Bolt & "nut" <M8>', "Don't", 'Preis ($\'000) $&']) {
      expect(unescapeXml(escapeXmlAttribute(text))).toBe(text.replace(/\r\n|\r|\n/g, '\r\n'));
    }
  });
});

describe('xmlSafeText', () => {
  it('drops the characters XML 1.0 cannot hold and keeps tab, line feed, carriage return and the rest', () => {
    expect(xmlSafeText('Café A\u000BB\u0000\u0001\u001F\uFFFE\uFFFF')).toBe('Café AB');
    expect(xmlSafeText('a\tb\nc\rd')).toBe('a\tb\nc\rd');
    expect(xmlSafeText('\u{1F600} ok')).toBe('\u{1F600} ok');
  });

  it('drops a surrogate without its pair', () => {
    expect(xmlSafeText('x\uD83Dy\uDE00z')).toBe('xyz');
  });
});
