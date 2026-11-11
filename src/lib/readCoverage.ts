/**
 * Did the report keep what the page shows? (2026-11-10, the owner's AI
 * accuracy programme, batch AD, item 12.)
 *
 * The leading tools check what a model wrote against what it was given and
 * ask once more, capped, when too much is missing. Forma can, because its own
 * reading of a page is independent of the AI: the draft the box reader writes
 * (lib/draftText.ts) names every caption and title the page shows, in quotes,
 * and the band it stands in. A report built from a picture should carry those
 * words as text; the page's values become fields, so they are not counted.
 *
 * - **Kept** is the share of the draft's captions and titles found in the
 *   report's labels and cells, compared as letters and digits, case and
 *   punctuation aside, so "Total Due:" keeps "Total due", and since
 *   2026-11-11 with one character in eight forgiven, so the AI correcting
 *   OCR's "Tota1 Due" is not counted as leaving it out.
 * - **Same band** is the share of those found whose report band is the
 *   draft's; a page header and the top margin count as one, and a page footer
 *   and the bottom margin, since either prints at the page's edge.
 *
 * The draft is a reading, not the truth, so a miss can be the reader's: the
 * check answers "what did the report leave out of what Forma read", which is
 * what a retry can ask the AI about (`MISSED_RETRY`), and what the user sees.
 */
import { textToDraft } from './draftText';
import { parseReportStructure, type BandKind } from './reportPreview';
import { placeKey } from './skeletonRepx';

/** A caption or title the draft says the page shows, and its band. */
export interface PageCaption {
  text: string;
  band: BandKind;
}

export interface ReadCoverage {
  /** The draft's captions and titles. */
  captions: number;
  /** Of those, found in the report. */
  kept: number;
  /** Not found, in the page's order. */
  missing: string[];
  /** Of the found, how many stand in the draft's band. */
  sameBand: number;
}

/** The captions and titles in a draft, from labels and table cells alike. */
export function captionsOfDraft(draftText: string): PageCaption[] {
  const { skeleton, given } = textToDraft(draftText);
  if (!skeleton) return [];
  const out: PageCaption[] = [];
  const literal = (role: string) => role === 'caption' || role === 'title';
  for (const [bi, band] of skeleton.bands.entries()) {
    for (const [ci, control] of band.controls.entries()) {
      const words = given.words.get(placeKey(bi, ci));
      if (literal(control.role) && words?.trim()) out.push({ text: words.trim(), band: band.kind as BandKind });
      for (const [ri, row] of (control.rows ?? []).entries()) {
        for (const [k, cell] of row.entries()) {
          const cellWords = given.words.get(placeKey(bi, ci, ri, k));
          if (literal(cell.role) && cellWords?.trim()) out.push({ text: cellWords.trim(), band: band.kind as BandKind });
        }
      }
    }
  }
  return out;
}

/** Letters and digits in lower case, one space between words. */
export const comparable = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Edits that turn `a` into `b`, stopping early once `limit` is passed. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How far a report's words may be from Forma's reading and still be the same
 * caption (2026-11-11, the full audit, PL-09). The reading is OCR's, and the
 * AI is asked to correct it: "lnvoice Number" written as "Invoice Number" was
 * counted missing, and the retry then told the AI to put the misreading back.
 * One edit in eight characters, one at least, for a caption of five or more;
 * a shorter one is matched exactly, so "Rate" is not found in "Rates".
 */
const tolerance = (want: string) => (want.length >= 5 ? Math.max(1, Math.floor(want.length / 8)) : 0);

/** Whether `text` holds `want` as whole words, or as words within its tolerance of them. */
function holds(text: string, want: string): boolean {
  if (` ${text} `.includes(` ${want} `)) return true;
  const allowed = tolerance(want);
  if (!allowed) return false;
  const words = text.split(' ');
  const span = want.split(' ').length;
  for (let i = 0; i + span <= words.length; i++) {
    if (editDistance(words.slice(i, i + span).join(' '), want, allowed) <= allowed) return true;
  }
  return false;
}

/** Bands that print at the same edge of a page. */
const SIDE: Partial<Record<string, string>> = { TopMargin: 'PageHeader', BottomMargin: 'PageFooter' };
const side = (band: string) => SIDE[band] ?? band;

/** What of `captions` the report in `repx` kept, and where. */
export function readCoverage(captions: readonly PageCaption[], repx: string): ReadCoverage {
  const structure = parseReportStructure(repx);
  const texts: { text: string; band: string }[] = [];
  for (const band of structure.bands) {
    for (const control of band.controls) {
      if (control.text?.trim()) texts.push({ text: comparable(control.text), band: band.kind });
      for (const row of control.rows ?? []) for (const cell of row.cells) if (cell.text?.trim()) texts.push({ text: comparable(cell.text), band: band.kind });
    }
  }
  let kept = 0;
  let sameBand = 0;
  const missing: string[] = [];
  for (const caption of captions) {
    const want = comparable(caption.text);
    if (!want) continue;
    const found = texts.filter((t) => holds(t.text, want));
    if (!found.length) {
      missing.push(caption.text);
      continue;
    }
    kept++;
    if (found.some((t) => side(t.band) === side(caption.band))) sameBand++;
  }
  return { captions: captions.filter((c) => comparable(c.text)).length, kept, missing, sameBand };
}

/**
 * When a report has left out enough of the page to ask once more (item 13):
 * at least four captions read, a quarter or more of them missing, and at least
 * two missing, so one unusual heading never costs the user a second request.
 */
export function worthAnotherTry(c: ReadCoverage): boolean {
  return c.captions >= 4 && c.missing.length >= 2 && c.missing.length / c.captions >= 0.25;
}

/** The note a retry carries, naming what was left out; at most 20 texts, each at most 80 characters. */
export function missedNote(c: ReadCoverage): string {
  const listed = c.missing.slice(0, 20).map((t) => JSON.stringify(t.length > 80 ? `${t.slice(0, 79)}…` : t));
  return (
    `A FIRST ANSWER LEFT OUT TEXT THE PAGE SHOWS. Forma read these captions and titles on the page and they were missing from the report: ${listed.join(', ')}` +
    `${c.missing.length > 20 ? `, and ${c.missing.length - 20} more` : ''}. Include each of them as text, where the page shows it, and keep everything else as it was.`
  );
}
