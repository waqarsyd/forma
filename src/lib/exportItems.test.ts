/**
 * The page-by-page and continuous text exports (parity row 21): RTF, DOCX and
 * HTML, each read back and compared with DevExpress's own export of s54a, a
 * report header, a group header per region, 45 customers over two pages and a
 * report footer. RTF and DOCX are compared frame by frame, where each item
 * sits on which page; HTML cell by cell, where each text sits in the table.
 */
import { describe, expect, it } from 'vitest';
import { paginate, parseReportStructure } from './reportPreview';
import { layoutContinuous } from './csvExport';
import { reportToRtf, rtfText } from './rtfExport';
import { reportToDocx } from './docxExport';
import { reportToHtml } from './htmlExport';

const S54A = "<?xml version=\"1.0\" encoding=\"utf-8\"?><XtraReportsLayoutSerializer SerializerVersion=\"20.1.3.0\" Ref=\"0\" ControlType=\"DevExpress.XtraReports.UI.XtraReport, DevExpress.XtraReports.v20.1, Version=20.1.3.0, Culture=neutral, PublicKeyToken=b88d1754d700e49a\" Name=\"s54a-bookmarks\" Bookmark=\"Sales by region\" Margins=\"50, 50, 50, 50\" PageWidth=\"850\" PageHeight=\"1100\" Version=\"20.1\" DataMember=\"Items\"><Bands><Item1 Ref=\"1\" ControlType=\"TopMarginBand\" HeightF=\"50\" /><Item2 Ref=\"2\" ControlType=\"ReportHeaderBand\" HeightF=\"40\"><Controls><Item1 Ref=\"3\" ControlType=\"XRLabel\" Name=\"title\" Text=\"Sales report\" Bookmark=\"Title\" SizeF=\"400,30\" LocationFloat=\"0,0\" /></Controls></Item2><Item3 Ref=\"4\" ControlType=\"GroupHeaderBand\" HeightF=\"30\"><GroupFields><Item1 Ref=\"5\" FieldName=\"Region\" /></GroupFields><Controls><Item1 Ref=\"6\" ControlType=\"XRLabel\" Name=\"region\" SizeF=\"300,25\" LocationFloat=\"0,0\"><ExpressionBindings><Item1 Ref=\"7\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Region]\" /><Item2 Ref=\"8\" EventName=\"BeforePrint\" PropertyName=\"Bookmark\" Expression=\"[Region]\" /></ExpressionBindings></Item1></Controls></Item3><Item4 Ref=\"9\" ControlType=\"DetailBand\" HeightF=\"25\"><Controls><Item1 Ref=\"10\" ControlType=\"XRLabel\" Name=\"customer\" BookmarkParent=\"#Ref-6\" SizeF=\"300,25\" LocationFloat=\"20,0\"><ExpressionBindings><Item1 Ref=\"11\" EventName=\"BeforePrint\" PropertyName=\"Text\" Expression=\"[Customer]\" /><Item2 Ref=\"12\" EventName=\"BeforePrint\" PropertyName=\"Bookmark\" Expression=\"[Customer]\" /></ExpressionBindings></Item1></Controls></Item4><Item5 Ref=\"13\" ControlType=\"ReportFooterBand\" HeightF=\"30\"><Controls><Item1 Ref=\"14\" ControlType=\"XRLabel\" Name=\"totals\" Text=\"Totals\" Bookmark=\"Totals\" SizeF=\"300,25\" LocationFloat=\"0,0\" /></Controls></Item5><Item6 Ref=\"15\" ControlType=\"BottomMarginBand\" HeightF=\"50\" /></Bands></XtraReportsLayoutSerializer>";
// DevExpress's exports of s54a, read back: each frame as page|text|x|y|w|h in twips, the
// sections' paper and margins, and each HTML cell as text@left,top WxH in pixels. Its empty
// frame for the blank rest of a box cut at the foot is left out, as Forma writes none.
const DX_RTF = ["section 1: paper 12240x15840 margins 720,720,720,720","1|Sales report|0|720|5760|432","1|North|0|1296|4320|360","1|Customer 01|288|1728|4320|360","1|Customer 04|288|2088|4320|360","1|Customer 07|288|2448|4320|360","1|Customer 10|288|2808|4320|360","1|Customer 13|288|3168|4320|360","1|Customer 16|288|3528|4320|360","1|Customer 19|288|3888|4320|360","1|Customer 22|288|4248|4320|360","1|Customer 25|288|4608|4320|360","1|Customer 28|288|4968|4320|360","1|Customer 31|288|5328|4320|360","1|Customer 34|288|5688|4320|360","1|Customer 37|288|6048|4320|360","1|Customer 40|288|6408|4320|360","1|Customer 43|288|6768|4320|360","1|South|0|7128|4320|360","1|Customer 02|288|7560|4320|360","1|Customer 05|288|7920|4320|360","1|Customer 08|288|8280|4320|360","1|Customer 11|288|8640|4320|360","1|Customer 14|288|9000|4320|360","1|Customer 17|288|9360|4320|360","1|Customer 20|288|9720|4320|360","1|Customer 23|288|10080|4320|360","1|Customer 26|288|10440|4320|360","1|Customer 29|288|10800|4320|360","1|Customer 32|288|11160|4320|360","1|Customer 35|288|11520|4320|360","1|Customer 38|288|11880|4320|360","1|Customer 41|288|12240|4320|360","1|Customer 44|288|12600|4320|360","1|West|0|12960|4320|360","1|Customer 03|288|13392|4320|360","1|Customer 06|288|13752|4320|360","1|Customer 09|288|14112|4320|360","1|Customer 12|288|14472|4320|360","1|Customer 15|288|14832|4320|288","section 2: paper 12240x15840 margins 720,720,720,720","2|Customer 18|288|792|4320|360","2|Customer 21|288|1152|4320|360","2|Customer 24|288|1512|4320|360","2|Customer 27|288|1872|4320|360","2|Customer 30|288|2232|4320|360","2|Customer 33|288|2592|4320|360","2|Customer 36|288|2952|4320|360","2|Customer 39|288|3312|4320|360","2|Customer 42|288|3672|4320|360","2|Customer 45|288|4032|4320|360","2|Totals|0|4392|4320|360"];
const DX_HTML = ["Sales report@0,0 384x29","North@0,38 288x24","Customer 01@19,67 288x24","Customer 04@19,91 288x24","Customer 07@19,115 288x24","Customer 10@19,139 288x24","Customer 13@19,163 288x24","Customer 16@19,187 288x24","Customer 19@19,211 288x24","Customer 22@19,235 288x24","Customer 25@19,259 288x24","Customer 28@19,283 288x24","Customer 31@19,307 288x24","Customer 34@19,331 288x24","Customer 37@19,355 288x24","Customer 40@19,379 288x24","Customer 43@19,403 288x24","South@0,427 288x24","Customer 02@19,456 288x24","Customer 05@19,480 288x24","Customer 08@19,504 288x24","Customer 11@19,528 288x24","Customer 14@19,552 288x24","Customer 17@19,576 288x24","Customer 20@19,600 288x24","Customer 23@19,624 288x24","Customer 26@19,648 288x24","Customer 29@19,672 288x24","Customer 32@19,696 288x24","Customer 35@19,720 288x24","Customer 38@19,744 288x24","Customer 41@19,768 288x24","Customer 44@19,792 288x24","West@0,816 288x24","Customer 03@19,845 288x24","Customer 06@19,869 288x24","Customer 09@19,893 288x24","Customer 12@19,917 288x24","Customer 15@19,941 288x24","Customer 18@19,965 288x24","Customer 21@19,989 288x24","Customer 24@19,1013 288x24","Customer 27@19,1037 288x24","Customer 30@19,1061 288x24","Customer 33@19,1085 288x24","Customer 36@19,1109 288x24","Customer 39@19,1133 288x24","Customer 42@19,1157 288x24","Customer 45@19,1181 288x24","Totals@0,1205 288x24"];
const ROWS = Array.from({ length: 45 }, (_, k) => ({
  Region: ['North', 'South', 'West'][k % 3],
  Customer: `Customer ${String(k + 1).padStart(2, '0')}`,
  Amount: String((k + 1) * 10),
}));
const structure = parseReportStructure(S54A);
const paged = paginate(structure, ROWS.length, { rows: ROWS });

