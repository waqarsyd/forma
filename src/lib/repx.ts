/**
 * REPX text handling — formatting, tokenizing and validating the DevExpress XML
 * that Forma generates.
 *
 * These live outside `App.tsx` so they can be tested without dragging the whole
 * application (and pdf.js, and Firebase) into a test run. `checkRepx` in
 * particular is the only thing standing between a malformed generation and the
 * user discovering it when DevExpress refuses the file, so it is worth pinning
 * down with tests rather than trusting by inspection.
 */

/**
 * Re-indent REPX for reading. DevExpress reports are attribute-based with no
 * meaningful text nodes, so collapsing whitespace between tags is safe here in
 * a way it would not be for general XML. Do not reuse this for arbitrary XML.
 */
export function formatXml(xml: string): string {
  try {
    const compact = xml.trim().replace(/>\s*</g, '><').replace(/></g, '>\n<');
    let pad = 0;
    return compact
      .split('\n')
      .map((line) => {
        // A closing tag steps back out before it is printed.
        if (/^<\//.test(line)) pad = Math.max(0, pad - 1);
        const out = '  '.repeat(pad) + line;
        // An opening tag that is not self-closing and not immediately closed
        // indents whatever follows it.
        if (/^<[^!?/]/.test(line) && !/\/>$/.test(line) && !/<\/[\w.:-]+>$/.test(line)) pad += 1;
        return out;
      })
      .join('\n');
  } catch {
    return xml; // Never let cosmetics break the view.
  }
}

export type XmlToken = { text: string; kind?: 'tag' | 'attr' | 'value' | 'punct' | 'meta' };

/**
 * Minimal XML tokenizer for colouring. Deliberately returns tokens rather than
 * an HTML string so the XML is rendered as React text nodes and can never be
 * interpreted as markup.
 */
export function tokenizeXml(line: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const re =
    /(<!--[\s\S]*?-->|<\?[\s\S]*?\?>)|(<\/?)([\w.:-]+)|([\w.:-]+)(=)("[^"]*")|(\/?>)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[1]) tokens.push({ text: m[1], kind: 'meta' });
    else if (m[3]) {
      tokens.push({ text: m[2], kind: 'punct' });
      tokens.push({ text: m[3], kind: 'tag' });
    } else if (m[4]) {
      tokens.push({ text: m[4], kind: 'attr' });
      tokens.push({ text: m[5], kind: 'punct' });
      tokens.push({ text: m[6], kind: 'value' });
    } else if (m[7]) tokens.push({ text: m[7], kind: 'punct' });
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  return tokens;
}

export interface RepxCheck {
  /**
   * Structural validity only: will the designer open this file at all.
   *
   * Deliberately **not** affected by `warnings`. `ok: false` blocks Export and
   * Open in designer, and a control fifty units too wide still opens perfectly
   * well — refusing to export it would be a worse failure than the one being
   * reported.
   */
  ok: boolean;
  message: string;
  /**
   * Geometry the designer will accept but that will not look like the design.
   * Advisory, in document order, capped.
   */
  warnings: string[];
}

/** "150.5,20.3" or "150.5, 20.3" -> [150.5, 20.3]. Null if it is not a pair. */
function parsePair(value: string | null): [number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1]];
}

