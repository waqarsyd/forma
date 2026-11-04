/**
 * A report made right to left (2026-11-04), for the Settings checkbox.
 *
 * Until this the setting reached only the generation prompt, which asks the
 * model for `RightToLeft="Yes"` and `RightToLeftLayout="Yes"` on the report.
 * Forma also makes reports with no model at all (OCR, the box reader, its own
 * model, the vision model, its stand-in draft), and the checkbox has to mean
 * the same thing for those. So this pass writes both attributes on the
 * report's root element, where DevExpress reads them and where the Preview's
 * parser reads them too (`applyRightToLeft` in reportPreview.ts, measured in
 * parity cases s63a to s63d): every alignment flips, text runs right to left,
 * and with the layout attribute every control mirrors across the page.
 *
 * Both are needed. `RightToLeftLayout` alone printed exactly as neither, and
 * `RightToLeft` alone flips the text but leaves every control where it was,
 * which for a report designed left to right puts the captions on the wrong
 * side of their values.
 *
 * Idempotent, and a document with no root element comes back unchanged.
 */
const ROOT = /<XtraReportsLayoutSerializer\b([^>]*?)(\/?)>/;

/** `xml` with the report set right to left; unchanged when it is already, or has no report root. */
export function makeRightToLeft(xml: string): string {
  const root = ROOT.exec(xml);
  if (!root) return xml;
  let attrs = root[1];
  for (const name of ['RightToLeft', 'RightToLeftLayout']) {
    const own = new RegExp(`\\s${name}="[^"]*"`);
    attrs = own.test(attrs) ? attrs.replace(own, ` ${name}="Yes"`) : `${attrs} ${name}="Yes"`;
  }
  return xml.slice(0, root.index) + `<XtraReportsLayoutSerializer${attrs}${root[2]}>` + xml.slice(root.index + root[0].length);
}
