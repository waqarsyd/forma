/**
 * What the box's "/" Tools menu offers (2026-11-08), as Google Stitch's box
 * has its Tools since it changed: Stitch's are Image, Logo, Diagram, Animate
 * and the like, each a kind of thing to make; Forma's are the things people
 * ask of a report, each a sentence put in the box to finish and send. Nothing
 * here sends.
 *
 * Sentences alone since the same day. The menu ran three steps as well, the
 * accessibility check, test data and Export, and each had a place of its own
 * (the REPX view's audit, the Preview's Test data, the bar's Export); the
 * owner asked for repeated options to go, each kept in its place.
 *
 * Pure data, so the menus and their test read the same list.
 */
export interface BoxTool {
  id: string;
  label: string;
  /** One line under the label, saying what it does. */
  note: string;
  /** The words put in the box, with `…` where the person fills in. */
  text: string;
  /** Offered only with a report open. */
  needsReport: boolean;
}

export const BOX_TOOLS: readonly BoxTool[] = Object.freeze([
  {
    id: 'total',
    label: 'Add a total',
    note: 'A sum, count or average in a footer',
    text: 'Add a total of … at the end of the report.',
    needsReport: true,
  },
  {
    id: 'group',
    label: 'Group the records',
    note: 'A group header for each value, with a subtotal',
    text: 'Group the records by …, with a subtotal in each group footer.',
    needsReport: true,
  },
  {
    id: 'column',
    label: 'Add a calculated column',
    note: 'A column worked out from other fields',
    text: 'Add a column that shows …',
    needsReport: true,
  },
  {
    id: 'paper',
    label: 'Change the paper',
    note: 'Size and orientation',
    text: 'Put the report on A4 landscape.',
    needsReport: true,
  },
  {
    id: 'style',
    label: 'Restyle the headings',
    note: 'Font, size and colour across the report',
    text: 'Make every heading … and keep the body text as it is.',
    needsReport: true,
  },
]);

/** The words a prompt tool puts in the box, with the cursor where `…` was. */
export function toolText(tool: BoxTool): { text: string; caret: number } {
  const text = tool.text;
  const at = text.indexOf('…');
  return at < 0 ? { text, caret: text.length } : { text: text.replace('…', ''), caret: at };
}
