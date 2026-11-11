/**
 * Forma's team (2026-11-03): one report request, with every part of Forma
 * in its own role. The owner asked for the AI's report creation, OCR and
 * Forma's own model to be merged, "all will help each other and play their
 * role to create the requested report". Until then a request went down one
 * path: the AI with OCR's words beside the picture, or OCR alone with no
 * key, or Forma's vision model alone on Local AI.
 *
 * The roles:
 * - **OCR reads the words**, and where each one sits on the page. That text
 *   has gone with the picture since 2026-11-01 (ocrAttach.ts).
 * - **Forma's vision model reads the layout** when one is set up on Local AI
 *   beside the AI that designs (`visionModelOf` in aiProvider.ts). It reads
 *   the bands and each box, and with OCR's words placed in those boxes it is
 *   Forma's own draft of the page. `draftBrief` tells the AI that draft.
 * - **Forma's box reader** (boxReader.ts, 2026-11-04) does that job from
 *   OCR's texts when no vision model is set up: it puts each text in its
 *   band and gives it its role, and that is the draft and the brief instead.
 * - **Forma's own model brings the house style** it learned from the owner's
 *   reports: the paper, margins, fonts by role, a record's height.
 *   `houseStyleBrief` tells the AI that style for a report described in
 *   words. A picture shows its own style, so it is not told there.
 * - **The user's remembered preferences** go with every request
 *   (memory.ts), as before.
 * - **The AI designs the report**, told all of the above as measured hints
 *   that the picture and the request overrule.
 * - **Forma's repairs and audit check the result**, unchanged.
 * - **Forma's own draft is the backup.** When the AI cannot answer (a quota,
 *   the network, a local server that is off), the user gets the draft built
 *   from the vision model and OCR, OCR alone, or Forma's own model for a
 *   description, instead of an error. The reply says why, in plain words,
 *   and calls it a quicker version, never a draft of Forma's (2026-11-11).
 *
 * The briefs are hints rather than instructions on purpose. Version 2 of the
 * vision model placed only 11.6% of controls where they belong
 * (docs/proposals/own-model.md), and a model told to obey that would copy
 * its mistakes; one told that the picture wins can take what is right.
 */
import { draftToText } from './draftText';
import type { HouseStyle } from './formaModel';
import type { ReportSkeleton, SkeletonRole } from './reportSkeleton';
import type { DraftGiven, PageText } from './skeletonRepx';
import type { ReportElement, ReportLayout } from './reportTypes';
import { unitsPerInch } from './reportGeometry';

/*
 * `TeamMember`, the list of parts that took part in a request, went on
 * 2026-11-11 (the full audit's RH-08): it existed for a reply that named
 * them, and since 2026-11-10 the reply is the result and names nobody.
 */

/** Who read a draft's layout: the vision model from the picture, or the box reader from OCR's texts (boxReader.ts). */
export type LayoutReader = 'vision' | 'reader';

const READ_BY: Record<LayoutReader, string> = {
  vision: "Forma's vision model read its layout and OCR read the words placed in it",
  reader: "OCR read its words and Forma's box reader put each in its band and gave it its role",
};

/**
 * What the AI is given to correct of a page the box reader built (2026-11-11,
 * moved here from App with the wave 6b follow-up to CC-07): the draft in
 * lib/draftText.ts's format, the page's texts as read, the report's name,
 * and the picture's dpi, which sets how close the fit to the page's
 * positions holds each text (lib/sourceAgreement.ts).
 */
export function readerCorrection(built: { skeleton: ReportSkeleton; used: DraftGiven; texts: PageText[]; title: string; dpi: number }) {
  return { text: draftToText(built.skeleton, built.used), texts: built.texts, title: built.title, dpi: built.dpi };
}

/** The most boxes a draft brief lists, and the longest text it quotes. */
export const BRIEF_MAX_ELEMENTS = 150;
export const BRIEF_MAX_TEXT = 60;

/** A length in hundredths of an inch, in the report's unit, rounded for reading. */
function inUnit(hundredths: number, unit: string): number {
  return Math.round(((hundredths * unitsPerInch(unit)) / 100) * 10) / 10;
}

