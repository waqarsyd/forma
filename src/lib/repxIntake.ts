/**
 * What a dropped or picked file brings in (2026-11-11, the full audit's
 * PIPE1): its pictures, its text and what to tell the user, one file at a
 * time. Moved here from App.tsx, where it was the file intake section, and
 * loaded only when a file arrives, which also takes it off the workspace's
 * own chunk.
 *
 * The pure parts are what the tests read: which pages of a long PDF are read
 * (`pdfPagesToRead`), where a PDF's strings sit on the page as it displays
 * (`pdfTextItems`) and how they are written in the report's unit
 * (`pdfPageText`), which pictures go as they are (`pictureNeed`), what an
 * uploaded `.repx` keeps (`repxAttachment`) and the key a page's reading is
 * kept under (`pictureKey`).
 */
import type { PreviewMeta } from './attachments';
import { MAX_FILE_BYTES, MAX_PDF_PAGES } from './attachmentBudget';
import { inkPoints, pageShaped, pageTurn } from './deskew';
import { withPdfDocument } from './pdf';
import { checkRepx } from './repx';
import { pointsToUnits } from './reportGeometry';
import { decodeBase64, readRepxDataSources, stripStoredCredentials } from './repxSqlDataSource';
import type { DatabaseText } from './sqlSchema';

/**
 * ~250 DPI. The previous 1.5 (~150 DPI) left small footers and dense table
 * figures soft, and soft text becomes wrong Text= values and wrong coordinates
 * in the generated REPX.
 */
const PDF_RENDER_SCALE = 2.5;
/** Cap on extracted strings per page, so a dense page cannot flood the prompt. */
const MAX_TEXT_ITEMS_PER_PAGE = 400;

/**
 * A non-visual attachment: a PDF's text layer, or the contents of a .repx.
 *
 * `uploadId` is the same id the upload's page images carry in `PreviewMeta`,
 * and it is what ties the two lists back together. Without it the composer had
 * no way to tell that eight "page N text" entries and eight page images were
 * one file the user dropped, so it drew sixteen chips for one PDF.
 */
export interface TextAttachment {
  id: string;
  uploadId: string;
  /** Source filename. Display is derived from this, never stored pre-formatted. */
  file: string;
  /** 1-based page number, for text recovered page by page. */
  page?: number;
  text: string;
  /**
   * A PDF page's strings in points (2026-11-11, the full audit's PL-18), so
   * `text` can be written again in the unit worked out when the message is
   * sent (`pdfPageText`): attached, the unit is not known yet.
   */
  pdf?: PdfPageText;
  /**
   * Read off a picture by OCR, not attached (the PIPE1 review): the
   * correction request leaves these out by this mark. It matched `-ocr-` in
   * the id until then, which a file of the user's named scan-ocr-2026.csv
   * also carries.
   */
  readByOcr?: true;
  /**
   * A Word or Excel file's layout as Forma's draft (2026-11-11, the full
   * audit's CP-11, lib/docxLayout.ts and lib/xlsxLayout.ts): what the AI
   * corrects when the words ask for a report from the file
   * (`templateCorrection`). The file's words or data go as `text` as before.
   */
  layout?: string;
}

/*
 * Whether the words ask for a report laid out from an attached file rather
 * than for its data or its words alone: "use this template", "lay it out
 * like the Word document", "same layout as the spreadsheet", "a report from
 * this form". A layout or a look counts only when it is the file's
 * (2026-11-11, the review of CP-11): "a report of these orders with a clean
 * layout" beside a spreadsheet of data asks for the data, not its layout.
 */
const FILE_NOUN = '(?:word\\s+|excel\\s+)?(?:document|doc|docx|file|form|sheet|spreadsheet|workbook|xlsx|attachment)';
const THE = '(?:the|this|my|that|attached|the\\s+attached)';
const FROM_TEMPLATE = new RegExp(
  [
    'template',
    'same\\s+(?:layout|look|format|design|style)',
    `(?:lay(?:\\s+it)?\\s+out|laid\\s+out|layout|look(?:s|ing)?|design(?:ed)?|format(?:ted)?)\\s+(?:just\\s+)?(?:like|as\\s+in|as|of|from|in)\\s+${THE}\\s+${FILE_NOUN}`,
    `${FILE_NOUN}'?s\\s+(?:layout|look|design|format)`,
    `(?:this|that|its)\\s+(?:layout|look|design)`,
    `like\\s+${THE}\\s+${FILE_NOUN}`,
    `(?:from|based\\s+on)\\s+${THE}\\s+(?:word\\s+|excel\\s+)?(?:document|doc|docx|form|template)`,
  ].map((p) => `\\b${p}\\b`).join('|'),
  'i',
);

