/**
 * What the box's "/" Tools menu and "+" menu offer (2026-11-08), as Google
 * Stitch's box has them since it changed: Stitch's Tools are Image, Logo,
 * Diagram, Animate and the like, each a kind of thing to make; Forma's are
 * the things people ask of a report, so a tool that names a change puts a
 * sentence in the box to finish and send, and one that is a step of its own
 * (a check, test data, an export) runs it. Nothing here sends: a sentence is
 * put in the box to be edited first, as a starting point is.
 *
 * Pure data, so the menus and their test read the same list.
 */
export type BoxToolKind = 'prompt' | 'accessibility' | 'test-data' | 'export';

export interface BoxTool {
  id: string;
  label: string;
  /** One line under the label, saying what it does. */
  note: string;
  kind: BoxToolKind;
  /** For a prompt: the words put in the box, with `…` where the person fills in. */
  text?: string;
  /** Offered only with a report open. */
  needsReport: boolean;
}

export const BOX_TOOLS: readonly BoxTool[] = Object.freeze([
  {
    id: 'total',
    label: 'Add a total',
    note: 'A sum, count or average in a footer',
    kind: 'prompt',
    text: 'Add a total of … at the end of the report.',
    needsReport: true,
  },
  {
    id: 'group',
    label: 'Group the records',
    note: 'A group header for each value, with a subtotal',
    kind: 'prompt',
    text: 'Group the records by …, with a subtotal in each group footer.',
    needsReport: true,
  },
  {
    id: 'column',
    label: 'Add a calculated column',
    note: 'A column worked out from other fields',
    kind: 'prompt',
    text: 'Add a column that shows …',
    needsReport: true,
  },
  {
    id: 'paper',
    label: 'Change the paper',
    note: 'Size and orientation',
    kind: 'prompt',
    text: 'Put the report on A4 landscape.',
    needsReport: true,
  },
  {
    id: 'style',
    label: 'Restyle the headings',
    note: 'Font, size and colour across the report',
    kind: 'prompt',
    text: 'Make every heading … and keep the body text as it is.',
    needsReport: true,
  },
  {
    id: 'accessibility',
    label: 'Accessibility check',
    note: 'Contrast, font sizes and descriptions, in the REPX view',
    kind: 'accessibility',
    needsReport: true,
  },
  {
    id: 'test-data',
    label: 'Fill with test data',
    note: 'Sample rows for the Preview, made by the AI',
    kind: 'test-data',
    needsReport: true,
  },
  {
    id: 'export',
    label: 'Export',
    note: 'PDF, Excel, Word and the .repx',
    kind: 'export',
    needsReport: true,
  },
]);

/** The words a prompt tool puts in the box, with the cursor where `…` was. */
export function toolText(tool: BoxTool): { text: string; caret: number } {
  const text = tool.text ?? '';
  const at = text.indexOf('…');
  return at < 0 ? { text, caret: text.length } : { text: text.replace('…', ''), caret: at };
}
