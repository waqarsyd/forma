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