/**
 * The draft of an attached Word or Excel template, when the words ask for a
 * report from it (CP-11), as the AI is given it to correct: its layout and
 * its name. Null when they do not, or no attachment has one.
 */
export function templateCorrection(texts: readonly TextAttachment[], words: string): { text: string; texts: []; title: string } | null {
  const found = texts.find((t) => t.layout);
  if (!found?.layout || !FROM_TEMPLATE.test(words)) return null;
  return { text: found.layout, texts: [], title: found.file.replace(/\.[^.]+$/, '') };
}

export interface IngestResult {
  images: string[];
  /**
   * One entry per image in `images`, same order, same length: which upload it
   * came from and which page of it.
   *
   * Kept parallel rather than folded into `images` because that array's shape is
   * depended on all the way downstream — the request parts, `sourceRect`
   * cropping, and the `images` persisted on a saved report all expect bare data
   * URLs. Provenance is presentation, and it stops at the composer.
   */
  imageMeta: PreviewMeta[];
  texts: TextAttachment[];
  /**
   * A database's layout or sample rows (2026-11-08, the SQL Server programme):
   * read here, kept on the device and summarised for the AI by `ingestFiles`,
   * which knows the database already in use.
   */
  database?: DatabaseText & { file: string; uploadId: string };
  /** User-facing warnings: skipped files, dropped pages, invalid XML. */
  notices: string[];
}

/* ------------------------------------------------------------- PDF pages */

/**
 * The pages of a PDF that are read (2026-11-11, the full audit's CP-04): all
 * of them up to `max`, and past it the first `max - 1` and the last, which
 * carries the totals and the closing footer the first pages do not show.
 * Until then the first `max` were read and the last never was.
 */
export function pdfPagesToRead(pageCount: number, max = MAX_PDF_PAGES): number[] {
  const count = Math.max(0, Math.floor(pageCount));
  if (count <= max) return Array.from({ length: count }, (_, i) => i + 1);
  return [...Array.from({ length: Math.max(0, max - 1) }, (_, i) => i + 1), count];
}

/** What the user is told when a PDF has more pages than are read. */
export function pdfPagesNotice(name: string, pageCount: number, max = MAX_PDF_PAGES): string {
  return `"${name}" has ${pageCount} pages; the first ${max - 1} and the last were read.`;
}

/** A PDF page's strings, each placed on the page as it displays, in points from its top-left. */
export interface PdfPageText {
  page: number;
  /** The page's size as it displays, rotation applied, in points. */
  width: number;
  height: number;
  items: { text: string; x: number; y: number; w: number; h: number }[];
  /** Strings past the per-page cap, read from the page's picture instead. */
  omitted: number;
}