/** Each frame of an RTF export, and each section's paper and margins. */
function rtfFrames(rtf: string): string[] {
  const out: string[] = [];
  rtf.split(/\\sect\b(?!d)/).forEach((sec, i) => {
    const size = /\\paperw(\d+)\\paperh(\d+)\\margl(\d+)\\margr(\d+)\\margt(\d+)\\margb(\d+)/.exec(sec);
    if (size) out.push(`section ${i + 1}: paper ${size[1]}x${size[2]} margins ${size[3]},${size[4]},${size[5]},${size[6]}`);
    for (const m of sec.matchAll(/\{\\pard\\overlay\\posx(-?\d+)\\posy(-?\d+)\\absw(\d+)\\absh-?(\d+)([^{}]*?)\\par\}/g)) {
      out.push(`${i + 1}|${m[5].replace(/^(\\[a-z]+-?\d* ?)+/, '').trim()}|${m[1]}|${m[2]}|${m[3]}|${m[4]}`);
    }
  });
  return out;
}

/** A store-only zip's entry, by name. */
function unzip(bytes: Uint8Array, name: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    if (new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength)) === name) {
      return new TextDecoder().decode(bytes.subarray(start, start + size));
    }
    at = start + size;
  }
  throw new Error(`no ${name}`);
}

