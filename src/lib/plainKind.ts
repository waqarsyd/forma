/**
 * A part of a report, and a band of one, in the words a person uses
 * (2026-11-11, full audit PX-06).
 *
 * Every edit the Preview and the chat make says what it did, and until this
 * file it said it in DevExpress's class names: "moved XRLabel "title"",
 * "retyped XRTableCell "c1"", "set the height of GroupHeader1 to 50". Those
 * reasons reach the person as a toast, a notice under the Preview and the
 * chat's list of changes, so they are written here once, for every writer
 * that names a part, rather than translated at each place they are shown.
 *
 * The control names a report gives its parts ("title", "tableLines") are not
 * translated: they are what the person sees in the designer and in the
 * outline, so they are how a part is found again.
 */

/** DevExpress's control types, as a person would name each. */
const KINDS: Record<string, string> = {
  XRLabel: 'label',
  XRTable: 'table',
  XRTableRow: 'row',
  XRTableCell: 'cell',
  XRPanel: 'panel',
  XRPictureBox: 'picture',
  XRLine: 'line',
  XRCrossBandLine: 'line',
  XRCrossBandBox: 'box',
  XRPageInfo: 'page number',
  XRChart: 'chart',
  XRCrossTab: 'cross-tab',
  XRPivotGrid: 'cross-tab',
  XRSubreport: 'subreport',
  XRBarCode: 'barcode',
  XRCheckBox: 'check box',
  XRShape: 'shape',
  XRRichText: 'rich text',
  XRCharacterComb: 'character boxes',
  XRZipCode: 'zip code',
  XRSparkline: 'sparkline',
  XRGauge: 'gauge',
  XRPageBreak: 'page break',
  XRTableOfContents: 'table of contents',
};

/**
 * The plain name of a control type: `XRLabel` is a label, `XRTableCell` a
 * cell. A type not in the list loses its `XR` and is split into words
 * (`XRPdfSignature` is a "pdf signature"), and anything else is a "part", so
 * no class name reaches a sentence.
 */
export function plainKind(type: string | null | undefined): string {
  const bare = (type ?? '').trim().replace(/^DevExpress\.XtraReports\.UI\./, '');
  if (KINDS[bare]) return KINDS[bare];
  const rest = /^XR([A-Z]\w*)$/.exec(bare)?.[1];
  if (!rest) return 'part';
  return rest.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase();
}

/** DevExpress's band kinds, as a person would name each, with the article. */
const BANDS: Record<string, string> = {
  topmargin: 'the top margin',
  bottommargin: 'the bottom margin',
  reportheader: 'the report header',
  reportfooter: 'the report footer',
  pageheader: 'the page header',
  pagefooter: 'the page footer',
  groupheader: 'the group header',
  groupfooter: 'the group footer',
  detail: 'the detail band',
  detailreport: 'the detail report',
  subband: 'the extra band',
};

/**
 * The plain name of a band, from its kind or from the name the designer
 * gives one: `PageHeader` and `pageHeaderBand1` are the page header,
 * `GroupHeader1` the group header. A name the designer would not have
 * written (`Totals`) is said as it is, in quotes.
 */
export function plainBand(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const key = raw.replace(/\d+$/, '').toLowerCase();
  // Looked up before "Band" is taken off as well as after: `SubBand1` is a sub-band, not "sub".
  const said = BANDS[key] ?? BANDS[key.replace(/band$/, '')];
  if (said) return said;
  return raw ? `the band "${raw}"` : 'the band';
}