/** A font size in hundredths of an inch, as points. */
const points = (hundredths: number) => Math.round(((hundredths * 72) / 100) * 10) / 10;

const quote = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify(t.length > BRIEF_MAX_TEXT ? `${t.slice(0, BRIEF_MAX_TEXT - 1)}…` : t);
};

const ALIGNED = { left: 'left', center: 'centred', right: 'right' } as const;

function describeElement(e: ReportElement, unit: string): string {
  const box = `at ${inUnit(e.x, unit)},${inUnit(e.y, unit)} size ${inUnit(e.width, unit)}x${inUnit(e.height, unit)}`;
  const font = e.fontSize ? `, ${e.fontFamily ?? 'Arial'} ${points(e.fontSize)}pt${e.bold ? ' bold' : ''}${e.italic ? ' italic' : ''}` : '';
  const align = e.textAlign ? `, ${ALIGNED[e.textAlign]}` : '';
  if (e.type === 'table') {
    const rows = e.rows ?? [];
    const first = rows[0]?.cells.map((c) => quote(c.content)).join(' | ') ?? '';
    return `table ${box}, ${rows.length} row(s) of ${rows[0]?.cells.length ?? 0} cells${first ? `; first row: ${first}` : ''}`;
  }
  if (e.type === 'line' || e.type === 'image' || e.type === 'chart' || e.type === 'barcode') return `${e.type} ${box}`;
  const text = e.content.trim();
  const shown = !text ? '' : /^\[[^\]]+\]$/.test(text) ? `: value bound to ${text}` : /^sum \[/.test(text) ? `: total, ${text}` : `: ${quote(text)}`;
  return `${e.type} ${box}${font}${align}${shown}`;
}

/**
 * Forma's own draft of a page, as the AI is told it: the paper and margins,
 * then each band with its boxes in the report's unit, measured from the
 * band's top left corner, and the words OCR read inside them. `layout` is
 * what `skeletonToDesign` built from the skeleton `k` that `by` read, both in
 * hundredths of an inch.
 */
export function draftBrief(k: ReportSkeleton, layout: ReportLayout, unit: string, by: LayoutReader = 'vision'): string {
  const m = k.margins;
  const lines = [
    `FORMA'S OWN DRAFT OF THIS PAGE. ${READ_BY[by]}. ` +
      'Use it as a measured starting point for where the bands and boxes sit, not as an instruction: wherever it disagrees with the image, the image is right, ' +
      'and anything it missed must still be reproduced from the image. ' +
      `Lengths are in the report's unit (${unit}), each box from its band's top left corner.`,
    `Paper: ${k.paper} ${k.landscape ? 'landscape' : 'portrait'}; margins top ${inUnit(m.top, unit)}, bottom ${inUnit(m.bottom, unit)}, left ${inUnit(m.left, unit)}, right ${inUnit(m.right, unit)}.`,
  ];
  let listed = 0;
  let left = 0;
  for (const s of layout.sections) {
    lines.push(`- ${s.name}, height ${inUnit(s.height, unit)}:`);
    if (!s.elements.length) lines.push('  (nothing drawn)');
    for (const e of s.elements) {
      if (listed >= BRIEF_MAX_ELEMENTS) {
        left++;
        continue;
      }
      listed++;
      lines.push(`  - ${describeElement(e, unit)}`);
    }
  }
  if (left) lines.push(`(${left} more box(es) not listed.)`);
  return lines.join('\n');
}

const ROLE_NAMES: Partial<Record<SkeletonRole, string>> = {
  title: 'titles',
  caption: 'captions and column headings',
  value: 'values',
  total: 'totals',
  pageInfo: 'page numbers and dates',
};

/**
 * The house style Forma's own model learned, as the AI is told it for a
 * report described in words: what to use wherever the description and the
 * user's preferences say nothing. Empty when the style holds nothing to say.
 */
