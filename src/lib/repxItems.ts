/**
 * `ItemN` is a position inside its parent collection, not a document counter.
 *
 * ## The defect, and it deleted whole tables
 *
 * In a `.repx` every collection member is named for its index *within that
 * collection*: `<Rows><Item1><Item2></Rows>`, and inside each row
 * `<Cells><Item1><Item2></Cells>`. The numbering restarts at 1 in every
 * container. Verified against the serializer's own output via `tools/RepxProbe`.
 *
 * On 2026-09-04 a real generation came back with the names running straight
 * through the document instead — `<Rows><Item13>`, `<Cells><Item14>` — locked to
 * the `Ref` values beside them. DevExpress looks a collection's members up by
 * that name, finds no `Item1`, and reads the collection as **empty**. The file
 * opens in the designer with no error and no warning, and every table is simply
 * gone.
 *
 * Measured on that report, changing nothing but these names:
 *
 *     as generated   3 tables declared, 44 cells declared -> 0 tables,  0 cells loaded
 *     renumbered     3 tables declared, 44 cells declared -> 3 tables, 44 cells loaded
 *
 * It is the worst failure shape this pipeline produces: plausible XML, a clean
 * parse, a report that opens, and the content missing.
 *
 * ## This was self-inflicted, which is why the fix is here and not only there
 *
 * The prompt gained a `Ref` uniqueness rule earlier the same day
 * (`8536b1e`) telling the model to "number them once, straight through ... do
 * NOT restart numbering inside a band, a table or a row". That is correct for
 * `Ref` and exactly wrong for `ItemN`, and the model applied it to both — the
 * emitted file has `Item12/Ref="12"`, `Item13/Ref="13"`, `Item14/Ref="14"`.
 *
 * The prompt has been corrected to separate the two. That is necessary and not
 * sufficient: prompt prose is unverifiable, this failure is silent, and the
 * repair is a hundred lines of counting. So it is arithmetic here as well —
 * the same division of labour as `repxMargins.ts` and `repxRefs.ts`.
 *
 * ## What it does
 *
 * Renames every `ItemN` element so each parent's direct children run 1..n in
 * document order, opening and closing tags together. Nothing else is touched:
 * no attribute, no whitespace, no other element. A document that is already
 * correct comes back byte-identical.
 */

/** One complete `<Tag …>`, `</Tag>` or `<Tag … />`, as the other repx helpers read them. */
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;

/** Comments, CDATA and the declaration, which contain no elements. */
const NON_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

const ITEM = /^Item(\d+)$/;

export interface ItemNumbering {
  /** The document, renamed only where it had to be. */
  xml: string;
  applied: boolean;
  /** Worth logging either way. */
  reason: string;
  /**
   * How many Item *elements* were renamed.
   *
   * Elements, not tags: an element with a closing tag needs two edits, and a
   * count that mixed the two read as "renamed 105 of 88", which is the kind of
   * number a reader stops trusting the rest of the line over.
   */
  renamed: number;
}

/**
 * Make every `ItemN` its own position in its own collection.
 *
 * Returns the input untouched when it is already correct, which is the expected
 * case — hence `applied: false` with a reason rather than treating "nothing to
 * do" as failure.
 */
export function normalizeItemNames(xml: string | undefined | null): ItemNumbering {
  const text = xml ?? '';
  if (!text.trim()) return { xml: text, applied: false, reason: 'there is no REPX to renumber', renamed: 0 };

  // Blank out what does not nest, preserving length so offsets stay valid.
  const scannable = text.replace(NON_ELEMENT, (m) => ' '.repeat(m.length));

  interface Frame {
    /** The name this element was given, when it is an Item. */
    assigned: string | null;
    /** How many Item children it has seen so far. */
    children: number;
  }
  const stack: Frame[] = [{ assigned: null, children: 0 }];
  const edits: { start: number; end: number; text: string }[] = [];
  let items = 0;
  let renamedElements = 0;

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(scannable)) !== null) {
    const [, closing, tag, , selfClosing] = m;
    const isItem = ITEM.test(tag);

    if (closing) {
      const frame = stack.pop();
      // Rename the closing tag to whatever its opening tag became.
      if (frame?.assigned && frame.assigned !== tag) {
        edits.push({ start: m.index, end: TAG.lastIndex, text: `</${frame.assigned}>` });
      }
      continue;
    }

    let assigned: string | null = null;
    if (isItem) {
      items++;
      const parent = stack[stack.length - 1];
      parent.children += 1;
      assigned = `Item${parent.children}`;
      if (assigned !== tag) {
        renamedElements++;
        // Replace the tag name only — everything after it is left alone.
        edits.push({ start: m.index + 1, end: m.index + 1 + tag.length, text: assigned });
      }
    }

    if (!selfClosing) stack.push({ assigned, children: 0 });
  }

  if (!items) {
    return { xml: text, applied: false, reason: 'the document has no Item elements', renamed: 0 };
  }
  if (!edits.length) {
    return { xml: text, applied: false, reason: `all ${items} Item names already match their position`, renamed: 0 };
  }

  // Back to front, so each edit leaves the offsets before it valid.
  let out = text;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }

  return {
    xml: out,
    applied: true,
    reason:
      `renamed ${renamedElements} of ${items} Item element(s) whose name did not match their position in their ` +
      `collection (${edits.length} tags, counting closing tags) — DevExpress would have read those collections as empty`,
    renamed: renamedElements,
  };
}