/** pdf.js's `Util.transform`: the matrix `m2` applied, then `m1`. */
export function transform(m1: readonly number[], m2: readonly number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** The parts of a pdf.js text item this reads. */
export interface PdfTextItem {
  str?: string;
  transform?: readonly number[];
  width?: number;
  height?: number;
}

/**
 * A PDF page's text with real coordinates.
 *
 * This is the whole reason a digital PDF beats a photograph: the file already
 * knows every string and where it sits, so the model should never have to read
 * that back out of pixels.
 *
 * Placed through the page's scale-1 viewport (2026-11-11, the full audit's
 * PL-18), as pdf.js's own text layer places them: `transform(viewport, item)`
 * puts each baseline on the page as it displays, rotation and an offset media
 * box included. Until then x and y were read straight off the item's
 * transform and flipped against the page height, so a page saved rotated (a
 * landscape scan, say) had every string at its unrotated place.
 *
 * pdf.js sets an item's height to the font's EM SIZE in points, not the ink's,
 * so that one number is both the box height and the exact font size; it is 0
 * only for vertical fonts, which keep the rotated transform's own scale.
 */
export function pdfTextItems(
  viewport: { width: number; height: number; transform: readonly number[] },
  items: readonly PdfTextItem[],
  page: number,
): PdfPageText {
  const out: PdfPageText = { page, width: viewport.width, height: viewport.height, items: [], omitted: 0 };
  for (const item of items) {
    const text = (item.str || '').trim();
    if (!text) continue;
    // Counted rather than inferred from items.length: blank items are skipped
    // above and would otherwise be counted as dropped strings.
    if (out.items.length >= MAX_TEXT_ITEMS_PER_PAGE) {
      out.omitted++;
      continue;
    }
    const at = transform(viewport.transform, item.transform ?? [1, 0, 0, 1, 0, 0]);
    const h = item.height || Math.hypot(at[2], at[3]);
    // at[4], at[5] is the baseline's start, measured down from the top: the
    // box's top is one em above it.
    out.items.push({ text, x: at[4], y: at[5] - h, w: item.width || 0, h });
  }
  return out;
}

/**
 * A page's strings as the prompt reads them, in `reportUnit`: the form the
 * model is told to take as exact. Null for a page with none, a scan, which
 * is read as pictures when it is sent.
 */
export function pdfPageText(pdf: PdfPageText, reportUnit?: string): string | null {
  if (!pdf.items.length) return null;
  const units = (points: number) => Math.round(pointsToUnits(points, reportUnit));
  const lines = pdf.items.map((t) => `"${t.text.replace(/"/g, "'")}" x=${units(t.x)} y=${units(t.y)} w=${units(t.w)} h=${units(t.h)}`);
  return (
    `PDF page ${pdf.page} — text layer extracted from the file itself. ` +
    `These strings and coordinates are EXACT and take priority over anything read from the page image.\n` +
    `Page is ${units(pdf.width)} x ${units(pdf.height)} report units. ` +
    `Coordinates are already in report units (${reportUnit || 'HundredthsOfAnInch'}), origin at the top-left of the paper.\n` +
    `h is the font's em size taken from the file, so it is each string's EXACT font size as well as its height — ` +
    `use it rather than estimating a size from the page image.\n` +
    lines.join('\n') +
    (pdf.omitted > 0 ? `\n(${pdf.omitted} further strings omitted.)` : '')
  );
}

/**
 * The attached texts written in the unit worked out for the request: a PDF
 * page's strings again (PL-18), everything else as it was. Called when the
 * message is sent, after the settings are worked out.
 */
export function inUnit<T extends { text: string; pdf?: PdfPageText }>(texts: readonly T[], reportUnit: string): T[] {
  return texts.map((t) => {
    if (!t.pdf) return t;
    const text = pdfPageText(t.pdf, reportUnit);
    return text ? { ...t, text } : t;
  });
}

/* ------------------------------------------------------------- pictures */

/** The picture types Gemini takes as they are; anything else is drawn again first. */
export const AI_PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

/**
 * What a picture needs before it can go (2026-11-11, the full audit's PL-17):
 * nothing, or to be drawn again as PNG or JPEG. A GIF, BMP or TIFF went as
 * it came when it was small, and the AI refused the request. A TIFF a browser
 * cannot draw (Chrome draws none) is told to the user (`tiffNotice`).
 */
export function pictureNeed(type: string, name = ''): 'keep' | 'redraw' {
  const t = type.toLowerCase() || (/\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : '');
  return AI_PICTURE_TYPES.includes(t) ? 'keep' : 'redraw';
}

/** Whether a file is a TIFF, by its type or, where the browser gave none, by its name. */
export function isTiff(type: string, name: string): boolean {
  return /^image\/tiff?$/i.test(type) || /\.tiff?$/i.test(name);
}

export function tiffNotice(name: string): string {
  return `"${name}" is a TIFF; save it as PNG or PDF and attach that.`;
}

/**
 * A short key for a picture's content (2026-11-11, the full audit's PL-31b):
 * FNV-1a over the data URL, with its length. A page sent again without its
 * upload's id was kept under `again-0`, so the second picture sent again read
 * as the first one's text.
 */
export function pictureKey(src: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `pic-${(h >>> 0).toString(36)}-${src.length.toString(36)}`;
}

/* ------------------------------------------------- what the page shows */

/**
 * What Forma's own reading of the page finds the report lacks (PL-11b,
 * `evidenceFindingsOf` in geminiService.ts), each in a sentence of its own.
 * The PIPE1 review: sent through the reply's general list, a table drawn as
 * loose texts read "Something in the file will not print as drawn", which is
 * untrue of it: it prints as drawn, and its columns cannot be bound or
 * repeat. Only these two codes come from the page; another says nothing
 * rather than something general.
 */
export const EVIDENCE_SENTENCES: Readonly<Record<string, string>> = {
  'grid-not-a-table': 'A table on your page came out as separate texts, so its columns cannot be bound to data or repeat for each record.',
  'no-detail-band': 'Your page has rows that repeat, but the report has no section for its records, so they print only once.',
};

/** The reply's lines for what the page shows the report lacks, or '' when it lacks nothing that can be said. */
export function evidenceMarkdown(findings: readonly { code?: string }[]): string {
  const said = [...new Set(findings.map((f) => (f.code && EVIDENCE_SENTENCES[f.code]) || '').filter(Boolean))];
  return said.length ? `**Compared with your page**\n${said.map((s) => `- ${s}`).join('\n')}` : '';
}

/** The REPX pane's summary with the page's findings counted in words, not named by code. */
export function evidenceSummary(summary: string, count: number): string {
  if (!count) return summary;
  return `${summary}; and ${count} ${count === 1 ? 'thing' : 'things'} your page shows the report lacks`;
}

/* ------------------------------------------------------------- reports */

/** The notice when an uploaded report carried a database login (SE-01). */
export const LOGIN_REMOVED_NOTICE =
  'This report kept a database login. Forma removed it before reading the report; your copy on disk is unchanged.';

/**
 * An uploaded `.repx` as it is read (2026-11-11, the full audit's SE-01): its
 * text with every data source's connection stored by name only, as Forma
 * writes it. A report saved with its login and password in its SqlDataSource
 * went to the AI with them, base64 and all, inside the request; only what
 * came back was cleaned. Batch reads through here too.
 */
export function repxAttachment(name: string, xml: string): { text: string; notices: string[] } {
  const notices: string[] = [];
  const sources = readRepxDataSources(xml);
  // A login kept as the connection's parameters, or (the PIPE1 review) a
  // password inside a custom connection string, which was taken out as well
  // and said nothing.
  const hadLogin = sources.some((d) => d.storesCredentials || (!d.fromAppConfig && connectionHasPassword(xml, d.ref)));
  const clean = stripStoredCredentials(xml);
  if (hadLogin) notices.push(LOGIN_REMOVED_NOTICE);
  const verdict = checkRepx(clean.xml);
  if (!verdict.ok) notices.push(`"${name}": ${verdict.message}`);
  return {
    text: `Existing DevExpress report (${name}). Use this as the base structure and preserve it unless asked to change it:\n\n${clean.xml}`,
    notices,
  };
}

/** A password or pwd with a value in the custom connection string of the data source stored at `ref`. */
function connectionHasPassword(xml: string, ref: string): boolean {
  if (!ref) return false;
  const stored = new RegExp(`<Item\\d+\\s[^>]*?Ref="${ref}"[^>]*?Base64="([^"]*)"`).exec(xml);
  if (!stored) return false;
  try {
    const connection = /<Connection\s[^>]*?(?:\/>|>[\s\S]*?<\/Connection>)/.exec(decodeBase64(stored[1]))?.[0] ?? '';
    return /\b(?:password|pwd)\s*=\s*[^;"&\s]/i.test(connection);
  } catch {
    return false;
  }
}

/**
 * A Crystal Reports file (2026-11-11, the full audit's CP-01a): its layout is
 * a binary only Crystal Reports reads, so the way in is its PDF.
 */
export function crystalNotice(name: string): string {
  return `"${name}" is a Crystal Reports file. Export it from Crystal Reports as a PDF (File > Export) and attach the PDF.`;
}

/**
 * An SSRS report definition (.rdl, .rdlc) as it is read (CP-01a, PL-26): XML,
 * like a .repx, its layout for the AI to reproduce. A password in a
 * connection string is taken out, for the reason SE-01 gives, quoted values
 * whole (the PIPE1 review: `password="x"` lost its name and kept `"x"`,
 * which broke the XML). An embedded picture's bytes are left out too: they
 * do not survive into a DevExpress report, and an RDL with a logo sent its
 * whole base64 with every request.
 */
export function rdlAttachment(name: string, xml: string): string {
  const clean = xml
    .replace(/\b(?:password|pwd)\s*=\s*(?:"[^"]*"|'[^']*'|&quot;[\s\S]*?&quot;|[^;<"']*);?/gi, () => '')
    .replace(/(<ImageData>)[\s\S]*?(<\/ImageData>)/gi, (_, open: string, close: string) => `${open}(an embedded picture)${close}`);
  return `An SSRS report definition (${name}); reproduce its layout as a DevExpress report:\n\n${clean}`;
}

/**
 * An SSRS or FastReport file as a repaired DevExpress report, with what to
 * tell the user of it, or null when it is not one Forma converts. Both
 * modules come with such a file only.
 */
export async function importedReport(name: string, xml: string): Promise<{ xml: string; notices: string[] } | null> {
  const [{ importForeign }, { repairRepx }] = await Promise.all([import('./importForeign'), import('./repairChain')]);
  const made = importForeign(name, xml);
  if (!made) return null;
  return { xml: repairRepx(made.repx, { version: '20.1' }).xml, notices: made.notices };
}

/* ------------------------------------------------------------- intake */

/**
 * Render one PDF page to a white-backed JPEG at PDF_RENDER_SCALE, at most
 * MAX_IMAGE_EDGE on its longest side. A scanned page (`straighten`, one with
 * no text layer) is drawn straight (CP-05); a digital one never is, its text
 * layer's places being the page's as it is.
 */
async function renderPdfPage(page: any, straighten: boolean): Promise<{ src: string; sideways: boolean } | null> {
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // pdf.js draws onto transparency; JPEG has no alpha, so an unpainted page
  // would come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport, canvas: canvas as any }).promise;

  const turn = straighten ? await turnOf(canvas, canvas.width, canvas.height) : 0;
  const drawn = drawTurned(canvas, canvas.width, canvas.height, turn);
  if (!drawn) return null;
  return { src: await encode(drawn.canvas, 'image/jpeg', JPEG_QUALITY), sideways: drawn.sideways };
}

/** A page's text layer, or null when it has none or it will not read. */
async function readPdfPageText(page: any, pageNumber: number): Promise<PdfPageText | null> {
  try {
    const content = await page.getTextContent();
    const read = pdfTextItems(page.getViewport({ scale: 1 }), content?.items || [], pageNumber);
    return read.items.length ? read : null;
  } catch (err) {
    console.warn(`Could not read the text layer of page ${pageNumber}:`, err);
    return null;
  }
}

/**
 * Turn one dropped or picked file into the parts that get sent. Unsupported
 * and oversized files produce a notice rather than being silently ignored —
 * previously dropping a .docx did nothing at all, with no feedback.
 *
 * `reportUnit` writes a PDF's text for now; the send writes it again in the
 * unit worked out for the request (`inUnit`).
 */
export async function ingestFile(file: File, uploadId: string, reportUnit?: string): Promise<IngestResult> {
  const out: IngestResult = { images: [], imageMeta: [], texts: [], notices: [] };
  const name = file.name || 'file';

  if (file.size > MAX_FILE_BYTES) {
    out.notices.push(`"${name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB and was skipped.`);
    return out;
  }

  if (file.type.startsWith('image/') || isTiff(file.type, name)) {
    const original = await readAsDataUrl(file);
    const picture = await preparePicture(file, original);
    if (!picture) {
      out.notices.push(isTiff(file.type, name) ? tiffNotice(name) : `"${name}" could not be read as a picture. Save it as PNG or JPEG and attach that.`);
      return out;
    }
    out.images.push(picture);
    out.imageMeta.push({ uploadId, file: name });
    return out;
  }

  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    try {
      // Loaded here rather than imported at the top: pdf.js is the largest
      // dependency in the project, so it comes only with a PDF. See src/lib/pdf.ts.
      await withPdfDocument(await file.arrayBuffer(), async (pdf) => {
        const pageCount = pdf.numPages;
        const numbers = pdfPagesToRead(pageCount);
        for (const n of numbers) {
          const page = await pdf.getPage(n);
          try {
            // The text layer first: a page without one is a scan, and only a
            // scan is straightened as it is drawn (CP-05).
            const pdfText = await readPdfPageText(page, n);
            const image = await renderPdfPage(page, !pdfText);
            if (image) {
              out.images.push(image.src);
              // Same uploadId for every page, so the composer shows one attachment
              // for the file the user actually dropped rather than one per page.
              // Its size in points too, so OCR can read the image at its
              // resolution: across and down as the picture now lies.
              const points = page.getViewport({ scale: 1 });
              const pagePoints = image.sideways ? { width: points.height, height: points.width } : { width: points.width, height: points.height };
              out.imageMeta.push({ uploadId, file: name, page: n, pagePoints });
            }
            // A dense page's tail past the per-page string cap is read from the
            // image instead, and a scan, with no text layer, is read as pictures
            // when it is sent. Notices said both until 2026-11-11 (the full
            // audit, CV-12 and CV-25): they told how the page was read and
            // changed nothing the user could do.
            const text = pdfText && pdfPageText(pdfText, reportUnit);
            if (pdfText && text) out.texts.push({ id: `${Date.now()}-${name}-p${n}`, uploadId, file: name, page: n, text, pdf: pdfText });
          } finally {
            // The page's own render and text caches, freed as soon as it is read.
            page.cleanup?.();
          }
        }
        if (numbers.length < pageCount) out.notices.push(pdfPagesNotice(name, pageCount));
      });
    } catch (err) {
      console.error('Error reading PDF:', err);
      out.notices.push(`"${name}" could not be read as a PDF.`);
    }
    return out;
  }

  if (/\.repx$/i.test(name)) {
    // Read as real text rather than shipping an opaque base64 blob: base64 is
    // 33% larger, and a string can actually be validated before it is sent.
    const xml = (await file.text()).trim();
    if (!xml) {
      out.notices.push(`"${name}" is empty.`);
      return out;
    }
    const read = repxAttachment(name, xml);
    out.notices.push(...read.notices);
    out.texts.push({ id: `${Date.now()}-${name}`, uploadId, file: name, text: read.text });
    return out;
  }

  if (/\.rpt$/i.test(name)) {
    out.notices.push(crystalNotice(name));
    return out;
  }

  if (/\.(rdlc?|frx)$/i.test(name)) {
    const xml = (await file.text()).trim();
    if (!xml) {
      out.notices.push(`"${name}" is empty.`);
      return out;
    }
    // Converted to a DevExpress report and repaired as a generated one is
    // (2026-11-11, the full audit's CP-08), then read as an uploaded .repx:
    // the base the request builds on, positions, fields and totals exact.
    // One that will not convert goes to the AI as its text, as an SSRS file
    // did before.
    const report = await importedReport(name, xml);
    if (report) {
      const read = repxAttachment(name, report.xml);
      out.notices.push(...report.notices, ...read.notices);
      out.texts.push({ id: `${Date.now()}-${name}`, uploadId, file: name, text: read.text });
    } else if (/\.rdlc?$/i.test(name)) {
      out.texts.push({ id: `${Date.now()}-${name}`, uploadId, file: name, text: rdlAttachment(name, xml) });
    } else {
      out.notices.push(`"${name}" could not be read as a FastReport report.`);
    }
    return out;
  }

  // A data file (2026-11-05, lib/dataFiles.ts): a table's columns are the
  // report's fields; a document is the person's words. Read in the browser,
  // by a module loaded only when such a file arrives.
  const data = await import('./dataFiles');
  if (data.isDataFile(name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A database's layout or sample rows, from Forma's scripts or an SSMS
    // "Generate Scripts" file (2026-11-08, lib/sqlSchema.ts): recognised before
    // it is read as plain data, and loaded only when such a file arrives.
    if (/\.(json|sql|txt)$/i.test(name)) {
      const { readDatabaseText } = await import('./sqlSchema');
      const found = readDatabaseText(new TextDecoder().decode(bytes).replace(/^﻿/, ''), name.replace(/\.[^.]+$/, ''));
      if (found) {
        out.database = { ...found, file: name, uploadId };
        return out;
      }
    }
    const read = await data.readDataFile(name, bytes);
    if (read.note) out.notices.push(read.note);
    // A Word or Excel file's layout too (CP-11), used when the words ask for a report from it.
    const layout = /\.docx$/i.test(name)
      ? await import('./docxLayout').then((m) => m.docxDraft(bytes))
      : /\.xlsx$/i.test(name) ? await import('./xlsxLayout').then((m) => m.xlsxDraft(bytes)) : null;
    if (read.text) out.texts.push({ id: `${Date.now()}-${name}`, uploadId, file: name, text: read.text, ...(layout ? { layout } : {}) });
    return out;
  }

  out.notices.push(`"${name}" is not a supported type. Use an image, a PDF, a report (.repx, SSRS .rdl or FastReport .frx), or data (CSV, TSV, JSON, text, SQL, Excel or Word).`);
  return out;
}

/**
 * Longest edge of an uploaded image, in pixels.
 *
 * **This buys upload time and browser memory. It does not buy tokens, and the
 * obvious assumption that it does is wrong.** Recorded here because it was
 * measured on 2026-09-06 and is the kind of thing that gets re-derived, or
 * worse, tuned in the belief that a smaller number is cheaper.
 *
 * Gemini bills an image by TILES, and the tile grid comes from the image's
 * shape rather than its size: the crop unit is `floor(min(w, h) / 1.5)`, so it
 * scales with the image and the tile count cancels out. The arithmetic on a
 * real upload, from the token log of that day:
 *
 *     2400x1500  crop unit 1000  ->  3 x 2 = 6 tiles = 1,548 tokens
 *     2048x1280  crop unit  853  ->  3 x 2 = 6 tiles = 1,548 tokens
 *
 * Identical. In practice the count reduces to `2 * ceil(1.5 * aspect)` tiles at
 * 258 tokens each, which depends on aspect ratio ALONE above the small-image
 * threshold. A portrait page is 4 tiles; a 16:9 screenshot is 6.
 *
 * The one resize that would save tokens is dropping BOTH dimensions to 384px or
 * under, which Google bills as a single 258-token tile -- a 6x cut, and an
 * invoice nobody can read. Accuracy is the product here, so that trade is not
 * available.
 *
 * What does reduce the image bill is a tighter CROP, because it can change the
 * aspect ratio and it puts more of the document inside each 768px tile. That is
 * a win on both counts and the only one worth chasing on this side; the prompt
 * was ~90% of that request's input, and the five behavioural sections that no
 * image can evidence are dropped from it automatically -- see BEHAVIOURAL in
 * `lib/promptSections.ts`.
 */
const MAX_IMAGE_EDGE = 2048;
const JPEG_QUALITY = 0.92;
/** Below this, re-encoding is not worth the quality risk. */
const REENCODE_THRESHOLD_BYTES = 1_200_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/*
 * Drawing a picture (2026-11-11, the full audit's PR-26): decoded with
 * `createImageBitmap`, which decodes off the page's thread, and drawn on an
 * `OffscreenCanvas` where the browser has them, so a large photo does not
 * stall the page while it is read. An `<img>` and a canvas in the page are
 * the way where it has not, and the way for a picture `createImageBitmap`
 * refuses.
 */
type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A white sheet to draw on, `w` by `h`. */
function surface(w: number, h: number): { canvas: Surface; ctx: Context2D } | null {
  const canvas: Surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as Context2D | null;
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // JPEG carries no alpha, so paint the sheet white first — otherwise a
  // transparent screenshot background would come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

/** A sheet as a data URL. */
async function encode(canvas: Surface, type: string, quality?: number): Promise<string> {
  if ('toDataURL' in canvas) return canvas.toDataURL(type, quality);
  return readAsDataUrl(await canvas.convertToBlob({ type, quality }));
}

/** A picture decoded, or null when the browser cannot draw it (a TIFF in Chrome). */
async function decode(file: Blob, dataUrl: string): Promise<{ image: CanvasImageSource; w: number; h: number; close: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width && bitmap.height) return { image: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() };
    } catch {
      // An <img> below, which decodes some pictures a bitmap will not.
    }
  }
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? { image: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined } : null;
  } catch {
    return null;
  }
}

