/**
 * The report as a Word document, the way DevExpress 20.1 exports one (parity
 * row 21), read out of its DOCX of s23 and s54a. It is the RTF export in
 * WordprocessingML: page by page, a section per page with the report's paper
 * and margins, and every item a paragraph in a frame, `w:framePr` with its
 * width, exact height and position, x from the margin and y from the page's
 * top, in twips. s54a's title was `w:w="5760" w:h="432" w:x="0" w:y="720"`.
 * A chart is a PNG picture in its own frame, as there. See `rtfExport.ts`
 * for the one difference, the empty frame DevExpress writes for the rest of
 * a box cut at the foot.
 */
import { buildZip } from './zip';
import { unitsPerInch } from './reportGeometry';
import { argb, reportItems, rgbHex, type ExportItem, type ExportPicture } from './exportItems';
import type { PaginatedReport, ReportStructure } from './reportPreview';
import { pictureDescription } from './csvExport';
import { xmlSafeText } from './xmlEscape';

// A character XML cannot hold is dropped first (the 2026-11-11 audit, PX-12):
// one CHAR(11) in a row of data made Word refuse to open the whole document.
const xml = (s: string) => xmlSafeText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The report laid out page by page as `report`, as a .docx package. */
export function reportToDocx(report: PaginatedReport, structure: ReportStructure, pictures: readonly ExportPicture[] = []): Uint8Array {
  const twips = (units: number) => Math.round((units / unitsPerInch(report.unit)) * 1440);
  const emu = (units: number) => Math.round((units / unitsPerInch(report.unit)) * 914400);
  const items = reportItems(report);
  const margins = structure.margins;
  const rels: string[] = [];
  const media: { name: string; content: Uint8Array }[] = [];
  const rel = (type: string, target: string, external = false) => {
    const id = `rId${rels.length + 1}`;
    rels.push(`<Relationship Id="${id}" Type="${R}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  };
  const framePr = (left: number, top: number, right: number, bottom: number) =>
    `<w:framePr w:w="${twips(right - left)}" w:h="${twips(bottom - top)}" w:hRule="exact" w:wrap="none" w:vAnchor="page" w:hAnchor="margin" w:x="${twips(left - margins.left)}" w:y="${twips(top)}"/>`;
  const tight = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';

  const textParagraph = (item: ExportItem) => {
    const f = item.font;
    const rPr =
      `<w:rPr><w:rFonts w:ascii="${xml(f.name)}" w:hAnsi="${xml(f.name)}" w:cs="${xml(f.name)}"/>` +
      (f.bold ? '<w:b/>' : '') + (f.italic ? '<w:i/>' : '') + (f.underline ? '<w:u w:val="single"/>' : '') +
      `<w:color w:val="${rgbHex(f.color)}"/><w:sz w:val="${Math.trunc(f.size * 2)}"/><w:szCs w:val="${Math.trunc(f.size * 2)}"/></w:rPr>`;
    const lines = item.lines ?? item.text.split('\n');
    const runs = lines.map((line, i) => `<w:r>${rPr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
    const body = item.url ? `<w:hyperlink r:id="${rel('hyperlink', item.url, true)}">${runs}</w:hyperlink>` : runs;
    const jc = item.h === 'center' ? 'center' : item.h === 'right' ? 'right' : 'left';
    const shd = item.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${rgbHex(argb(item.fill, 'FFFFFFFF'))}"/>` : '';
    return `<w:p><w:pPr>${framePr(item.left, item.top, item.right, item.bottom)}${shd}${tight}<w:jc w:val="${jc}"/></w:pPr>${body}</w:p>`;
  };
  const pictureParagraph = (picture: ExportPicture, n: number) => {
    const name = `media/image${n}.png`;
    media.push({ name: `word/${name}`, content: picture.png });
    const id = rel('image', name);
    const cx = emu(picture.right - picture.left);
    const cy = emu(picture.bottom - picture.top);
    // Its control's AccessibleDescription as the drawing's description, the
    // alternative text Word reads out (2026-11-11, CP-14).
    const said = pictureDescription(report, picture);
    const descr = said ? ` descr="${xml(said)}"` : '';
    return (
      `<w:p><w:pPr>${framePr(picture.left, picture.top, picture.right, picture.bottom)}${tight}</w:pPr><w:r><w:drawing>` +
      `<wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"${descr}/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>` +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    );
  };

  const landscape = structure.page.width > structure.page.height;
  const sectPr =
    `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${twips(structure.page.width)}" w:h="${twips(structure.page.height)}"${landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  let pictureCount = 0;
  const body = report.pages.map((_, p) => {
    const paragraphs = [
      ...pictures.filter((x) => x.page === p).map((x) => pictureParagraph(x, ++pictureCount)),
      ...items.filter((x) => x.page === p).map(textParagraph),
    ];
    // Every section but the last ends in a paragraph carrying its properties.
    return p < report.pages.length - 1 ? `${paragraphs.join('')}<w:p><w:pPr>${tight}${sectPr}</w:pPr></w:p>` : paragraphs.join('');
  });
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${body.join('')}${sectPr}</w:body></w:document>`;

  const files = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: 'word/document.xml', content: document },
    {
      name: 'word/_rels/document.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    },
    ...media,
  ];
  const zip = buildZip(files, new Date(), { keepPaths: true });
  if (!zip.bytes) throw new Error(`The document could not be written: ${zip.reason}.`);
  return zip.bytes;
}
