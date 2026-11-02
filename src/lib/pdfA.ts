/**
 * PDF/A for Forma's own PDF (parity row 72, built 2026-11-02).
 *
 * A report asks for PDF/A in its file, on the root:
 * `<ExportOptions><Pdf PdfACompatibility="PdfA2b" /></ExportOptions>`.
 * Measured in DevExpress 20.1 (s60a to s60d, s62a to s62d):
 *
 * - Its export is PDF 1.4 whatever the part, with an sRGB output intent and
 *   its ICC profile, every font embedded as a TrueType subset with a Unicode
 *   map, XMP metadata, no encryption and no cross-reference stream, PDF/A or
 *   not; the setting adds only the XMP's `pdfaid:part` and
 *   `pdfaid:conformance` (B).
 * - A report that asks for PDF/A and a password is refused: DevExpress
 *   throws "the specified PDF export options are not valid", for an open
 *   password with PDF/A-2b (s62a) and a permissions password with PDF/A-1b
 *   (s62b), and writes no file. PDF/A forbids encryption.
 * - A half transparent picture in a PDF/A-1b file is written with no soft
 *   mask (s62d): PDF/A-1 forbids transparency, so it is flattened.
 *
 * The output intent's profile is built here from the published sRGB
 * definition (IEC 61966-2-1) as an ICC version 2.1 display profile, rather
 * than carried as a file. Everything here is pure.
 */

/** The PDF/A part a report asks for (always conformance B), or null. */
export type PdfAPart = 1 | 2 | 3;

/** The report's `PdfACompatibility`, read from its root `<ExportOptions><Pdf>`: 1, 2, 3 or null for None. */
export function pdfaPartOf(xml: string | null | undefined): PdfAPart | null {
  const options = /<ExportOptions\b[^>]*>([\s\S]*?)<\/ExportOptions>/.exec(xml ?? '')?.[1] ?? '';
  const pdf = /<Pdf\b[^>]*>/.exec(options)?.[0] ?? '';
  const m = /\sPdfACompatibility="PdfA([123])b"/.exec(pdf);
  return m ? (Number(m[1]) as PdfAPart) : null;
}

/** What Forma says when a report asks for PDF/A and a password, which DevExpress refuses to export (s62a, s62b). */
export const PDFA_WITH_PASSWORD =
  "This report asks for PDF/A and a password, and PDF/A forbids encryption, so no PDF is written: DevExpress refuses the same export. Remove the password or set PdfACompatibility to None in the report's export options.";

/* ---------------------------------------------------------------- dates */

const two = (n: number) => String(n).padStart(2, '0');

/** A date as a PDF date string, in UTC: D:YYYYMMDDHHmmSS+00'00'. */
export function pdfDate(d: Date): string {
  return `D:${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}+00'00'`;
}

/** The same instant as XMP writes it, so the two agree as PDF/A requires. */
export function xmpDate(d: Date): string {
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}+00:00`;
}

/* ------------------------------------------------------------------ XMP */

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The document's XMP packet: the PDF/A identification, and the title,
 * producer and dates the document information dictionary also carries,
 * which PDF/A requires to agree.
 */
export function xmpPacket(o: { part: PdfAPart; title: string; producer: string; date: Date }): string {
  const when = xmpDate(o.date);
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    `<pdfaid:part>${o.part}</pdfaid:part>`,
    '<pdfaid:conformance>B</pdfaid:conformance>',
    '</rdf:Description>',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(o.title)}</rdf:li></rdf:Alt></dc:title>`,
    '</rdf:Description>',
    '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    `<pdf:Producer>${xmlText(o.producer)}</pdf:Producer>`,
    '</rdf:Description>',
    '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    `<xmp:CreateDate>${when}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${when}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${when}</xmp:MetadataDate>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

/* ----------------------------------------------------------- ICC profile */

/** The name the output intent gives its condition, as the ICC registry names sRGB. */
export const SRGB_CONDITION = 'sRGB IEC61966-2.1';

/** A number as ICC's s15Fixed16Number. */
const s15 = (v: number) => Math.round(v * 65536) | 0;

/**
 * An sRGB display profile, ICC version 2.1: the primaries adapted to the D50
 * connection space, the D65 media white, and the sRGB transfer curve sampled
 * at 1,024 points, which is how version 2 profiles carry it (they have no
 * parametric curves).
 */
