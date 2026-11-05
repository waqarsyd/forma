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
 *   description, instead of an error. The reply says which and why.
 *
 * The briefs are hints rather than instructions on purpose. Version 2 of the
 * vision model placed only 11.6% of controls where they belong
 * (docs/proposals/own-model.md), and a model told to obey that would copy
 * its mistakes; one told that the picture wins can take what is right.
 */
import type { HouseStyle } from './formaModel';
import type { ReportSkeleton, SkeletonRole } from './reportSkeleton';
import type { ReportElement, ReportLayout } from './reportTypes';
import { unitsPerInch } from './reportGeometry';

/**
 * The parts of Forma a request can draw on, in the order they act. Since
 * 2026-11-05 the AI either designs the report (`ai`) or corrects Forma's
 * draft (`corrector`), and in the second case Forma builds it (`builder`).
 */
export type TeamMember = 'ocr' | 'vision' | 'reader' | 'house' | 'memory' | 'ai' | 'corrector' | 'builder' | 'checks';

/** Who read a draft's layout: the vision model from the picture, or the box reader from OCR's texts (boxReader.ts). */
export type LayoutReader = 'vision' | 'reader';

const READ_BY: Record<LayoutReader, string> = {
  vision: "Forma's vision model read its layout and OCR read the words placed in it",
  reader: "OCR read its words and Forma's box reader put each in its band and gave it its role",
};

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

/** What each part did, as the reply says it. */
const ROLES: Record<TeamMember, string> = {
  ocr: 'OCR read the words',
  vision: "Forma's vision model read the layout",
  reader: "Forma's box reader put each in its band",
  house: "Forma's own model gave the house style",
  memory: 'your remembered preferences were applied',
  ai: '',
  corrector: '',
  builder: 'Forma built the report from it and checked it',
  checks: 'Forma checked and repaired the result',
};

/** One sentence naming who did what, for the reply under a report. */
export function teamLine(members: readonly TeamMember[], aiName: string): string {
  const parts = members.map((m) => (m === 'ai' ? `${aiName} designed the report` : m === 'corrector' ? `${aiName} corrected Forma's draft` : ROLES[m]));
  if (parts.length < 2) return '';
  const text = `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How Forma's own draft was made, for the reply that hands it over. */
export type DraftSource = 'vision' | 'reader' | 'ocr' | 'offline';

const DRAFT_SOURCES: Record<DraftSource, string> = {
  vision: "Forma's vision model and the text OCR read",
  reader: "the text OCR read, put in bands by Forma's box reader",
  ocr: 'the text OCR read',
  offline: "Forma's own model",
};

/** Why the AI did not answer, in a few words, from its error message. */
export function failureReason(message: string): string {
  if (/quota|\b429\b|RESOURCE_EXHAUSTED/i.test(message)) return 'its free quota is used up for now';
  if (/\b503\b|overloaded|UNAVAILABLE/i.test(message)) return 'it is overloaded right now';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(message)) return 'it could not be reached';
  const first = message.trim().split(/(?<=\.)\s/)[0] || 'it returned an error';
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

/** The reply when the AI could not answer and Forma's own draft stands in. */
export function fallbackReply(aiName: string, errorMessage: string, source: DraftSource): string {
  const reason = failureReason(errorMessage).replace(/\.$/, '');
  return (
    `${aiName} could not answer (${reason}), so Forma built this draft without it, from ${DRAFT_SOURCES[source]}. ` +
    `Send the request again when ${aiName} is available to have it designed in full.`
  );
}
