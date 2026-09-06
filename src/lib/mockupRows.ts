/**
 * Which detail tables repeat a heading row that has already been drawn above
 * them, so the Mockup can draw it once.
 *
 * ## Why this is a rendering rule and not a data fix
 *
 * The layout's detail table deliberately carries its heading row. Two things
 * depend on that and neither can be given up:
 *
 * - `recordCountFromLayout` in `reportPreview.ts` counts the rows of the detail
 *   table and subtracts one, because the first is chrome. Delete the row from
 *   the data and the Preview reports one record fewer than the source document
 *   had -- and reports it silently, since nothing else knows the count.
 * - The prompt asks the model for *every* row it can see, "including the header
 *   row". The layout describes the SOURCE document; editing it to suit a
 *   renderer would make the pane lie about what came back.
 *
 * So the duplicate is real in the data and wrong only on the page: the PageHeader
 * section draws the headings, and then the detail table draws them again as its
 * own first row, a few units below. Observed on the mock invoice, where "Item
 * Description / Amount" appears twice; it is not a mock artifact, because the
 * prompt asks for exactly this shape from a real document too.
 *
 * ## The rule
 *
 * A detail table's first row is dropped only when an EARLIER section already
 * drew a table row with the same cell texts. That is deliberately narrow:
 *
 * - Earlier, not anywhere. A totals table further down the page does not
 *   license dropping a row above it.
 * - The same texts, cell for cell. A heading that was never repeated is the
 *   only copy there is, and stays.
 * - Never the last remaining row, so a one-row table cannot render empty.
 *
 * When no duplicate is found nothing changes, which is the property that makes
 * this safe to apply to every report rather than to the fixture.
 */

/**
 * Structurally typed, like `recordCountFromLayout`, so a caller does not have to
 * build a whole `ReportLayout` and neither do the tests. The real `ReportLayout`
 * satisfies it.
 */
export interface MockupLayoutLike {
  sections?: {
    type?: string;
    elements?: {
      type?: string;
      rows?: { cells?: { content?: string }[] }[];
    }[];
  }[];
}

/**
 * What a reader actually sees in a row: its cell texts, whitespace-collapsed and
 * case-folded. Null when the row carries no text at all.
 *
 * JSON rather than a joined string, for two reasons that are the same reason:
 * no separator character can make `["a b"]` collide with `["a", "b"]`, and a
 * differing cell COUNT can never compare equal.
 *
 * The all-blank guard is not theoretical. A spacer row in a header and a spacer
 * row at the top of the detail table would otherwise match, and the first row of
 * real data would go with it.
 */
function rowSignature(row: { cells?: { content?: string }[] } | undefined): string | null {
  const texts = (row?.cells ?? []).map((cell) =>
    (cell?.content ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
  );
  if (!texts.some((text) => text.length > 0)) return null;
  return JSON.stringify(texts);
}

/**
 * Keys of the detail tables whose first row should not be drawn, as
 * `"<sectionIndex>:<elementIndex>"` -- the indices the renderer already has,
 * rather than `element.id`, which the model is free to repeat or omit.
 */
export function repeatedHeadingTables(layout: MockupLayoutLike | null | undefined): Set<string> {
  /** Signatures of every table row drawn by a section already passed. */
  const drawn = new Set<string>();
  const repeated = new Set<string>();

  // One pass in document order, which is what gives "earlier" its meaning.
  (layout?.sections ?? []).forEach((section, sIdx) => {
    const isDetail = section.type === 'detail';
    (section.elements ?? []).forEach((element, eIdx) => {
      if (element.type !== 'table') return;
      const rows = element.rows ?? [];

      if (isDetail) {
        // A detail table's rows are the user's data, so they never become
        // headings for anything below.
        const first = rowSignature(rows[0]);
        if (rows.length > 1 && first && drawn.has(first)) repeated.add(`${sIdx}:${eIdx}`);
        return;
      }

      for (const row of rows) {
        const signature = rowSignature(row);
        if (signature) drawn.add(signature);
      }
    });
  });

  return repeated;
}