export function srgbIccProfile(): Uint8Array {
  const curvePoints = 1024;
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const desc = SRGB_CONDITION;
  const tags: { sig: string; data: number[] }[] = [];
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const xyz = (x: number, y: number, z: number) => [...text('XYZ '), 0, 0, 0, 0, ...u32(s15(x)), ...u32(s15(y)), ...u32(s15(z))];
  // textDescriptionType: ASCII, an empty Unicode part and an empty ScriptCode part.
  tags.push({
    sig: 'desc',
    data: [
      ...text('desc'), 0, 0, 0, 0,
      ...u32(desc.length + 1), ...text(desc), 0, // ASCII, counted with its NUL
      ...u32(0), ...u32(0), // Unicode language code and count
      0, 0, 0, // ScriptCode code and count
      ...new Array(67).fill(0), // the Macintosh description, unused
    ],
  });
  tags.push({ sig: 'cprt', data: [...text('text'), 0, 0, 0, 0, ...text('No copyright, use freely'), 0] });
  tags.push({ sig: 'wtpt', data: xyz(0.9505, 1, 1.089) });
  tags.push({ sig: 'rXYZ', data: xyz(0.4360747, 0.2225045, 0.0139322) });
  tags.push({ sig: 'gXYZ', data: xyz(0.3850649, 0.7168786, 0.0971045) });
  tags.push({ sig: 'bXYZ', data: xyz(0.1430804, 0.0606169, 0.7141733) });
  const curve = [...text('curv'), 0, 0, 0, 0, ...u32(curvePoints)];
  for (let i = 0; i < curvePoints; i++) {
    const x = i / (curvePoints - 1);
    const y = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    const v = Math.round(y * 65535);
    curve.push(v >> 8, v & 255);
  }
  tags.push({ sig: 'rTRC', data: curve });

  // The three curves share one copy of the data, which ICC allows.
  const entries = [...tags.map((t) => t.sig), 'gTRC', 'bTRC'];
  const tableSize = 4 + entries.length * 12;
  let offset = 128 + tableSize;
  const placed = new Map<string, { offset: number; size: number }>();
  const body: number[] = [];
  for (const t of tags) {
    placed.set(t.sig, { offset, size: t.data.length });
    body.push(...t.data);
    offset += t.data.length;
    while (offset % 4) {
      body.push(0);
      offset++;
    }
  }
  placed.set('gTRC', placed.get('rTRC')!);
  placed.set('bTRC', placed.get('rTRC')!);
  const size = offset;

  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  v.setUint32(8, 0x02100000); // version 2.1
  out.set(text('mntr'), 12);
  out.set(text('RGB '), 16);
  out.set(text('XYZ '), 20);
  // 2026-11-02 00:00:00, the day this profile was first written.
  [2026, 11, 2, 0, 0, 0].forEach((n, i) => v.setUint16(24 + i * 2, n));
  out.set(text('acsp'), 36);
  // Rendering intent 0 (perceptual); the D50 connection space illuminant.
  v.setInt32(68, s15(0.9642));
  v.setInt32(72, s15(1));
  v.setInt32(76, s15(0.8249));
  v.setUint32(128, entries.length);
  entries.forEach((sig, i) => {
    const at = 132 + i * 12;
    out.set(text(sig), at);
    v.setUint32(at + 4, placed.get(sig)!.offset);
    v.setUint32(at + 8, placed.get(sig)!.size);
  });
  out.set(body, 128 + tableSize);
  return out;
}

/* --------------------------------------------------------- transparency */

/**
 * An image's pixels composed over white, for PDF/A-1, which forbids the soft
 * mask an alpha channel would need. DevExpress flattens the same picture
 * (s62d).
 */
export function flattenOnWhite(rgb: Uint8Array, alpha: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgb.length);
  for (let i = 0, k = 0; k < alpha.length; i += 3, k++) {
    const a = alpha[k] / 255;
    out[i] = Math.round(rgb[i] * a + 255 * (1 - a));
    out[i + 1] = Math.round(rgb[i + 1] * a + 255 * (1 - a));
    out[i + 2] = Math.round(rgb[i + 2] * a + 255 * (1 - a));
  }
  return out;
}