function num(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** How many geometry problems to name before summarising the rest. */
const MAX_WARNINGS = 5;

/**
 * Does the geometry actually fit the page it declares?
 *
 * Added 2026-08-26 after an audit found the generated XML systematically offset
 * by the page margin: `LocationFloat` is measured from the band, a band starts
 * at the left margin, and the prompt was handing the model page-absolute
 * coordinates. Everything shifted an inch right and down and the rightmost
 * content fell outside the printable area — and **`checkRepx` passed it**,
 * because the XML parsed and had a root element and a `<Bands>`. Structure was
 * all it ever looked at.
 *
 * Two deliberate limits:
 *
 * - **Only controls directly inside a band's `<Controls>` are checked.** A
 *   control nested inside another (a panel, a table cell) is positioned
 *   relative to *its* parent, so measuring it against the page would invent
 *   failures. Better to check less and be right.
 * - **`Weight`-based table internals are skipped** for the same reason: rows and
 *   cells carry no `LocationFloat` at all.
 */
function geometryWarnings(doc: Document): string[] {
  const warnings: string[] = [];
  const root = doc.documentElement;

  const pageWidth = num(root.getAttribute('PageWidth'));
  const pageHeight = num(root.getAttribute('PageHeight'));
  if (pageWidth === null || pageHeight === null) return warnings;

  // DevExpress writes Margins as "Left, Right, Top, Bottom".
  const margins = (root.getAttribute('Margins') || '')
    .split(',')
    .map((n) => Number(n.trim()));
  const [ml, mr, mt, mb] =
    margins.length === 4 && margins.every(Number.isFinite) ? margins : [0, 0, 0, 0];

  const printableWidth = pageWidth - ml - mr;
  const printableHeight = pageHeight - mt - mb;

  if (printableWidth <= 0 || printableHeight <= 0) {
    warnings.push(
      `The margins (${ml}, ${mr}, ${mt}, ${mb}) leave no printable area on a ${pageWidth}x${pageHeight} page.`
    );
    return warnings;
  }

  const bandsEl = doc.getElementsByTagName('Bands')[0];
  if (!bandsEl) return warnings;

  let bandTotal = 0;

  for (const band of Array.from(bandsEl.children)) {
    const bandType = band.getAttribute('ControlType') || band.nodeName;
    const bandHeight = num(band.getAttribute('HeightF'));
    if (bandHeight !== null) bandTotal += bandHeight;

    const controlsEl = Array.from(band.children).find((c) => c.nodeName === 'Controls');
    if (!controlsEl) continue;

    for (const control of Array.from(controlsEl.children)) {
      const at = parsePair(control.getAttribute('LocationFloat'));
      const size = parsePair(control.getAttribute('SizeF'));
      if (!at || !size) continue;

      const [x, y] = at;
      const [w, h] = size;
      const name = control.getAttribute('Name') || control.getAttribute('ControlType') || 'a control';

      if (x < 0 || y < 0) {
        warnings.push(`"${name}" is positioned off the page at ${x},${y}.`);
      } else if (x + w > printableWidth + 0.5) {
        // The half-unit tolerance keeps rounding in the model's arithmetic from
        // being reported as a defect.
        warnings.push(
          `"${name}" runs to ${Math.round(x + w)} across, past the ${Math.round(printableWidth)}-unit printable width — ` +
          `the designer will clip it or push it onto another page.`
        );
      } else if (bandHeight !== null && bandHeight > 0 && y + h > bandHeight + 0.5) {
        warnings.push(
          `"${name}" ends at ${Math.round(y + h)} down, past the ${Math.round(bandHeight)}-unit height of ${bandType} — ` +
          `the band will grow and move everything below it.`
        );
      }
    }
  }

  if (bandTotal > printableHeight + 0.5) {
    warnings.push(
      `The bands total ${Math.round(bandTotal)} units, more than the ${Math.round(printableHeight)} available on the page — ` +
      `this report will run onto a second page.`
    );
  }

  if (warnings.length > MAX_WARNINGS) {
    const extra = warnings.length - MAX_WARNINGS;
    return [...warnings.slice(0, MAX_WARNINGS), `…and ${extra} more like this.`];
  }
  return warnings;
}

/**
 * Parse check. A failed generation usually still *looks* like XML, so this
 * confirms both that it parses and that the DevExpress root element is present
 * — the two things that decide whether the designer will open the file — and
 * then measures the geometry against the page it declares.
 */
export function checkRepx(xml: string): RepxCheck {
  if (!xml?.trim()) return { ok: false, message: 'No REPX was generated.', warnings: [] };
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { ok: false, message: 'This XML does not parse — DevExpress will refuse it.', warnings: [] };
    }
    if (doc.documentElement?.nodeName !== 'XtraReportsLayoutSerializer') {
      return {
        ok: false,
        message: `Unexpected root element "${doc.documentElement?.nodeName}" — expected XtraReportsLayoutSerializer.`,
        warnings: [],
      };
    }
    const bands = doc.getElementsByTagName('Bands').length;
    if (bands === 0) {
      return { ok: false, message: 'Valid XML, but it contains no <Bands> — the report would open empty.', warnings: [] };
    }

    const warnings = geometryWarnings(doc);
    return {
      ok: true,
      message: warnings.length
        ? 'Valid DevExpress report XML, but some elements do not fit the page.'
        : 'Valid DevExpress report XML.',
      warnings,
    };
  } catch {
    return { ok: false, message: 'This XML could not be checked.', warnings: [] };
  }
}