/** The longest side the turn is measured on: enough for lines of text, cheap to read. */
const TURN_SAMPLE_EDGE = 700;

/** How far a page is turned clockwise, in degrees (lib/deskew.ts); 0 when it is straight or cannot be read. */
async function turnOf(image: CanvasImageSource, w: number, h: number): Promise<number> {
  try {
    const scale = Math.min(1, TURN_SAMPLE_EDGE / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const small = surface(sw, sh);
    if (!small) return 0;
    small.ctx.drawImage(image, 0, 0, sw, sh);
    // On its side only when it is shaped like a page, not a logo or a barcode.
    return pageTurn(inkPoints(small.ctx.getImageData(0, 0, sw, sh).data, sw, sh), pageShaped(w, h));
  } catch {
    return 0;
  }
}

/**
 * A picture drawn on white, turned back by `turn` degrees about its centre
 * and at most MAX_IMAGE_EDGE on its longest side: a page on its side is
 * drawn upright, its width and height exchanged (`sideways`).
 */
function drawTurned(image: CanvasImageSource, w: number, h: number, turn: number): { canvas: Surface; sideways: boolean } | null {
  const sideways = Math.round(turn / 90) % 2 !== 0;
  const ow = sideways ? h : w;
  const oh = sideways ? w : h;
  const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(ow, oh));
  const sheet = surface(Math.round(ow * ratio), Math.round(oh * ratio));
  if (!sheet) return null;
  const { ctx } = sheet;
  if (turn) {
    ctx.translate((ow * ratio) / 2, (oh * ratio) / 2);
    ctx.rotate((-turn * Math.PI) / 180);
    ctx.drawImage(image, (-w * ratio) / 2, (-h * ratio) / 2, w * ratio, h * ratio);
  } else {
    ctx.drawImage(image, 0, 0, w * ratio, h * ratio);
  }
  return { canvas: sheet.canvas, sideways };
}

