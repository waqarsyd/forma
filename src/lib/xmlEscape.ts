/**
 * XML escaping for attribute values, in a module of its own (2026-11-07).
 *
 * It lived in `repxEdit.ts`, which imports the Preview engine
 * (`reportPreview.ts` and everything it reads: criteria, text measuring,
 * number formats, report data). `repxBindingPlan.ts` imported it from there
 * for one call, and App.tsx imports `repxBindingPlan` on its first render,
 * so the whole engine, some 120 kB, was in the entry chunk every visitor to
 * the landing page downloads. Measured with a source-mapped build; see the
 * `index-` cap in scripts/check-bundle-size.mjs. `repxEdit` re-exports it.
 */

/**
 * Attribute values go inside double quotes, so those five must not appear
 * raw. Nor may a line break or a tab (2026-11-07, agent audit item 49): an
 * XML reader normalises a raw one inside an attribute to a space, so text
 * written over two lines printed on one. They are written as character
 * references, a line break as `&#xD;&#xA;` as .NET's serializer writes it.
 */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r\n|\r|\n/g, '&#xD;&#xA;')
    .replace(/\t/g, '&#x9;');
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * An attribute value or text read out of XML, its entities decoded: the five
 * named ones and character references, decimal or hexadecimal, since
 * DevExpress's serializer writes a line break as `&#xD;&#xA;` (the Preview
 * showed those characters until parity row 58, s37 and s42). One pass, so
 * what one reference produces is never read again: `&amp;lt;` is the text
 * `&lt;`, not a `<`, and `&#38;amp;` the text `&amp;`, which a chain of
 * replacements, ampersand last, turned into `&`. A reference to no character
 * at all is left as written rather than thrown on.
 *
 * The one decoder (the 2026-11-11 audit, RH-04). It was `decodeXmlText` in
 * `reportPreview.ts`, and fourteen modules kept a copy of their own, ten of
 * which skipped character references: a translated two-line caption went to
 * the AI as "Total&#xD;&#xA;due" and came back printing those characters.
 * It lives here, not in the Preview engine, for the reason this module does.
 */
export function unescapeXml(text: string): string {
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (raw, name?: string, dec?: string, hex?: string) => {
    if (name) return NAMED[name];
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : raw;
  });
}

/**
 * Text with the characters XML 1.0 cannot hold taken out: the C0 controls
 * other than tab, line feed and carriage return, U+FFFE and U+FFFF, and a
 * surrogate without its pair. No escaping makes them legal, and one of them
 * in a cell of data (SQL Server text often carries CHAR(11), CHAR(0) or
 * CHAR(1)) made Word refuse the whole document and Excel offer to repair the
 * workbook (the 2026-11-11 audit, PX-12). The Word, Excel and HTML exports
 * pass every text through this before escaping it.
 */
export function xmlSafeText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