/** Each framed paragraph of a DOCX document, numbered by section. */
function docxFrames(xml: string): string[] {
  const out: string[] = [];
  let page = 1;
  for (const p of xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)) {
    const fr = /<w:framePr ([^>]*)\/>/.exec(p[1]);
    const attr = (n: string) => (new RegExp(`w:${n}="([^"]*)"`).exec(fr?.[1] ?? '') ?? [])[1];
    const text = [...p[1].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('');
    if (fr && text) out.push(`${page}|${text}|${attr('x')}|${attr('y')}|${attr('w')}|${attr('h')}`);
    if (/<w:sectPr>/.test(p[1])) page++;
  }
  return out;
}

/** Each text of an HTML table export, where the grid puts it. */
function htmlCells(html: string): string[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const cellsOf = (row: string) => [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
  const px = (s: string, name: string) => Number((new RegExp(`${name}:(\\d+)px`).exec(s) ?? [])[1] ?? 0);
  const widths = cellsOf(rows[0]).map((c) => px(c.attrs, 'width'));
  const heights = rows.map((r) => px(cellsOf(r)[0]?.attrs ?? '', 'height'));
  const sum = (a: number[], n: number) => a.slice(0, n).reduce((s, v) => s + v, 0);
  const covered = new Set<string>();
  const out: string[] = [];
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of cellsOf(row)) {
      while (covered.has(`${r},${c}`)) c++;
      const colspan = Number((/colspan="(\d+)"/.exec(cell.attrs) ?? [])[1] ?? 1);
      const rowspan = Number((/rowspan="(\d+)"/.exec(cell.attrs) ?? [])[1] ?? 1);
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) if (dr || dc) covered.add(`${r + dr},${c + dc}`);
      const text = cell.body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text) out.push(`${text}@${sum(widths, c)},${sum(heights, r)} ${sum(widths.slice(c), colspan)}x${sum(heights.slice(r), rowspan)}`);
      c += colspan;
    }
  });
  return out;
}

describe('the RTF, DOCX and HTML exports, against DevExpress\'s of s54a', () => {
  it('places every RTF frame on the page and at the twips DevExpress did', () => {
    expect(rtfFrames(reportToRtf(paged, structure))).toEqual(DX_RTF);
  });

  it('places every DOCX frame as its RTF one, a section per page', () => {
    const xml = unzip(reportToDocx(paged, structure), 'word/document.xml');
    expect(docxFrames(xml)).toEqual(DX_RTF.filter((l) => !l.startsWith('section')));
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
  });

  it('puts every HTML cell where DevExpress\'s table did, on the continuous layout', () => {
    expect(htmlCells(reportToHtml(layoutContinuous(structure, ROWS.length, { rows: ROWS }), structure, 's54a'))).toEqual(DX_HTML);
  });

  it('escapes RTF text, breaks its lines and writes what is past ASCII as Unicode', () => {
    expect(rtfText('a{b}\\c')).toBe('a\\{b\\}\\\\c');
    expect(rtfText('one\ntwo')).toBe('one\\line two');
    expect(rtfText('é中')).toBe('\\u233?\\u20013?');
    expect(rtfText('😀')).toBe('\\u-10179?\\u-8704?');
  });

  // 2026-11-12 (CodeQL js/incomplete-sanitization): a link's quote was escaped for the field after
  // the RTF escape, so RTF read \" as a control symbol and the field lost the quote and its end.
  it('escapes a link for its field code first, then as RTF text', () => {
    const linked = parseReportStructure(S54A.replace('Text="Sales report"', 'Text="Sales report" NavigateUrl="https://example.com/a&quot;b\\c"'));
    const rtf = reportToRtf(paginate(linked, ROWS.length, { rows: ROWS }), linked);
    expect(rtf).toContain(String.raw`{\field{\*\fldinst HYPERLINK "https://example.com/a\\"b\\\\c"}{\fldrslt Sales report}}`);
  });
});
