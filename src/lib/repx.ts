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

/**
 * Parse check. A failed generation usually still *looks* like XML, so this
 * confirms both that it parses and that the DevExpress root element is present
 * — the two things that decide whether the designer will open the file.
 */
export function checkRepx(xml: string): { ok: boolean; message: string } {
  if (!xml?.trim()) return { ok: false, message: 'No REPX was generated.' };
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { ok: false, message: 'This XML does not parse — DevExpress will refuse it.' };
    }
    if (doc.documentElement?.nodeName !== 'XtraReportsLayoutSerializer') {
      return {
        ok: false,
        message: `Unexpected root element "${doc.documentElement?.nodeName}" — expected XtraReportsLayoutSerializer.`,
      };
    }
    const bands = doc.getElementsByTagName('Bands').length;
    if (bands === 0) return { ok: false, message: 'Valid XML, but it contains no <Bands> — the report would open empty.' };
    return { ok: true, message: 'Valid DevExpress report XML.' };
  } catch {
    return { ok: false, message: 'This XML could not be checked.' };
  }
}