export function houseStyleBrief(style: HouseStyle, reports: number, unit: string): string {
  const lines: string[] = [];
  const paper = style.papers[0];
  if (paper) {
    const m = style.margins[paper.paper];
    const margins = m
      ? `; margins top ${inUnit(m.top, unit)}, bottom ${inUnit(m.bottom, unit)}, left ${inUnit(m.left, unit)}, right ${inUnit(m.right, unit)}`
      : '';
    lines.push(`- Paper: ${paper.paper} ${paper.landscape ? 'landscape' : 'portrait'}${margins}.`);
  }
  const family = style.fonts[0]?.family;
  const roles = (Object.keys(ROLE_NAMES) as SkeletonRole[]).flatMap((role) => {
    const r = style.roles[role];
    return r ? [`${ROLE_NAMES[role]} ${r.family === family ? '' : `${r.family} `}${r.size}pt${r.bold >= 0.5 ? ' bold' : ''}`] : [];
  });
  if (family || roles.length) lines.push(`- Fonts: ${family ? `${family} throughout` : 'as below'}${roles.length ? `; ${roles.join(', ')}` : ''}.`);
  if (style.rowHeight > 0) lines.push(`- A record's line is ${inUnit(style.rowHeight, unit)} tall.`);
  if (!lines.length) return '';
  return (
    `HOUSE STYLE, learned by Forma's own model from ${reports} reports. Use it wherever the description and the user's preferences say nothing; ` +
    `lengths are in the report's unit (${unit}).\n${lines.join('\n')}`
  );
}

/**
 * What the reply under a report says about who made it: nothing (2026-11-10,
 * the full audit, the owner's rule). Until then it named every part, "OCR
 * read the words, Forma's box reader put each in its band, your remembered
 * preferences were applied, Gemini designed the report and Forma checked and
 * repaired the result": machinery nobody asked about. In mock mode
 * (`VITE_FORMA_MOCK`) no AI was asked, and one sentence still says a canned
 * report stood in (2026-11-07, agent audit item 96), so a mock is never read
 * as the AI's work.
 */
export function teamLine(mock = false): string {
  return mock ? 'Mock mode is on, so a canned report stood in for the AI.' : '';
}

/** How Forma's own draft was made; kept on the draft for the record, not said in the reply. */
export type DraftSource = 'vision' | 'reader' | 'ocr' | 'offline';

/**
 * Why the AI did not answer, in a few words, from its error message. App
 * passes the provider's own words, the classified error's `cause`, since
 * 2026-11-07 (agent audit item 15): the classified ones had been rewritten
 * ("Google's servers are busy…") and matched nothing here, so the reply
 * quoted a whole sentence about Google for a local model.
 */
export function failureReason(message: string): string {
  /*
   * Six reasons, each in plain words (2026-11-11, the full audit's CV-07).
   * Until then a local model's failure was "its context window is too small
   * for the request" or "it spent its whole answer reasoning", and anything
   * else was quoted as the provider wrote it ("The model returned no
   * report."): how a model works, not why the person got a quicker version.
   */
  if (/offline/i.test(message)) return 'you are offline';
  if (/quota|\b429\b|RESOURCE_EXHAUSTED|rate limit|free limit/i.test(message)) return 'its free limit is used up for now';
  if (/\b503\b|overloaded|UNAVAILABLE|\bbusy\b|high demand/i.test(message)) return 'it is busy right now';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed|could not reach|could not be reached/i.test(message)) return 'it could not be reached';
  if (/context window|too long|too large|token limit|maximum context/i.test(message)) return 'the request was too long for it';
  // A seventh, beside the audit's six: a key refused is something the person can act on.
  if (/api[ _-]?key|API_KEY_INVALID|\b401\b|\b403\b|PERMISSION_DENIED|unauthori[sz]ed/i.test(message)) return 'it did not accept the key';
  return 'it gave no answer';
}

/**
 * The reply when the AI could not answer and a quicker version made by Forma
 * stands in: why, and what to do, in the user's terms (2026-11-11, the full
 * audit's CV-07; it said "Forma's own draft of the page" until then). A
 * report described in words gets a first draft from the description.
 */
export function fallbackReply(aiName: string, errorMessage: string, described = false): string {
  const reason = failureReason(errorMessage);
  return described
    ? `${aiName} couldn't take this one (${reason}), so this is a first draft from your description. Send it again later to have it designed in full.`
    : `${aiName} couldn't take this one (${reason}), so here is a quicker version of the page. Check the figures and fonts against your source, and send the request again later for the full design.`;
}