/**
 * A picture as it is sent: straightened when it is turned (CP-05), drawn
 * again when it is a type the AI does not take (PL-17), shrunk when it is
 * past the edge or the weight worth sending (see MAX_IMAGE_EDGE), and
 * otherwise exactly as it came. Null when the browser cannot draw a picture
 * that has to be drawn again.
 *
 * Drawn again, a picture the AI does not take is PNG, which keeps every edge
 * of a scan's text, unless that is larger than the JPEG and past the
 * re-encoding threshold. Shrunk, a straight picture is never sent larger
 * than it came; a straightened one is worth its bytes.
 */
async function preparePicture(file: File, original: string): Promise<string | null> {
  const redraw = pictureNeed(file.type, file.name) === 'redraw';
  const decoded = await decode(file, original);
  if (!decoded) return redraw ? null : original;
  try {
    const { image, w, h } = decoded;
    const turn = await turnOf(image, w, h);
    if (!redraw && !turn && Math.max(w, h) <= MAX_IMAGE_EDGE && original.length < REENCODE_THRESHOLD_BYTES) return original;
    const page = drawTurned(image, w, h, turn);
    if (!page) return redraw ? null : original;
    if (redraw) {
      const png = await encode(page.canvas, 'image/png');
      if (png.length < REENCODE_THRESHOLD_BYTES) return png;
      const jpeg = await encode(page.canvas, 'image/jpeg', JPEG_QUALITY);
      return jpeg.length < png.length ? jpeg : png;
    }
    const out = await encode(page.canvas, 'image/jpeg', JPEG_QUALITY);
    return !turn && out.length >= original.length ? original : out;
  } catch {
    // Never let the drawing block an upload that can go as it came.
    return redraw ? null : original;
  } finally {
    decoded.close();
  }
}
